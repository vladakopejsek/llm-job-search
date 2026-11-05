/**
 * Right after each collect: the model reads the postings first seen since a moment,
 * chosen as the daily run chooses (triage, one evaluation per role, most promising
 * first). Prints a notification for the ones that reached the decide queue, a title
 * line and a body line, or nothing when none did. On the API, or with
 * `/daily-run new <ids>` on the subscription when there's no key or credit.
 *
 *   pnpm fresh --since 2026-10-26T06:30:00+01:00
 */
import { parseArgs } from "node:util";
import { and, eq, gte, isNull } from "drizzle-orm";
import { finishRun, formatSummary, startRun } from "../agent/runs.ts";
import { createDb } from "../db/client.ts";
import { companies, postings } from "../db/schema.ts";
import { apiUsable, createClient, MODEL, startTracing } from "../llm/client.ts";
import { evaluatePostings } from "../llm/evaluate.ts";
import { onSubscription } from "../llm/subscription.ts";
import { decideQueue } from "../queue/queries.ts";

const { values } = parseArgs({ options: { since: { type: "string" } } });
const since = new Date(values.since ?? "");
if (Number.isNaN(since.getTime())) throw new Error("--since <ISO time> is required");

const SHOWN = 3;
/**
 * A collect brings 10–20 postings; a company promoted with a big board can bring hundreds, and the rest wait
 * for the daily run. The skill's `new` mode has the same limit.
 */
const LIMIT = 60;
/** A runaway guard: an evaluation costs about $0.03. */
const MAX_USD = 3;

const { db, close } = createDb();

async function readOnApi(ids: number[]) {
  const tracing = startTracing();
  const runId = await startRun(db);
  try {
    const ctx = { client: createClient(), db, runId, model: MODEL, budget: { max: MAX_USD, spent: 0 } };
    await evaluatePostings(ctx, { limit: LIMIT, within: ids });
  } finally {
    // To stderr, so the summary stays out of the notification on stdout.
    console.error(formatSummary(await finishRun(db, runId)).join("\n"));
    await tracing?.shutdown();
  }
}

try {
  const fresh = await db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(and(gte(postings.firstSeenAt, since), isNull(postings.closedAt), eq(companies.status, "active"), eq(postings.screenStatus, "pass")));

  const ids = fresh.map((p) => p.id);
  if (ids.length) {
    try {
      if (await apiUsable()) await readOnApi(ids);
      // To stderr, like the run summary: it stays out of the notification.
      else console.error(await onSubscription(`/daily-run new ${ids.join(",")}`, 45));
    } catch (error) {
      // What was stored before the failure still reaches the queue and the notification; exit 1 reports the failure.
      console.error(`evaluate failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }

    const queued = (await decideQueue(db)).filter((i) => ids.includes(i.postingId));
    if (queued.length) {
      console.log(`${queued.length} new role${queued.length === 1 ? "" : "s"} to decide`);
      const more = queued.length > SHOWN ? ` · +${queued.length - SHOWN} more` : "";
      console.log(
        queued
          .slice(0, SHOWN)
          .map((r) => `${r.company}: ${r.title.trim()}`)
          .join(" · ") + more,
      );
    }
  }
} finally {
  await close();
}
