/**
 * The daily run on the Anthropic API: code orchestrates, the model only reads and writes
 * (docs/api-runner.md). The /daily-run skill is the subscription fallback and follows this
 * file's limits and step order. Each collect reads its own new postings (cli/fresh.ts) and the
 * Gmail replies (the /replies skill), so this run works through the backlog; prep packs are
 * drafted on demand, from the app.
 *
 *   pnpm daily-run                                       collect, up to 75 evaluations
 *   pnpm daily-run backfill                              up to 100
 *   pnpm daily-run --evaluations 2 --skip-collect        a small test run
 *   pnpm daily-run --model claude-haiku-5-5              another model (it needs prices in src/llm/calls.ts)
 *
 * A failed step is noted and the run goes on; the exit code is 1 if any step failed, so a
 * scheduler can alert on it. Without a usable API (no key, or no credit left) it exits 3
 * before doing anything, so the scheduler can run the /daily-run skill on the subscription instead.
 */
import { parseArgs } from "node:util";
import { finishRun, formatSummary, startRun } from "../agent/runs.ts";
import { runCollect } from "../collect/run.ts";
import { createDb } from "../db/client.ts";
import { autoPromote } from "../discover/run.ts";
import { type CallContext, PRICES, type StepResult } from "../llm/calls.ts";
import { apiUsable, createClient, MODEL, startTracing } from "../llm/client.ts";
import { evaluatePostings } from "../llm/evaluate.ts";
import { screenOpenPostings } from "../screen/run.ts";

const LIMITS = { scheduled: 75, backfill: 100 };
/** A runaway guard, not a target: a scheduled run costs about $2 and a backfill about $3. */
const MAX_USD = 20;

const { values, positionals } = parseArgs({
  options: {
    evaluations: { type: "string" },
    model: { type: "string", default: MODEL },
    "skip-collect": { type: "boolean" },
  },
  allowPositionals: true,
});
const backfill = positionals[0] === "backfill";
const evaluations = Number(values.evaluations ?? (backfill ? LIMITS.backfill : LIMITS.scheduled));
if (!PRICES[values.model]) throw new Error(`No prices for ${values.model} in src/llm/calls.ts, so its cost can't be tracked`);

const failures: string[] = [];

/** Runs one step. A failure is noted and the run goes on, as the skill's "note it and continue". */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`${name} failed: ${message}`);
    return undefined;
  }
}

function report(name: string, result: StepResult | undefined) {
  if (!result) return;
  console.log(`${name}: ${result.done} done${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`);
  for (const s of result.skipped) console.log(`  posting ${s.postingId}: ${s.reason}`);
}

if (!(await apiUsable())) {
  console.log("No API key or no API credit: nothing done, the subscription runs this one (exit 3).");
  process.exit(3);
}

const tracing = startTracing();
const { db, close } = createDb();
try {
  if (!values["skip-collect"]) {
    await step("collect", async () => {
      const s = await runCollect(db);
      await screenOpenPostings(db);
      console.log(
        `Collected in ${Math.round(s.durationMs / 1000)} s: ${s.postings.new} new, ${s.postings.changed} changed, ${s.companies.error} feed errors`,
      );
    });
    await step("discover", async () => {
      const result = await autoPromote(db);
      console.log(result ? `Auto-promoted ${result.promoted.length}: ${result.promoted.join(", ") || "none"}` : "Discover: done this week already");
    });
  }

  // After collecting: the Lab pairs each run with the collect run that started just before it.
  const runId = await startRun(db);
  console.log(`Run ${runId} (${values.model})`);
  try {
    const ctx: CallContext = { client: createClient(), db, runId, model: values.model, budget: { max: MAX_USD, spent: 0 } };
    if (evaluations) report("evaluate", await step("evaluate", () => evaluatePostings(ctx, { limit: evaluations })));
  } finally {
    console.log(formatSummary(await finishRun(db, runId)).join("\n"));
  }
} finally {
  await tracing?.shutdown();
  await close();
}

if (failures.length) {
  console.log(`\nFailed steps:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exitCode = 1;
}
