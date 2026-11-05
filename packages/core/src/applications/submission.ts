/**
 * What the candidate actually sent with an application: the answers to the
 * form's questions, the cover letter and the salary they named. Kept so it can
 * be looked up before a screen call, and compared with the prep pack's drafts.
 */
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { PrepPack } from "../agent/prep.ts";
import type { Db } from "../db/client.ts";
import { applicationAnswers, applicationSubmissions, applications, postingSnapshots, prepPacks } from "../db/schema.ts";
import { localDate } from "../lib/dates.ts";
import { headline, tsMatch, tsRank } from "../lib/search.ts";
import { ensureSnapshots } from "../postings/snapshots.ts";
import type { EventSource } from "./constants.ts";
import { type Queryable, recordEvent } from "./events.ts";

const AnswerInput = z.object({
  question: z.string().trim().min(1, "a question can't be empty"),
  answer: z.string(),
  /** "pack": drafted by the prep pack. "added": a question only the application form asked. */
  origin: z.enum(["pack", "added"]),
});

export const SubmissionInput = z.object({
  /** null: no cover letter was sent. */
  coverLetter: z.string().nullable(),
  salaryStated: z.string().trim().nullable(),
  answers: z.array(AnswerInput),
  /** The pack the apply session showed; null: none (the no-pack arm). Left out (a tracker edit), the posting's latest. */
  prepPackId: z.number().int().nullable().optional(),
});
export type SubmissionInput = z.infer<typeof SubmissionInput>;

const normalize = (question: string) => question.trim().toLowerCase().replace(/\s+/g, " ");

/** How a save changed the answers, by question: logged with the event, and later a measure of how much drafts get rewritten. */
export function diffAnswers(prev: { question: string; answer: string }[], next: { question: string; answer: string }[]) {
  const before = new Map(prev.map((a) => [normalize(a.question), a.answer]));
  const after = new Map(next.map((a) => [normalize(a.question), a.answer]));
  let added = 0;
  let edited = 0;
  for (const [q, answer] of after) {
    if (!before.has(q)) added++;
    else if (before.get(q)!.trim() !== answer.trim()) edited++;
  }
  const removed = [...before.keys()].filter((q) => !after.has(q)).length;
  return { added, edited, removed };
}

/**
 * The posting text as it was on `date`: the last snapshot captured by the end of
 * that day, or the first one if the posting was only collected later.
 */
async function snapshotAt(q: Queryable, postingId: number, date: string) {
  const [before] = await q
    .select({ id: postingSnapshots.id })
    .from(postingSnapshots)
    .where(and(eq(postingSnapshots.postingId, postingId), lte(postingSnapshots.capturedAt, sql`(${date}::date + 1)`)))
    .orderBy(desc(postingSnapshots.capturedAt))
    .limit(1);
  if (before) return before.id;
  const [first] = await q
    .select({ id: postingSnapshots.id })
    .from(postingSnapshots)
    .where(eq(postingSnapshots.postingId, postingId))
    .orderBy(asc(postingSnapshots.capturedAt))
    .limit(1);
  return first?.id ?? null;
}

/**
 * Save what was sent, replacing the previous version. The first save pins the
 * posting text of the applied date and the prep pack the candidate was shown;
 * later edits keep that pin.
 * The pack's drafts are copied next to each answer, matched by question.
 */
export async function saveSubmission(q: Queryable, applicationId: number, input: SubmissionInput, opts: { source: EventSource }) {
  const [app] = await q
    .select({ postingId: applications.postingId, appliedOn: applications.appliedOn })
    .from(applications)
    .where(eq(applications.id, applicationId));
  if (!app) throw new Error(`application ${applicationId} not found`);

  const [existing] = await q.select().from(applicationSubmissions).where(eq(applicationSubmissions.applicationId, applicationId));
  let snapshotId = existing?.snapshotId ?? null;
  let prepPackId = existing?.prepPackId ?? null;
  if (!existing && app.postingId) {
    // The text on the posting now may never have been snapshotted (see ensureSnapshots).
    await ensureSnapshots(q, [app.postingId]);
    snapshotId = await snapshotAt(q, app.postingId, app.appliedOn ?? localDate());
    if (input.prepPackId !== null) {
      const [pack] = await q
        .select({ id: prepPacks.id })
        .from(prepPacks)
        .where(and(eq(prepPacks.postingId, app.postingId), input.prepPackId === undefined ? undefined : eq(prepPacks.id, input.prepPackId)))
        .orderBy(desc(prepPacks.createdAt))
        .limit(1);
      prepPackId = pack?.id ?? null;
    }
  }

  let pack: PrepPack | null = null;
  if (prepPackId) {
    const [row] = await q.select({ content: prepPacks.content }).from(prepPacks).where(eq(prepPacks.id, prepPackId));
    pack = (row?.content as PrepPack | undefined) ?? null;
  }
  const drafts = new Map((pack?.applicationAnswers ?? []).map((a) => [normalize(a.question), a.answer]));

  const values = {
    postingId: app.postingId,
    snapshotId,
    prepPackId,
    coverLetter: input.coverLetter,
    draftedCoverLetter: pack?.coverLetter ?? null,
    salaryStated: input.salaryStated || null,
  };
  if (existing) {
    await q
      .update(applicationSubmissions)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(applicationSubmissions.id, existing.id));
  } else {
    await q.insert(applicationSubmissions).values({ applicationId, ...values });
  }

  const prev = await q
    .select({ question: applicationAnswers.question, answer: applicationAnswers.answer })
    .from(applicationAnswers)
    .where(eq(applicationAnswers.applicationId, applicationId));
  await q.delete(applicationAnswers).where(eq(applicationAnswers.applicationId, applicationId));
  if (input.answers.length) {
    await q.insert(applicationAnswers).values(
      input.answers.map((a, position) => ({
        applicationId,
        position,
        question: a.question,
        answer: a.answer,
        origin: a.origin,
        draftedAnswer: drafts.get(normalize(a.question)) ?? null,
      })),
    );
  }

  await recordEvent(q, {
    applicationId,
    type: "answers_saved",
    occurredOn: localDate(),
    source: opts.source,
    payload: {
      ...diffAnswers(prev, input.answers),
      coverLetterChanged: (existing?.coverLetter ?? null) !== input.coverLetter,
      first: !existing,
    },
  });
}

export async function getSubmission(db: Db, applicationId: number) {
  const [submission] = await db.select().from(applicationSubmissions).where(eq(applicationSubmissions.applicationId, applicationId));
  if (!submission) return null;
  const { search: _search, ...rest } = submission;
  const answers = await db
    .select({
      id: applicationAnswers.id,
      position: applicationAnswers.position,
      question: applicationAnswers.question,
      answer: applicationAnswers.answer,
      origin: applicationAnswers.origin,
      draftedAnswer: applicationAnswers.draftedAnswer,
    })
    .from(applicationAnswers)
    .where(eq(applicationAnswers.applicationId, applicationId))
    .orderBy(asc(applicationAnswers.position));
  return { ...rest, answers };
}

/** Answers sent in earlier applications that match `q`, best first, with the matching words highlighted. */
export async function searchSentAnswers(db: Db, q: string, opts: { limit?: number } = {}) {
  if (!q.trim()) return [];
  return db
    .select({
      applicationId: applications.id,
      company: applications.company,
      role: applications.role,
      appliedOn: applications.appliedOn,
      question: applicationAnswers.question,
      answer: applicationAnswers.answer,
      questionHeadline: headline(applicationAnswers.question, q, { maxFragments: 1, maxWords: 30 }),
      answerHeadline: headline(applicationAnswers.answer, q),
    })
    .from(applicationAnswers)
    .innerJoin(applications, eq(applications.id, applicationAnswers.applicationId))
    .where(tsMatch(applicationAnswers.search, q))
    .orderBy(desc(tsRank(applicationAnswers.search, q)), desc(applications.appliedOn))
    .limit(opts.limit ?? 10);
}
