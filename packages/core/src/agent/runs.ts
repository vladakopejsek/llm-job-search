import { execFileSync } from "node:child_process";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { agentRuns, collectRuns, companies, companyFetches, evaluations, llmCalls, outcomeProposals, postings, prepPacks } from "../db/schema.ts";
import { type AttemptStats, runAttemptStats } from "./attempts.ts";

function gitVersion(): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

/** agent_runs.kind. Today's status line shows "evaluate" runs; the Lab lists "evaluate" and "prep" ones. */
export const RUN_KINDS = ["evaluate", "prep", "replies"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export async function startRun(db: Db, kind: RunKind = "evaluate"): Promise<number> {
  const [run] = await db.insert(agentRuns).values({ gitSha: gitVersion(), kind }).returning({ id: agentRuns.id });
  if (!run) throw new Error("Could not create an agent run");
  return run.id;
}

export interface RunSummary {
  runId: number;
  evaluated: Record<string, number>;
  quoteWarnings: number;
  /** Screen-rejected postings the agent judged to be leads: candidates for a rule fix. */
  auditLeads: { company: string; title: string; postingId: number }[];
  prepPacks: number;
  proposals: number;
  /** Every submission this run, including what code rejected. */
  attempts: AttemptStats;
  collectErrors: string[];
  /** API spend (src/llm/calls.ts). Absent for runs that made no API calls, such as the subscription skill's. */
  cost?: { usd: number; calls: number };
}

export async function finishRun(db: Db, runId: number): Promise<RunSummary> {
  const evals = await db
    .select({ verdict: evaluations.verdict, purpose: evaluations.purpose, warnings: evaluations.warnings, postingId: evaluations.postingId })
    .from(evaluations)
    .where(eq(evaluations.runId, runId));

  const evaluated: Record<string, number> = {};
  for (const e of evals) evaluated[`${e.purpose}:${e.verdict}`] = (evaluated[`${e.purpose}:${e.verdict}`] ?? 0) + 1;

  const auditLeadIds = evals.filter((e) => e.purpose === "audit" && e.verdict === "lead").map((e) => e.postingId);
  const auditLeads = auditLeadIds.length
    ? await db
        .select({ company: companies.name, title: postings.title, postingId: postings.id })
        .from(postings)
        .innerJoin(companies, eq(companies.id, postings.companyId))
        .where(inArray(postings.id, auditLeadIds))
    : [];

  const [packs] = await db.select({ n: sql<number>`count(*)::int` }).from(prepPacks).where(eq(prepPacks.runId, runId));
  const [props] = await db.select({ n: sql<number>`count(*)::int` }).from(outcomeProposals).where(eq(outcomeProposals.runId, runId));

  const [lastCollect] = await db.select({ id: collectRuns.id }).from(collectRuns).orderBy(desc(collectRuns.id)).limit(1);
  const collectErrors = lastCollect
    ? (
        await db
          .select({ company: companies.name, error: companyFetches.error })
          .from(companyFetches)
          .innerJoin(companies, eq(companies.id, companyFetches.companyId))
          .where(and(eq(companyFetches.runId, lastCollect.id), eq(companyFetches.status, "error")))
      ).map((e) => `${e.company}: ${e.error?.split("\n")[0]}`)
    : [];

  const [api] = await db
    .select({ usd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)::float8`, calls: sql<number>`count(*)::int` })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId));

  const summary: RunSummary = {
    runId,
    evaluated,
    quoteWarnings: evals.reduce((n, e) => n + ((e.warnings as unknown[]) ?? []).length, 0),
    auditLeads,
    prepPacks: packs?.n ?? 0,
    proposals: props?.n ?? 0,
    attempts: await runAttemptStats(db, runId),
    collectErrors,
    ...(api?.calls ? { cost: { usd: api.usd, calls: api.calls } } : {}),
  };
  const { runId: _, ...stats } = summary;
  await db.update(agentRuns).set({ finishedAt: new Date(), stats }).where(eq(agentRuns.id, runId));
  return summary;
}

/** The run summary as both CLIs print it. */
export function formatSummary(s: RunSummary): string[] {
  const lines = [
    `Run ${s.runId} finished.`,
    `  evaluated: ${JSON.stringify(s.evaluated)}`,
    `  quote warnings: ${s.quoteWarnings} · prep packs: ${s.prepPacks} · reply proposals: ${s.proposals}`,
  ];
  if (s.cost) lines.push(`  API: $${s.cost.usd.toFixed(2)} in ${s.cost.calls} calls`);
  const a = s.attempts;
  if (a.attempts) {
    lines.push(
      `  submissions: ${a.attempts} for ${a.items} items · clean first time: ${a.firstTryClean} · fixed on retry: ${a.fixedOnRetry} · never stored: ${a.neverStored}${a.fileErrors ? ` · file errors: ${a.fileErrors}` : ""}`,
    );
    const caught = Object.entries(a.problemsByCode).sort((x, y) => y[1] - x[1]);
    if (caught.length) lines.push(`  caught by the checks: ${caught.map(([code, n]) => `${code} ${n}`).join(", ")}`);
  }
  if (s.auditLeads.length) {
    lines.push("  screen-rejected postings judged as leads (a rule may be too strict):");
    for (const l of s.auditLeads) lines.push(`    ${l.company}: ${l.title} (posting ${l.postingId})`);
  }
  if (s.collectErrors.length) lines.push(`  feed errors: ${s.collectErrors.join(" | ")}`);
  return lines;
}
