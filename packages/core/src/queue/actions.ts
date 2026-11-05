import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { Channel, IsoDate, isBehind, NEXT_STEP_KINDS, NOTE_CONTEXTS, type Origin, RESPONSE_STAGES, type Stage } from "../applications/constants.ts";
import { type Queryable, recordEvent, transition } from "../applications/events.ts";
import { SubmissionInput, saveSubmission } from "../applications/submission.ts";
import type { Db } from "../db/client.ts";
import { applicationEvents, applications, companies, evaluations, outcomeProposals, postings } from "../db/schema.ts";
import { localDate } from "../lib/dates.ts";
import { companyKeys } from "../screen/company-key.ts";

const SKIP_REASONS = [
  "not_eligible",
  "stack",
  "seniority",
  "pay",
  "not_interested",
  "company",
  /** Applied outside the app: recorded as a real application, not a skip. */
  "already_applied",
  /** Applied to a different role at the same company: not a wrong pick. */
  "applied_other_role",
] as const;
export const SkipReason = z.enum(SKIP_REASONS);
export type SkipReason = z.infer<typeof SkipReason>;

export const ApplyInput = z.object({
  appliedOn: IsoDate.optional(),
  channel: Channel.optional(),
  submission: SubmissionInput.optional(),
});
export type ApplyInput = z.infer<typeof ApplyInput>;

export const SkipExtra = z.object({
  appliedOn: IsoDate.optional(),
  channel: Channel.optional(),
  relatedApplicationId: z.number().int().optional(),
});
export type SkipExtra = z.infer<typeof SkipExtra>;

const today = () => localDate();

/**
 * Record the candidate's decision about a posting. One application row per
 * posting (unique posting_id), so changing your mind updates it, but only from
 * the stages in `from`: a decision never overwrites an application that's under
 * way. Returns the row and the stage it had before, for the caller to log.
 */
async function decide(q: Queryable, postingId: number, from: Stage[], values: Partial<typeof applications.$inferInsert> & { stage: Stage }) {
  const [p] = await q
    .select({
      companyId: companies.id,
      company: companies.name,
      ats: companies.ats,
      title: postings.title,
      url: postings.url,
      externalId: postings.externalId,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(eq(postings.id, postingId));
  if (!p) throw new Error(`posting ${postingId} not found`);

  const [prev] = await q.select({ id: applications.id, stage: applications.stage }).from(applications).where(eq(applications.postingId, postingId));
  if (prev && !from.includes(prev.stage)) throw new Error(`this posting is already "${prev.stage.replace("_", " ")}"; change it in the tracker`);

  const [row] = await q
    .insert(applications)
    .values({
      company: p.company,
      companyId: p.companyId,
      postingId,
      role: p.title,
      roleUrl: p.url,
      postingKey: `${p.ats}:${p.externalId.toLowerCase()}`,
      ...values,
    })
    .onConflictDoUpdate({ target: applications.postingId, set: { ...values, updatedAt: sql`now()` } })
    .returning({ id: applications.id });
  return { applicationId: row!.id, companyId: p.companyId, prevStage: prev?.stage ?? null };
}

async function logStage(q: Queryable, applicationId: number, from: Stage | null, to: Stage, on: string, payload: Record<string, unknown> = {}) {
  if (from === to) return;
  await recordEvent(q, { applicationId, type: "stage_changed", fromStage: from, toStage: to, occurredOn: on, payload, source: "queue" });
}

async function apply(q: Queryable, postingId: number, input: ApplyInput & { origin: Origin }) {
  const on = input.appliedOn ?? today();
  if (on > today()) throw new Error("the applied date can't be in the future");
  const d = await decide(q, postingId, ["lead", "shortlisted", "skipped", "applied"], {
    stage: "applied",
    appliedOn: on,
    lastContact: on,
    snoozedUntil: null,
    skipReason: null,
    relatedApplicationId: null,
    origin: input.origin,
    channel: input.channel ?? null,
  });
  await logStage(q, d.applicationId, d.prevStage, "applied", on, input.origin === "outside" ? { via: "already_applied" } : {});
  if (input.submission) await saveSubmission(q, d.applicationId, input.submission, { source: "queue" });
  return { applicationId: d.applicationId };
}

/** Applied through the queue, optionally with what was sent (answers, letter, salary). */
export async function markApplied(db: Db, postingId: number, input: ApplyInput = {}) {
  return db.transaction((tx) => apply(tx, postingId, { ...input, origin: "queue" }));
}

/**
 * Skip a role. "already_applied" records a real application made elsewhere;
 * "applied_other_role" links the application for the other role; "company"
 * also stops watching the company.
 */
export async function skip(db: Db, postingId: number, reason: SkipReason, extra: SkipExtra = {}) {
  if (reason === "already_applied") {
    return db.transaction((tx) => apply(tx, postingId, { appliedOn: extra.appliedOn, channel: extra.channel, origin: "outside" }));
  }
  return db.transaction(async (tx) => {
    const [posting] = await tx.select({ companyId: postings.companyId }).from(postings).where(eq(postings.id, postingId));
    if (!posting) throw new Error(`posting ${postingId} not found`);

    let relatedApplicationId: number | null = null;
    if (reason === "applied_other_role" && extra.relatedApplicationId !== undefined) {
      const [related] = await tx
        .select({ companyId: applications.companyId })
        .from(applications)
        .where(eq(applications.id, extra.relatedApplicationId));
      if (related?.companyId !== posting.companyId) throw new Error("that application is for a different company");
      relatedApplicationId = extra.relatedApplicationId;
    }

    let pausedCompany = false;
    if (reason === "company") {
      const paused = await tx
        .update(companies)
        .set({ status: "paused" })
        .where(and(eq(companies.id, posting.companyId), eq(companies.status, "active")))
        .returning({ id: companies.id });
      pausedCompany = paused.length > 0;
    }

    const d = await decide(tx, postingId, ["lead", "shortlisted", "skipped"], {
      stage: "skipped",
      skipReason: reason,
      snoozedUntil: null,
      relatedApplicationId,
    });
    await logStage(tx, d.applicationId, d.prevStage, "skipped", today(), { reason, ...(pausedCompany ? { pausedCompany } : {}) });
    return { applicationId: d.applicationId };
  });
}

/**
 * Yes to a lead: it leaves Decide and waits for an apply session, with its
 * prep pack drafted before other leads' (agent/prep.ts). Undo takes it back
 * to a lead; skipping it later still records why.
 */
export async function shortlist(db: Db, postingId: number) {
  await db.transaction(async (tx) => {
    // The apply session shows the evaluation's facts and pack: without one there's nothing to show.
    const [evaluated] = await tx.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.postingId, postingId)).limit(1);
    if (!evaluated) throw new Error("this posting hasn't been evaluated yet");
    const d = await decide(tx, postingId, ["lead"], { stage: "shortlisted", snoozedUntil: null });
    await logStage(tx, d.applicationId, d.prevStage, "shortlisted", today());
  });
}

export async function snooze(db: Db, postingId: number, until: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today()) throw new Error("snooze date must be a future YYYY-MM-DD");
  await db.transaction(async (tx) => {
    const d = await decide(tx, postingId, ["lead"], { stage: "lead", snoozedUntil: until });
    await recordEvent(tx, { applicationId: d.applicationId, type: "snoozed", occurredOn: today(), payload: { until }, source: "queue" });
  });
}

/**
 * Undo a decision: the posting goes back to the queue. Refused once the company
 * has replied. A skip that paused the company unpauses it.
 */
export async function reopen(db: Db, postingId: number) {
  await db.transaction(async (tx) => {
    const [app] = await tx.select().from(applications).where(eq(applications.postingId, postingId));
    if (!app) throw new Error("nothing to undo");
    if (!["skipped", "applied", "shortlisted", "lead"].includes(app.stage) || app.firstResponseOn) {
      throw new Error("the company has already replied; change the stage in the tracker instead");
    }
    if (app.stage === "skipped" && app.skipReason === "company" && app.companyId) {
      const [last] = await tx
        .select({ payload: applicationEvents.payload })
        .from(applicationEvents)
        .where(and(eq(applicationEvents.applicationId, app.id), eq(applicationEvents.toStage, "skipped")))
        .orderBy(desc(applicationEvents.id))
        .limit(1);
      if ((last?.payload as { pausedCompany?: boolean } | undefined)?.pausedCompany) {
        await tx.update(companies).set({ status: "active" }).where(eq(companies.id, app.companyId));
      }
    }
    const wasSnoozed = app.stage === "lead" && app.snoozedUntil !== null;
    await tx
      .update(applications)
      .set({
        stage: "lead",
        skipReason: null,
        snoozedUntil: null,
        appliedOn: null,
        lastContact: null,
        followedUpOn: null,
        relatedApplicationId: null,
        channel: null,
        origin: "queue",
        updatedAt: sql`now()`,
      })
      .where(eq(applications.id, app.id));
    if (app.stage !== "lead") await logStage(tx, app.id, app.stage, "lead", today(), { undo: true });
    // Lifting a snooze doesn't change the stage, so it's logged as a snooze that ended.
    else if (wasSnoozed)
      await recordEvent(tx, { applicationId: app.id, type: "snoozed", occurredOn: today(), payload: { until: null, undo: true }, source: "queue" });
  });
}

async function application(q: Queryable, applicationId: number) {
  const [app] = await q.select().from(applications).where(eq(applications.id, applicationId));
  if (!app) throw new Error(`application ${applicationId} not found`);
  return app;
}

export async function markFollowedUp(db: Db, applicationId: number) {
  await db.transaction(async (tx) => {
    await application(tx, applicationId);
    await tx
      .update(applications)
      .set({ followedUpOn: today(), lastContact: today(), updatedAt: sql`now()` })
      .where(eq(applications.id, applicationId));
    await recordEvent(tx, { applicationId, type: "followed_up", occurredOn: today(), source: "queue" });
  });
}

export async function dropApplication(db: Db, applicationId: number) {
  await db.transaction(async (tx) => {
    const app = await application(tx, applicationId);
    await transition(tx, app, "no_response", { on: today(), source: "queue" });
  });
}

/**
 * Stop watching the company that rejected the candidate, as the old pipeline did: its roles never reach the
 * queue again. Only a watched company is paused (not a discovered or no-feed one). Returns the ids it paused,
 * for the rejection's event: moving the application off rejected watches them again (resumeCompaniesOf).
 */
async function pauseCompanyOf(q: Queryable, app: { companyId: number | null; company: string }): Promise<number[]> {
  let ids = app.companyId ? [app.companyId] : [];
  if (!app.companyId) {
    // Imported tracker rows have no company id: match the company by name.
    const keys = new Set(companyKeys(app.company));
    const all = await q.select({ id: companies.id, name: companies.name, token: companies.boardToken }).from(companies);
    ids = all.filter((c) => [...companyKeys(c.name), ...(c.token ? companyKeys(c.token) : [])].some((k) => keys.has(k))).map((c) => c.id);
  }
  if (!ids.length) return [];
  const paused = await q
    .update(companies)
    .set({ status: "paused" })
    .where(and(inArray(companies.id, ids), eq(companies.status, "active")))
    .returning({ id: companies.id });
  return paused.map((c) => c.id);
}

/** Watch again the companies the application's rejection paused, if they're still paused: the rejection was a misread or a mistake. */
async function resumeCompaniesOf(q: Queryable, applicationId: number) {
  const [rejection] = await q
    .select({ payload: applicationEvents.payload })
    .from(applicationEvents)
    .where(
      and(eq(applicationEvents.applicationId, applicationId), eq(applicationEvents.type, "stage_changed"), eq(applicationEvents.toStage, "rejected")),
    )
    .orderBy(desc(applicationEvents.id))
    .limit(1);
  const ids = (rejection?.payload as { pausedCompanies?: number[] } | undefined)?.pausedCompanies ?? [];
  if (ids.length)
    await q
      .update(companies)
      .set({ status: "active" })
      .where(and(inArray(companies.id, ids), eq(companies.status, "paused")));
}

/** The columns that change with a stage the company moved the application to. */
function responseColumns(app: { firstResponseOn: string | null; outcome: string | null }, to: Stage, on: string) {
  const response = (RESPONSE_STAGES as readonly Stage[]).includes(to);
  return {
    ...(response ? { firstResponseOn: app.firstResponseOn ?? on, lastContact: on } : {}),
    outcome: to === "rejected" ? "Rejected" : app.outcome,
  };
}

/** Apply a reply proposal: the email is logged, then the stage changes as of the email's date. */
export async function acceptProposal(db: Db, proposalId: number) {
  await db.transaction(async (tx) => {
    // Claimed first, in one statement: two confirms at once (two tabs) can't both apply it.
    const [p] = await tx
      .update(outcomeProposals)
      .set({ status: "accepted", decidedAt: sql`now()` })
      .where(and(eq(outcomeProposals.id, proposalId), eq(outcomeProposals.status, "pending")))
      .returning();
    if (!p) throw new Error(`proposal ${proposalId} is not pending`);
    const app = await application(tx, p.applicationId);

    const evidence = p.evidence as { date?: string; from?: string; subject?: string };
    const replyDate = evidence.date && !Number.isNaN(Date.parse(evidence.date)) ? localDate(new Date(evidence.date)) : today();
    await recordEvent(tx, {
      applicationId: app.id,
      type: "email_reply",
      occurredOn: replyDate,
      payload: { from: evidence.from, subject: evidence.subject },
      source: "proposal",
      proposalId,
    });
    if (isBehind(p.proposedStage, app.stage)) {
      // An older reply confirmed late (the screening invite, after the rejection): logged as a past step, the stage stays.
      await recordEvent(tx, {
        applicationId: app.id,
        type: "stage_changed",
        fromStage: null,
        toStage: p.proposedStage,
        occurredOn: replyDate,
        payload: { past: true },
        source: "proposal",
        proposalId,
      });
    } else {
      const pausedCompanies = p.proposedStage === "rejected" && app.stage !== "rejected" ? await pauseCompanyOf(tx, app) : [];
      const changed = await transition(tx, app, p.proposedStage, {
        on: replyDate,
        source: "proposal",
        proposalId,
        payload: pausedCompanies.length ? { pausedCompanies } : {},
        set: {
          ...responseColumns(app, p.proposedStage, replyDate),
          // The email's own words are the first record of why; the candidate can rewrite it.
          ...(p.proposedStage === "rejected" && !app.rejectionReason
            ? { rejectionReason: (p.evidence as { snippet?: string }).snippet ?? null }
            : {}),
        },
      });
      if (!changed) {
        await tx
          .update(applications)
          .set({ ...responseColumns(app, p.proposedStage, replyDate), updatedAt: sql`now()` })
          .where(eq(applications.id, app.id));
      }
    }
  });
}

export async function dismissProposal(db: Db, proposalId: number) {
  // Only a pending one: a stale tab mustn't mark an accepted proposal dismissed while its events stay.
  const dismissed = await db
    .update(outcomeProposals)
    .set({ status: "dismissed", decidedAt: sql`now()` })
    .where(and(eq(outcomeProposals.id, proposalId), eq(outcomeProposals.status, "pending")))
    .returning({ id: outcomeProposals.id });
  if (!dismissed.length) throw new Error(`proposal ${proposalId} is not pending`);
}

/** Move an application by hand, from the tracker (a call booked by phone, an offer, a rejection seen elsewhere). */
export async function setStage(db: Db, applicationId: number, stage: Stage, opts: { on?: string; note?: string } = {}) {
  const on = opts.on ?? today();
  if (on > today()) throw new Error("the date can't be in the future");
  await db.transaction(async (tx) => {
    const app = await application(tx, applicationId);
    const pausedCompanies = stage === "rejected" && app.stage !== "rejected" ? await pauseCompanyOf(tx, app) : [];
    const changed = await transition(tx, app, stage, {
      on,
      source: "tracker",
      payload: { ...(opts.note ? { note: opts.note } : {}), ...(pausedCompanies.length ? { pausedCompanies } : {}) },
      set: {
        ...responseColumns(app, stage, on),
        ...(stage === "applied" && !app.appliedOn ? { appliedOn: on, lastContact: on } : {}),
        ...(stage === "rejected" && opts.note ? { rejectionReason: opts.note } : {}),
      },
    });
    if (changed && app.stage === "rejected") await resumeCompaniesOf(tx, app.id);
  });
}

/** Why the company said no, in the candidate's words (or corrected from the email's). */
export async function setRejectionReason(db: Db, applicationId: number, reason: string | null) {
  await application(db, applicationId);
  await db
    .update(applications)
    .set({ rejectionReason: reason?.trim() || null, updatedAt: sql`now()` })
    .where(eq(applications.id, applicationId));
}

/**
 * Record a step that happened but no email showed (a screening call, a
 * take-home): logged on its date, without moving the application's current
 * stage, so a rejected application still shows how far it got.
 */
export async function recordPastStep(db: Db, applicationId: number, stage: Stage, on: string, note?: string) {
  if (on > today()) throw new Error("the date can't be in the future");
  if (!(["screening", "interviewing", "offer"] as Stage[]).includes(stage)) throw new Error("a past step is screening, interviewing or offer");
  const app = await application(db, applicationId);
  if (app.appliedOn && on < app.appliedOn) throw new Error("that's before the application was sent");
  await recordEvent(db, {
    applicationId,
    type: "stage_changed",
    fromStage: null,
    toStage: stage,
    occurredOn: on,
    payload: { past: true, ...(note ? { note } : {}) },
    source: "tracker",
  });
}

export const NextStepInput = z
  .object({ at: z.iso.datetime(), kind: z.enum(NEXT_STEP_KINDS), with: z.string().trim().max(200).optional() })
  .nullable();
export type NextStepInput = z.infer<typeof NextStepInput>;

/** The next call or interview, set by hand (null clears it). A plan, not history, so it isn't logged as an event. */
export async function setNextStep(db: Db, applicationId: number, step: NextStepInput) {
  await application(db, applicationId);
  await db
    .update(applications)
    .set({
      nextStepAt: step ? new Date(step.at) : null,
      nextStepKind: step?.kind ?? null,
      nextStepWith: step?.with || null,
      updatedAt: sql`now()`,
    })
    .where(eq(applications.id, applicationId));
}

export const NoteInput = z.object({ text: z.string().trim().min(1), context: z.enum(NOTE_CONTEXTS).default("general") });

export async function addNote(db: Db, applicationId: number, text: string, context: (typeof NOTE_CONTEXTS)[number] = "general") {
  await application(db, applicationId);
  await recordEvent(db, { applicationId, type: "note", occurredOn: today(), payload: { text, context }, source: "tracker" });
}

/**
 * The candidate checked an "eligibility unclear" posting (asked them, or the
 * form lists their country) and it's open to them: it moves to Ready and gets a prep
 * pack. Stored on the posting, not the evaluation, so rescoring or a new text
 * version keeps it.
 */
export async function confirmEligibility(db: Db, postingId: number, note?: string | null) {
  const updated = await db
    .update(postings)
    .set({ eligibilityConfirmedAt: sql`now()`, eligibilityNote: note?.trim() || null })
    .where(eq(postings.id, postingId))
    .returning({ id: postings.id });
  if (!updated.length) throw new Error(`posting ${postingId} not found`);
}

/** Log or correct what was sent for an application that already exists. */
export async function updateSubmission(db: Db, applicationId: number, input: SubmissionInput) {
  await db.transaction(async (tx) => {
    await application(tx, applicationId);
    await saveSubmission(tx, applicationId, input, { source: "tracker" });
  });
}
