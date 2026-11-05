/** Reads for the tracker: the stats' input, the applications list, one application, and its call sheet. */
import { and, asc, desc, eq, inArray, notInArray, type SQL, sql } from "drizzle-orm";
import type { Facts } from "../agent/facts.ts";
import type { PrepPack } from "../agent/prep.ts";
import { PRE_APPLY_STAGES } from "../applications/constants.ts";
import { getSubmission } from "../applications/submission.ts";
import type { Db } from "../db/client.ts";
import {
  applicationAnswers,
  applicationEvents,
  applicationSubmissions,
  applications,
  companies,
  evaluations,
  outcomeProposals,
  postingSnapshots,
  postings,
  prepPacks,
} from "../db/schema.ts";
import { localDate } from "../lib/dates.ts";
import { tsMatch } from "../lib/search.ts";
import { progressOf, type StatsApp, type StatsEvent } from "./stats.ts";

/** The latest evaluation of an application's posting (correlated subquery, one row per application). */
const latestEvaluation = (column: SQL) =>
  sql`(select ${column} from ${evaluations} e where e.posting_id = ${applications.postingId} order by e.created_at desc limit 1)`;

/** The events that tell how far applications got (stage changes, replies), shaped for the stats. */
async function progressEvents(db: Db, applicationIds: number[]): Promise<StatsEvent[]> {
  if (!applicationIds.length) return [];
  return db
    .select({
      id: applicationEvents.id,
      applicationId: applicationEvents.applicationId,
      type: applicationEvents.type,
      toStage: applicationEvents.toStage,
      occurredOn: applicationEvents.occurredOn,
      inferred: sql<boolean>`coalesce((${applicationEvents.payload}->>'inferred')::boolean, false)`,
    })
    .from(applicationEvents)
    .where(and(inArray(applicationEvents.type, ["stage_changed", "email_reply"]), inArray(applicationEvents.applicationId, applicationIds)));
}

/** Applications and their events, shaped for computeTrackerStats. */
export async function statsInput(db: Db): Promise<{ apps: StatsApp[]; events: StatsEvent[] }> {
  const rows = await db
    .select({
      id: applications.id,
      company: applications.company,
      role: applications.role,
      stage: applications.stage,
      origin: applications.origin,
      channel: applications.channel,
      appliedOn: applications.appliedOn,
      ats: companies.ats,
      companySource: companies.source,
      fitScore: sql<number | null>`${latestEvaluation(sql`e.fit_score`)}`,
      remoteScope: sql<string | null>`${latestEvaluation(sql`e.facts->'remote'->>'scope'`)}`,
      eligibility: sql<string | null>`${latestEvaluation(sql`e.facts->'eligibility'->>'status'`)}`,
      submissionId: applicationSubmissions.id,
      coverLetter: applicationSubmissions.coverLetter,
    })
    .from(applications)
    .leftJoin(companies, eq(companies.id, applications.companyId))
    .leftJoin(applicationSubmissions, eq(applicationSubmissions.applicationId, applications.id))
    .where(notInArray(applications.stage, [...PRE_APPLY_STAGES]));

  const apps = rows.map(({ submissionId, coverLetter, ...r }) => ({
    ...r,
    hasSubmission: submissionId !== null,
    coverLetterSent: !!coverLetter?.trim(),
  }));
  if (!apps.length) return { apps, events: [] };

  const events = await progressEvents(
    db,
    apps.map((a) => a.id),
  );
  return { apps, events };
}

// ---------- the applications list ----------

const noReplyYet = sql`${applications.stage} in ('applied', 'no_response') and ${applications.firstResponseOn} is null`;
/** Days since the application went out (or the last contact), while no reply has come. */
const daysWaiting = () =>
  sql<number | null>`case when ${noReplyYet} then (${localDate()}::date - coalesce(${applications.lastContact}, ${applications.appliedOn})) end`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Where a search hit, per application: the row's own name first, then what was sent, then notes. */
function matchParts(q: string) {
  const like = `%${escapeLike(q)}%`;
  const company = sql<boolean>`(${applications.company} ilike ${like} or coalesce(${applications.role}, '') ilike ${like})`;
  const answers = sql<boolean>`exists (select 1 from ${applicationAnswers} x where x.application_id = ${applications.id} and ${tsMatch(sql`x.search`, q)})`;
  const letter = sql<boolean>`coalesce(${tsMatch(applicationSubmissions.search, q)}, false)`;
  const notes = sql<boolean>`exists (select 1 from ${applicationEvents} n where n.application_id = ${applications.id} and n.type = 'note' and n.payload->>'text' ilike ${like})`;
  return { company, answers, letter, notes };
}

// ---------- the pipeline ----------

/**
 * Every application (leads and skips aside), for the Pipeline's list grouped
 * by stage: with the next step, how long it's been quiet, and how far it got.
 * A search matches company and role, and the answers, letters and notes you
 * logged.
 */
export async function pipeline(db: Db, q?: string) {
  const m = q?.trim() ? matchParts(q.trim()) : null;
  const rows = await db
    .select({
      id: applications.id,
      company: applications.company,
      role: applications.role,
      stage: applications.stage,
      origin: applications.origin,
      channel: applications.channel,
      appliedOn: applications.appliedOn,
      firstResponseOn: applications.firstResponseOn,
      daysWaiting: daysWaiting(),
      rejectionReason: applications.rejectionReason,
      nextStepAt: applications.nextStepAt,
      nextStepKind: applications.nextStepKind,
      nextStepWith: applications.nextStepWith,
      postingId: applications.postingId,
    })
    .from(applications)
    .leftJoin(applicationSubmissions, eq(applicationSubmissions.applicationId, applications.id))
    .where(
      and(notInArray(applications.stage, [...PRE_APPLY_STAGES]), m ? sql`(${m.company} or ${m.answers} or ${m.letter} or ${m.notes})` : undefined),
    )
    .orderBy(sql`${applications.nextStepAt} asc nulls last`, sql`${applications.appliedOn} desc nulls last`, desc(applications.id));
  const events = Map.groupBy(
    await progressEvents(
      db,
      rows.map((r) => r.id),
    ),
    (e) => e.applicationId,
  );
  return rows.map((r) => ({ ...r, ...progressOf(r, events.get(r.id) ?? []) }));
}

/** Scheduled calls from now on, soonest first: Today's "Up next". */
export async function upcomingSteps(db: Db, limit = 3) {
  return db
    .select({
      applicationId: applications.id,
      company: applications.company,
      role: applications.role,
      stage: applications.stage,
      appliedOn: applications.appliedOn,
      firstResponseOn: applications.firstResponseOn,
      at: applications.nextStepAt,
      kind: applications.nextStepKind,
      with: applications.nextStepWith,
    })
    .from(applications)
    .where(sql`${applications.nextStepAt} >= now()`)
    .orderBy(asc(applications.nextStepAt))
    .limit(limit);
}

// ---------- one application ----------

export interface TalkingPoints {
  cvHeadline: string;
  summary: string;
  whyFit: string[];
  gaps: { gap: string; sayThis: string }[];
  whyUs: string[];
  askThem: string[];
}

const talkingPoints = (p: PrepPack): TalkingPoints => ({
  cvHeadline: p.cvHeadline,
  summary: p.summary,
  whyFit: p.whyFit.map((w) => w.text),
  gaps: p.gaps,
  whyUs: p.whyUs.map((w) => w.point),
  askThem: p.askThem,
});

const REMOTE_TEXT: Record<Facts["remote"]["scope"], string> = {
  worldwide: "Remote worldwide",
  europe: "Remote in Europe",
  specific_countries: "Remote in named countries",
  us_only: "US only",
  americas: "Americas only",
  onsite_or_hybrid: "Onsite or hybrid",
  unknown: "Remote scope unclear",
};

/** The role in one line: where it can be done from, eligibility, stack, seniority, pay. */
export function roleFactsLine(facts: Facts) {
  const parts: string[] = [];
  parts.push(`${REMOTE_TEXT[facts.remote.scope]}${facts.remote.regions.length ? ` (${facts.remote.regions.join(", ")})` : ""}`);
  parts.push(facts.eligibility.status === "unknown" ? "eligibility unclear" : `eligibility ${facts.eligibility.status}`);
  if (facts.office.requirement !== "none" && facts.office.requirement !== "unknown") {
    parts.push(`office ${facts.office.requirement.replace("_", " ")}${facts.office.location ? ` (${facts.office.location})` : ""}`);
  }
  if (facts.stack.primaryLanguages.length) parts.push(facts.stack.primaryLanguages.slice(0, 4).join("/"));
  if (facts.seniority !== "unknown") parts.push(facts.seniority.replace("_", " "));
  const p = facts.pay;
  if (p.min === null && p.max === null) parts.push("pay not stated");
  else {
    const n = (v: number | null) => (v === null ? "?" : v.toLocaleString("en"));
    parts.push(`${p.currency ?? ""} ${n(p.min)}–${n(p.max)}${p.period ? `/${p.period}` : ""}`.trim());
  }
  return parts.join(" · ");
}

/** Up to `max` verbatim lines from the posting worth rereading before a call. */
export function roleQuotes(facts: Facts, max = 3) {
  const quotes = [
    ...facts.whyFit.map((w) => w.quote),
    facts.stack.quote,
    facts.remote.quote,
    facts.eligibility.quote,
    facts.pay.quote,
    ...facts.gaps.map((g) => g.quote),
  ];
  return [...new Set(quotes.filter((q): q is string => !!q?.trim()))].slice(0, max);
}

/** Everything the application page shows. Null when there's no such application. */
export async function applicationDetail(db: Db, id: number) {
  const [app] = await db.select().from(applications).where(eq(applications.id, id));
  if (!app) return null;

  const [company] = app.companyId
    ? await db.select({ id: companies.id, name: companies.name, ats: companies.ats }).from(companies).where(eq(companies.id, app.companyId))
    : [];
  const [posting] = app.postingId
    ? await db
        .select({
          id: postings.id,
          title: postings.title,
          url: postings.url,
          location: postings.locationRaw,
          closedAt: postings.closedAt,
          descriptionText: postings.descriptionText,
        })
        .from(postings)
        .where(eq(postings.id, app.postingId))
    : [];
  const submission = await getSubmission(db, id);

  // The posting as it was when you applied: the submission's pinned snapshot, else today's text.
  let postingText: { text: string; pinned: boolean; capturedAt: Date | null } | null = null;
  if (submission?.snapshotId) {
    const [snap] = await db
      .select({ text: postingSnapshots.descriptionText, capturedAt: postingSnapshots.capturedAt })
      .from(postingSnapshots)
      .where(eq(postingSnapshots.id, submission.snapshotId));
    if (snap) postingText = { text: snap.text, pinned: true, capturedAt: snap.capturedAt };
  }
  if (!postingText && posting) postingText = { text: posting.descriptionText, pinned: false, capturedAt: null };

  const [evaluation] = app.postingId
    ? await db
        .select({ id: evaluations.id, fitScore: evaluations.fitScore, verdict: evaluations.verdict, facts: evaluations.facts })
        .from(evaluations)
        .where(eq(evaluations.postingId, app.postingId))
        .orderBy(desc(evaluations.createdAt))
        .limit(1)
    : [];
  const facts = (evaluation?.facts as Facts | undefined) ?? null;

  // The pack you applied with (pinned by the submission), else the posting's latest.
  const [pack] = submission?.prepPackId
    ? await db.select({ content: prepPacks.content }).from(prepPacks).where(eq(prepPacks.id, submission.prepPackId))
    : app.postingId
      ? await db
          .select({ content: prepPacks.content })
          .from(prepPacks)
          .where(eq(prepPacks.postingId, app.postingId))
          .orderBy(desc(prepPacks.createdAt))
          .limit(1)
      : [];

  const timeline = await db
    .select({
      id: applicationEvents.id,
      type: applicationEvents.type,
      fromStage: applicationEvents.fromStage,
      toStage: applicationEvents.toStage,
      occurredOn: applicationEvents.occurredOn,
      payload: applicationEvents.payload,
      source: applicationEvents.source,
      evidence: outcomeProposals.evidence,
    })
    .from(applicationEvents)
    .leftJoin(outcomeProposals, eq(outcomeProposals.id, applicationEvents.proposalId))
    .where(eq(applicationEvents.applicationId, id))
    .orderBy(desc(applicationEvents.occurredOn), desc(applicationEvents.id));

  const { descriptionText: _d, ...postingSummary } = posting ?? {};
  return {
    application: app,
    company: company ?? null,
    posting: posting ? (postingSummary as Omit<typeof posting, "descriptionText">) : null,
    postingText,
    evaluation: evaluation
      ? {
          fitScore: evaluation.fitScore,
          verdict: evaluation.verdict,
          eligibility: facts!.eligibility.status,
          remoteScope: facts!.remote.scope,
          factsLine: roleFactsLine(facts!),
          quotes: roleQuotes(facts!),
        }
      : null,
    talkingPoints: pack ? talkingPoints(pack.content as PrepPack) : null,
    timeline: timeline.map((e) => ({
      ...e,
      payload: e.payload as {
        inferred?: boolean;
        reason?: string;
        text?: string;
        context?: string;
        note?: string;
        from?: string;
        subject?: string;
        [k: string]: unknown;
      },
      evidence: e.evidence as { from?: string; subject?: string; date?: string; snippet?: string } | null,
    })),
    submission,
  };
}
