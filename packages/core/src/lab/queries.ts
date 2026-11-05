/** Everything the Lab shows: the tool measuring itself, by the definitions in docs/metrics.md. */
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { runAttemptStats } from "../agent/attempts.ts";
import type { RunSummary as AgentRunStats } from "../agent/runs.ts";
import type { RunSummary as CollectRunStats } from "../collect/run.ts";
import type { Db } from "../db/client.ts";
import { agentRuns, applicationAnswers, applicationSubmissions, collectRuns } from "../db/schema.ts";
import { pickFeedback } from "../queue/queries.ts";
import { timingSummary } from "../queue/timing.ts";
import { rewriteSummary } from "./rewrite-share.ts";

/** Runs shown, newest first. */
const RUNS_SHOWN = 14;

/**
 * The latest evaluation and Draft packs runs (not /replies): what the agent evaluated or drafted,
 * and for an evaluation run the collect run that fed it (the last one started up to 6 hours before).
 */
async function recentRuns(db: Db) {
  const collect = db
    .select({ stats: collectRuns.stats })
    .from(collectRuns)
    .where(and(lte(collectRuns.startedAt, agentRuns.startedAt), gte(collectRuns.startedAt, sql`${agentRuns.startedAt} - interval '6 hours'`)))
    .orderBy(desc(collectRuns.startedAt))
    .limit(1)
    .as("collect");
  const rows = await db
    .select({ id: agentRuns.id, startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt, stats: agentRuns.stats, collect: collect.stats })
    .from(agentRuns)
    .leftJoinLateral(collect, sql`${agentRuns.kind} = 'evaluate'`)
    .where(inArray(agentRuns.kind, ["evaluate", "prep"]))
    .orderBy(desc(agentRuns.id))
    .limit(RUNS_SHOWN);
  return rows.map((r) => {
    const stats = r.stats as Omit<AgentRunStats, "runId"> | null;
    const collected = r.collect as Omit<CollectRunStats, "runId" | "results"> | null;
    return {
      id: r.id,
      startedAt: r.startedAt,
      minutes: r.finishedAt ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 60_000) : null,
      read: collected?.postings.seen ?? null,
      newPostings: collected?.postings.new ?? null,
      evaluated: stats ? Object.values(stats.evaluated).reduce((sum, n) => sum + n, 0) : null,
      leads: stats ? (stats.evaluated["queue:lead"] ?? 0) : null,
      packs: stats?.prepPacks ?? null,
      feedErrors: stats?.collectErrors.length ?? collected?.companies.error ?? null,
      /** API spend; null for runs on the subscription. */
      costUsd: stats?.cost?.usd ?? null,
    };
  });
}

/** Answers and letters sent from a pinned prep pack (the no-pack arm pins none, so it's left out). */
async function draftRewrites(db: Db) {
  const fromPack = sql`${applicationSubmissions.prepPackId} is not null`;
  const [answers, letters] = await Promise.all([
    db
      .select({ draft: applicationAnswers.draftedAnswer, sent: applicationAnswers.answer })
      .from(applicationAnswers)
      .innerJoin(applicationSubmissions, eq(applicationSubmissions.applicationId, applicationAnswers.applicationId))
      .where(and(isNotNull(applicationAnswers.draftedAnswer), fromPack)),
    db
      .select({ draft: applicationSubmissions.draftedCoverLetter, sent: applicationSubmissions.coverLetter })
      .from(applicationSubmissions)
      .where(and(isNotNull(applicationSubmissions.draftedCoverLetter), isNotNull(applicationSubmissions.coverLetter), fromPack)),
  ]);
  const pairs = (rows: { draft: string | null; sent: string | null }[]) => rows.map((r) => ({ draft: r.draft ?? "", sent: r.sent ?? "" }));
  return { answers: rewriteSummary(pairs(answers)), letters: rewriteSummary(pairs(letters)) };
}

export async function labData(db: Db) {
  const [picks, timing, checks, rewrites, runs] = await Promise.all([
    pickFeedback(db),
    timingSummary(db, null),
    runAttemptStats(db, null),
    draftRewrites(db),
    recentRuns(db),
  ]);
  return { picks, timing, checks, rewrites, runs };
}
