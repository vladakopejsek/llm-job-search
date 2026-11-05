/**
 * The attempt log: every file the agent submits, including what code rejected.
 * The submit functions keep only what passed; this keeps the history, so a run
 * can say how often the checks caught the model and what for.
 *
 * Mapping a report to rows and summarising rows are pure, so both are tested
 * without a database. Only `recordAttempts` and `runAttemptStats` touch it.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { agentAttempts } from "../db/schema.ts";
import type { SubmitReport } from "./submit.ts";

export type ProblemCode =
  // The file or an item doesn't match the schema.
  | "schema"
  | "bad_json"
  // Evaluations: a quote wasn't found in the posting (the claim is downgraded, the rest stored).
  | "quote_not_found"
  | "quote_missing"
  | "snapshot_mismatch"
  // Prep packs: any of these and the pack isn't stored.
  | "no_citation"
  | "unknown_fact_id"
  | "bad_source_file"
  | "source_quote_not_found"
  | "posting_quote_not_found"
  | "question_mismatch"
  | "unanswered_question"
  | "choice_invalid"
  | "over_length"
  | "cover_letter_unexpected"
  | "cover_letter_missing"
  | "placeholder"
  | "banned_phrase"
  | "no_lead_evaluation"
  // Prep packs on the API runner: the judge found a claim nothing in the Answer bank backs (first submit only).
  | "unsupported_claim"
  // Reply proposals the app skipped (application not found, already at that stage, already proposed).
  | "outcome_skipped";

export interface Problem {
  code: ProblemCode;
  /** Exactly what the agent is shown. */
  message: string;
}

export type AttemptKind = "evaluation" | "prep" | "outcomes";
type AttemptStatus = "stored" | "stored_with_warnings" | "rejected" | "schema_error" | "bad_json";

/** One row to log, before it's numbered. */
export interface AttemptDraft {
  postingId: number | null;
  status: AttemptStatus;
  problems: Problem[];
}

type PrepReport = {
  schemaErrors: string[];
  outcomes: ({ postingId: number; status: "stored" } | { postingId: number; status: "error"; problems: Problem[] })[];
};
type OutcomesReport = { schemaErrors: string[]; stored: number; skipped: string[] };

/**
 * Schema errors, split by the item they're about. `formatIssues` writes paths
 * like "results.2.facts.eligibility: …"; the posting id is read from that item of
 * the raw input when it's a number. Errors outside any item stay with the file.
 * The whole file was rejected, so valid items get no row: nothing happened to them.
 */
export function schemaErrorDrafts(input: unknown, listKey: "results" | "packs", errors: string[]): AttemptDraft[] {
  const items = (input as Record<string, unknown> | null)?.[listKey];
  const byPosting = new Map<number | null, Problem[]>();
  for (const message of errors) {
    const index = new RegExp(`^${listKey}\\.(\\d+)\\b`).exec(message)?.[1];
    const id = index !== undefined && Array.isArray(items) ? (items[Number(index)] as { postingId?: unknown } | undefined)?.postingId : undefined;
    const key = Number.isInteger(id) ? (id as number) : null;
    byPosting.set(key, [...(byPosting.get(key) ?? []), { code: "schema", message }]);
  }
  return [...byPosting].map(([postingId, problems]) => ({ postingId, status: "schema_error", problems }));
}

export function evaluationDrafts(input: unknown, report: SubmitReport): AttemptDraft[] {
  if (report.schemaErrors.length) return schemaErrorDrafts(input, "results", report.schemaErrors);
  return report.outcomes.map((o) => {
    if (o.status === "error") return { postingId: o.postingId, status: "rejected", problems: [{ code: "snapshot_mismatch", message: o.error }] };
    const problems = o.warnings.map(
      (w): Problem => ({
        code: w.problem === "missing" ? "quote_missing" : "quote_not_found",
        message: `quote ${w.problem}: ${w.field} ${w.quote ? JSON.stringify(w.quote) : ""} → ${w.downgraded}`,
      }),
    );
    return { postingId: o.postingId, status: problems.length ? "stored_with_warnings" : "stored", problems };
  });
}

export function prepDrafts(input: unknown, report: PrepReport): AttemptDraft[] {
  if (report.schemaErrors.length) return schemaErrorDrafts(input, "packs", report.schemaErrors);
  return report.outcomes.map((o) =>
    o.status === "stored"
      ? { postingId: o.postingId, status: "stored", problems: [] }
      : { postingId: o.postingId, status: "rejected", problems: o.problems },
  );
}

/** Reply proposals aren't about postings: one row for the file. */
export function outcomeDrafts(report: OutcomesReport): AttemptDraft[] {
  if (report.schemaErrors.length)
    return [{ postingId: null, status: "schema_error", problems: report.schemaErrors.map((message) => ({ code: "schema", message })) }];
  return [{ postingId: null, status: "stored", problems: report.skipped.map((message) => ({ code: "outcome_skipped", message })) }];
}

export const badJsonDraft = (message: string): AttemptDraft[] => [{ postingId: null, status: "bad_json", problems: [{ code: "bad_json", message }] }];

/**
 * Keeps a row small whatever the model sent, so one runaway file can't bloat
 * the database. A quote can be a whole paragraph, and a malformed file can raise
 * hundreds of schema errors; counting the problems needs the codes, not every word.
 */
export const MAX_MESSAGE_CHARS = 300;
export const MAX_PROBLEMS_PER_ROW = 20;

/** A stored problem; `count` > 1 stands for problems of that code whose messages weren't kept. */
export type StoredProblem = Problem & { count?: number };

export function capProblems(problems: Problem[]): StoredProblem[] {
  const kept: StoredProblem[] = problems.slice(0, MAX_PROBLEMS_PER_ROW).map((p) => ({
    code: p.code,
    message: p.message.length > MAX_MESSAGE_CHARS ? `${p.message.slice(0, MAX_MESSAGE_CHARS - 1)}…` : p.message,
  }));
  // The rest become one entry per code, so the counts stay exact and the row stays bounded.
  const rest = new Map<ProblemCode, number>();
  for (const p of problems.slice(MAX_PROBLEMS_PER_ROW)) rest.set(p.code, (rest.get(p.code) ?? 0) + 1);
  return [...kept, ...[...rest].map(([code, count]) => ({ code, message: `and ${count} more`, count }))];
}

/** Number each draft after the attempts already logged for the same posting (or file) in this run. */
export function numberAttempts(drafts: AttemptDraft[], prior: ReadonlyMap<number | null, number>) {
  const seen = new Map(prior);
  return drafts.map((d) => {
    const attempt = (seen.get(d.postingId) ?? 0) + 1;
    seen.set(d.postingId, attempt);
    return { ...d, attempt };
  });
}

/**
 * Log a submission. Never throws: the log must not change what the agent is
 * told or the exit code it gets, so a failure is only reported on stderr.
 */
export async function recordAttempts(db: Db, runId: number | null, kind: AttemptKind, drafts: AttemptDraft[]) {
  if (!drafts.length) return;
  try {
    const prior = await db
      .select({ postingId: agentAttempts.postingId, n: sql<number>`max(${agentAttempts.attempt})::int` })
      .from(agentAttempts)
      .where(and(runId === null ? sql`${agentAttempts.runId} is null` : eq(agentAttempts.runId, runId), eq(agentAttempts.kind, kind)))
      .groupBy(agentAttempts.postingId);
    const numbered = numberAttempts(drafts, new Map(prior.map((p) => [p.postingId, p.n])));
    await db.insert(agentAttempts).values(numbered.map((d) => ({ runId, kind, ...d, problems: capProblems(d.problems) })));
  } catch (error) {
    console.error(`(attempt log not written: ${String(error instanceof Error ? (error.cause ?? error.message) : error).split("\n")[0]})`);
  }
}

export interface AttemptRow {
  /** Attempt numbers restart in each run, so an item is a posting within one run. */
  runId?: number | null;
  kind: string;
  postingId: number | null;
  attempt: number;
  status: string;
  problems: StoredProblem[];
}

export interface AttemptStats {
  /** Rows logged: every submission of every item, plus whole-file failures. */
  attempts: number;
  /** Distinct (run, kind, posting) items submitted. */
  items: number;
  /** Items whose first attempt was stored with no problem at all. */
  firstTryClean: number;
  /** Items whose first attempt had problems and a later one was stored clean. */
  fixedOnRetry: number;
  /** Items never stored in this run: every attempt was rejected. */
  neverStored: number;
  /** Unreadable files and schema errors not tied to an item. */
  fileErrors: number;
  /** Every problem code the checks raised, over all attempts. */
  problemsByCode: Record<string, number>;
}

const STORED = new Set(["stored", "stored_with_warnings"]);

export function attemptStats(rows: readonly AttemptRow[]): AttemptStats {
  const problemsByCode: Record<string, number> = {};
  for (const r of rows) for (const p of r.problems) problemsByCode[p.code] = (problemsByCode[p.code] ?? 0) + (p.count ?? 1);

  const byItem = new Map<string, AttemptRow[]>();
  let fileErrors = 0;
  for (const r of rows) {
    // Reply proposals have no posting; their file row is counted as an attempt only.
    if (r.postingId === null) {
      if (r.status === "bad_json" || r.status === "schema_error") fileErrors++;
      continue;
    }
    const key = `${r.runId ?? ""}:${r.kind}:${r.postingId}`;
    byItem.set(key, [...(byItem.get(key) ?? []), r]);
  }

  let firstTryClean = 0;
  let fixedOnRetry = 0;
  let neverStored = 0;
  for (const attempts of byItem.values()) {
    const sorted = [...attempts].sort((a, b) => a.attempt - b.attempt);
    const first = sorted[0]!;
    if (first.status === "stored" && !first.problems.length) firstTryClean++;
    else if (sorted.slice(1).some((a) => a.status === "stored" && !a.problems.length)) fixedOnRetry++;
    if (!sorted.some((a) => STORED.has(a.status))) neverStored++;
  }
  return { attempts: rows.length, items: byItem.size, firstTryClean, fixedOnRetry, neverStored, fileErrors, problemsByCode };
}

/** What the checks caught in one run, or (runId null) across every run: the Lab. */
export async function runAttemptStats(db: Db, runId: number | null): Promise<AttemptStats> {
  const rows = await db
    .select({
      runId: agentAttempts.runId,
      kind: agentAttempts.kind,
      postingId: agentAttempts.postingId,
      attempt: agentAttempts.attempt,
      status: agentAttempts.status,
      problems: agentAttempts.problems,
    })
    .from(agentAttempts)
    .where(runId === null ? undefined : eq(agentAttempts.runId, runId));
  return attemptStats(rows.map((r) => ({ ...r, problems: r.problems as StoredProblem[] })));
}
