import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { Facts } from "../agent/facts.ts";
import { pendingProposals } from "../agent/outcomes.ts";
import { type PayTarget, payContext, payTargetForPosting } from "../agent/pay.ts";
import { type PrepPack, packExpectations } from "../agent/prep.ts";
import { MIN_FIT } from "../agent/rules.ts";
import type { RunSummary } from "../agent/runs.ts";
import { decidedRoleKeys, roleKey } from "../agent/work.ts";
import { FOLLOW_UP_AFTER_DAYS, OUTSIDE_FOLLOW_UP_MAX_DAYS } from "../applications/constants.ts";
import { getSubmission } from "../applications/submission.ts";
import type { ApplicationForm } from "../ats/forms.ts";
import type { Db } from "../db/client.ts";
import { agentRuns, applicationEvents, applications, companies, evaluations, postingSnapshots, postings, prepPacks } from "../db/schema.ts";
import { localDate, localDateDaysAgo } from "../lib/dates.ts";
import { pickPrecision } from "./feedback.ts";

/** Needs-check roles below this fit aren't worth a manual look. */

const today = () => localDate();
const daysAgo = localDateDaysAgo;

/**
 * Postings the candidate has already acted on (applied, skipped, or snoozed
 * until a date that hasn't come yet) are out of the queue.
 */
const decided = (db: Db) =>
  db
    .select({ id: applications.postingId })
    .from(applications)
    .where(
      and(sql`${applications.postingId} is not null`, or(sql`${applications.stage} <> 'lead'`, sql`${applications.snoozedUntil} > ${today()}::date`)),
    );

function evaluatedPostings(db: Db) {
  return db
    .select({
      postingId: postings.id,
      evaluationId: evaluations.id,
      companyId: companies.id,
      company: companies.name,
      priority: companies.priority,
      ats: companies.ats,
      title: postings.title,
      location: postings.locationRaw,
      url: postings.url,
      postedAt: postings.postedAt,
      /** Set when the role is gone from the board: a shortlisted one can't get a pack or be applied to. */
      closedAt: postings.closedAt,
      verdict: evaluations.verdict,
      reasons: evaluations.reasons,
      fitScore: evaluations.fitScore,
      evidence: evaluations.evidence,
      facts: evaluations.facts,
      evaluatedAt: evaluations.createdAt,
      /** The posting text this evaluation read (GET /postings/:id/snapshots/:sid). */
      snapshotId: postingSnapshots.id,
      textCapturedAt: postingSnapshots.capturedAt,
      pack: prepPacks.content,
      form: postings.applicationForm,
      /** Set when the candidate confirmed a "needs check" posting is open to them: it's then in Ready. */
      eligibilityConfirmedAt: postings.eligibilityConfirmedAt,
      eligibilityNote: postings.eligibilityNote,
      /** Another application at the same company ("applied 2026-09-18"), so you don't apply twice unknowingly. */
      companyApplication: sql<string | null>`(
        select a.stage || coalesce(' ' || a.applied_on::text, '') from ${applications} a
        where a.company_id = ${companies.id} and a.posting_id is distinct from ${postings.id}
          and a.stage not in ('lead', 'shortlisted', 'skipped')
        order by a.updated_at desc limit 1)`,
    })
    .from(evaluations)
    .innerJoin(postings, eq(postings.id, evaluations.postingId))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .innerJoin(postingSnapshots, eq(postingSnapshots.id, evaluations.snapshotId))
    .leftJoin(prepPacks, eq(prepPacks.evaluationId, evaluations.id))
    .$dynamic();
}

type Row = Omit<Awaited<ReturnType<ReturnType<typeof evaluatedPostings>["execute"]>>[number], "facts" | "pack" | "form"> & {
  facts: Facts;
  pack: PrepPack | null;
  form: ApplicationForm | null;
};

export type QueueItem = Omit<Row, "form"> & {
  /** What to ask for, computed from data/pay.md and the posting (null without a pay config). */
  payTarget: PayTarget | null;
  /** Form questions only the candidate answers (salary, visa, how did you hear…). */
  youAnswer: string[];
  /** Whether the form has a cover-letter field; null when the form couldn't be read. */
  coverLetterField: ApplicationForm["coverLetter"] | null;
};

/** Add what code derives from the form and data/pay.md to each item. */
async function withPrepExtras(rows: Row[]): Promise<QueueItem[]> {
  const ctx = await payContext();
  return rows.map(({ form, ...r }) => ({
    ...r,
    payTarget: payTargetForPosting(ctx, r.facts, r.location, form),
    youAnswer: packExpectations(r.facts, form, "").youAnswer.map((q) => q.question),
    coverLetterField: form?.coverLetter ?? null,
  }));
}

/** Open postings at watched companies, not decided yet, with the evaluation of the text currently on the board. */
const openAndActive = (db: Db) =>
  and(
    isNull(postings.closedAt),
    eq(companies.status, "active"),
    eq(evaluations.purpose, "queue"),
    eq(postingSnapshots.contentHash, postings.contentHash),
    sql`${postings.id} not in (${decided(db)})`,
  );

/**
 * Hide copies of a role already decided under another posting (the same role
 * per country), and every role at a company with an active application: those
 * wait until the application ends.
 */
async function withoutDecidedCopies(db: Db, items: Row[]) {
  const decided = await decidedRoleKeys(db);
  const active = new Set(
    (
      await db
        .selectDistinct({ companyId: applications.companyId })
        .from(applications)
        .where(and(inArray(applications.stage, ["applied", "screening", "interviewing", "offer"]), sql`${applications.companyId} is not null`))
    ).map((r) => r.companyId),
  );
  return items.filter((i) => !decided.has(roleKey(i.companyId, i.title)) && !active.has(i.companyId));
}

const byFitThenPriority = [desc(evaluations.fitScore), sql`case ${companies.priority} when 'A' then 0 when 'B' then 1 when 'C' then 2 else 3 end`];

/**
 * Leads to decide, best first: the agent's leads, with or without a prep pack
 * yet, and good-fitting roles whose eligibility from home the posting
 * doesn't settle (or that the candidate confirmed is open to them).
 */
export async function decideQueue(db: Db): Promise<QueueItem[]> {
  const rows = await evaluatedPostings(db)
    .where(
      and(
        openAndActive(db),
        or(
          eq(evaluations.verdict, "lead"),
          and(eq(evaluations.verdict, "needs_check"), or(gte(evaluations.fitScore, MIN_FIT), isNotNull(postings.eligibilityConfirmedAt))),
        ),
      ),
    )
    .orderBy(...byFitThenPriority);
  return withPrepExtras(await withoutDecidedCopies(db, rows as Row[]));
}

/**
 * Leads the candidate said yes to, waiting for an apply session, each with its latest evaluation:
 * a yes stands when the company edits the posting afterwards (a shortlisted posting isn't evaluated again).
 */
export async function shortlistQueue(db: Db): Promise<QueueItem[]> {
  const shortlisted = db.select({ id: applications.postingId }).from(applications).where(eq(applications.stage, "shortlisted"));
  const latest = sql`(select e.id from ${evaluations} e where e.posting_id = ${postings.id} order by e.created_at desc, e.id desc limit 1)`;
  const rows = await evaluatedPostings(db)
    .where(and(eq(evaluations.id, latest), inArray(postings.id, shortlisted)))
    .orderBy(...byFitThenPriority);
  return withPrepExtras(rows as Row[]);
}

/**
 * When an application was logged as applied: its last move to "applied", or
 * the row itself if none was logged (a row can be created earlier by a snooze).
 */
const loggedAt = sql`coalesce(
  (select max(e.created_at) from ${applicationEvents} e where e.application_id = ${applications.id} and e.to_stage = 'applied'),
  ${applications.createdAt})`;

/**
 * Applications waiting for a reply. One follow-up, then stop: an application
 * shows up once after 14 quiet days (actions: Followed up / Drop), and once
 * more 14 days after the follow-up (Drop only). One made elsewhere and logged
 * weeks later isn't offered: a follow-up that late would only look odd.
 */
export async function followUps(db: Db) {
  const rows = await db
    .select({
      applicationId: applications.id,
      company: applications.company,
      role: applications.role,
      roleUrl: applications.roleUrl,
      appliedOn: applications.appliedOn,
      lastContact: applications.lastContact,
      followedUpOn: applications.followedUpOn,
    })
    .from(applications)
    .where(
      and(
        eq(applications.stage, "applied"),
        isNull(applications.firstResponseOn),
        sql`not (${applications.origin} = 'outside' and ${applications.appliedOn} < (${loggedAt})::date - ${OUTSIDE_FOLLOW_UP_MAX_DAYS}::int)`,
        or(
          and(
            isNull(applications.followedUpOn),
            lte(sql`coalesce(${applications.lastContact}, ${applications.appliedOn})`, daysAgo(FOLLOW_UP_AFTER_DAYS)),
          ),
          lte(applications.followedUpOn, daysAgo(FOLLOW_UP_AFTER_DAYS)),
        ),
      ),
    )
    .orderBy(applications.appliedOn);
  return rows.map((r) => ({ ...r, canFollowUp: r.followedUpOn === null }));
}

export { pendingProposals };

/** Implicit feedback: of the queue's picks the candidate acted on, how many were worth applying to (docs/metrics.md, 4)? */
export async function pickFeedback(db: Db) {
  const decisions = await db
    .select({ origin: applications.origin, stage: applications.stage, appliedOn: applications.appliedOn, skipReason: applications.skipReason })
    .from(applications)
    .where(and(ne(applications.origin, "import"), ne(applications.stage, "lead")));
  return pickPrecision(decisions);
}

/** The last evaluation run, with its feed errors (the header's status line). */
export async function queueStatus(db: Db) {
  const [agentRun] = await db
    .select({ id: agentRuns.id, startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt, stats: agentRuns.stats })
    .from(agentRuns)
    .where(eq(agentRuns.kind, "evaluate"))
    .orderBy(desc(agentRuns.id))
    .limit(1);
  // Stats are jsonb: typed here, where they're read, as what finishRun (agent/runs.ts) wrote.
  return { agentRun: agentRun ? { ...agentRun, stats: agentRun.stats as Omit<RunSummary, "runId"> | null } : null };
}

/** Company and title, for messages about a posting ("Skipped Colonist · Product Engineer"). */
export async function postingLabel(db: Db, postingId: number) {
  const [p] = await db
    .select({ company: companies.name, title: postings.title })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(eq(postings.id, postingId));
  if (!p) throw new Error(`posting ${postingId} not found`);
  return p;
}

/**
 * What the Apply dialog starts from: the latest prep pack's drafts (the pack
 * saveSubmission pins), and what was already logged if the posting was
 * decided before. With `drafts: false` (the no-pack arm of the timing
 * experiment) it starts from the form's questions alone and pins no pack.
 */
export async function applyDraft(db: Db, postingId: number, opts: { drafts?: boolean } = {}) {
  const [posting] = await db
    .select({
      postingId: postings.id,
      company: companies.name,
      title: postings.title,
      url: postings.url,
      location: postings.locationRaw,
      form: postings.applicationForm,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(eq(postings.id, postingId));
  if (!posting) throw new Error(`posting ${postingId} not found`);
  const [pack] = await db
    .select({ id: prepPacks.id, content: prepPacks.content })
    .from(prepPacks)
    .where(eq(prepPacks.postingId, postingId))
    .orderBy(desc(prepPacks.createdAt))
    .limit(1);
  const content = opts.drafts === false ? null : ((pack?.content as PrepPack | undefined) ?? null);
  const [application] = await db
    .select({ id: applications.id, stage: applications.stage })
    .from(applications)
    .where(eq(applications.postingId, postingId));
  const { form: rawForm, location, ...rest } = posting;
  const form = rawForm as ApplicationForm | null;
  const [evaluation] = await db
    .select({ facts: evaluations.facts })
    .from(evaluations)
    .where(eq(evaluations.postingId, postingId))
    .orderBy(desc(evaluations.createdAt))
    .limit(1);
  const drafted = content?.applicationAnswers ?? [];
  const draftFor = new Map(drafted.map((a) => [a.question.replace(/\s+/g, " ").trim().toLowerCase(), a]));
  // Every question the form asks, in its order, with the pack's draft where there is one;
  // then any drafted answer to a question only the posting text asked.
  const formRows = (form?.questions ?? []).map((q) => {
    const draft = draftFor.get(q.question.replace(/\s+/g, " ").trim().toLowerCase());
    return { question: q.question, answer: draft?.answer ?? "", why: draft?.why ?? null, kind: q.kind, options: q.options ?? null };
  });
  const inForm = new Set(formRows.map((r) => r.question.toLowerCase()));
  const extra = drafted
    .filter((a) => !inForm.has(a.question.replace(/\s+/g, " ").trim().toLowerCase()))
    .map((a) => ({ question: a.question, answer: a.answer, why: a.why ?? null, kind: "text" as const, options: null }));
  return {
    ...rest,
    prepPackId: opts.drafts === false ? null : (pack?.id ?? null),
    answers: [...formRows, ...extra],
    coverLetter: content?.coverLetter ?? null,
    coverLetterField: form?.coverLetter ?? null,
    payTarget: evaluation ? payTargetForPosting(await payContext(), evaluation.facts as Facts, location, form) : null,
    application: application ?? null,
    submission: application ? await submissionWithPin(db, application.id) : null,
  };
}

/** What was sent, with the date of the posting text it's pinned to ("as posted on 26 Sep"). */
async function submissionWithPin(db: Db, applicationId: number) {
  const submission = await getSubmission(db, applicationId);
  if (!submission) return null;
  const [snapshot] = submission.snapshotId
    ? await db.select({ capturedAt: postingSnapshots.capturedAt }).from(postingSnapshots).where(eq(postingSnapshots.id, submission.snapshotId))
    : [];
  return { ...submission, snapshotCapturedAt: snapshot?.capturedAt ?? null };
}

/**
 * The candidate's other applications at the posting's company, for "Applied
 * to another role". Undecided leads aren't applications yet. Imported tracker
 * rows have no company id, so they aren't offered (the skip checks the id).
 */
export async function companyApplications(db: Db, postingId: number) {
  const [p] = await db.select({ companyId: postings.companyId }).from(postings).where(eq(postings.id, postingId));
  if (!p) throw new Error(`posting ${postingId} not found`);
  return db
    .select({ id: applications.id, role: applications.role, stage: applications.stage, appliedOn: applications.appliedOn })
    .from(applications)
    .where(
      and(
        eq(applications.companyId, p.companyId),
        sql`${applications.postingId} is distinct from ${postingId}`,
        notInArray(applications.stage, ["lead", "shortlisted"]),
      ),
    )
    .orderBy(desc(sql`coalesce(${applications.appliedOn}, ${applications.updatedAt}::date)`));
}
