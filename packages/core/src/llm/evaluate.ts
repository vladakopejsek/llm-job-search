import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";
import { answerBankPath, readProfile } from "../agent/answer-bank.ts";
import { evaluationDrafts, recordAttempts } from "../agent/attempts.ts";
import { Facts } from "../agent/facts.ts";
import { submitEvaluations } from "../agent/submit.ts";
import type { QuoteWarning } from "../agent/verify.ts";
import { nextWork, type WorkItem } from "../agent/work.ts";
import { type CallContext, logged, promptVersion, type StepResult } from "./calls.ts";
import { inSpan, strictSchema } from "./client.ts";

const PROMPT = path.join(import.meta.dirname, "../agent/prompts/evaluation.md");
const SCHEMA = strictSchema(Facts);
const CONCURRENCY = 4;

/** The posting as the model reads it: what the app knows about it, then the text. */
export function postingMessage(item: Pick<WorkItem, "company" | "title" | "location" | "workplace" | "url" | "purpose" | "note" | "text">): string {
  return [
    `Company: ${item.company}`,
    `Title: ${item.title}`,
    `Location: ${item.location ?? "not given"}`,
    `Workplace: ${item.workplace ?? "not given"}`,
    `URL: ${item.url}`,
    `purpose: ${item.purpose}`,
    ...(item.note ? [`note: ${item.note}`] : []),
    "",
    "Posting text:",
    "",
    item.text,
  ].join("\n");
}

/** The downgrades the CLI reports to the skill, and the skill's rule: fix the quote, or leave it. */
function quoteRetryMessage(warnings: QuoteWarning[]): string {
  return [
    "Stored, but these quotes weren't found in the posting, so their claims were downgraded:",
    ...warnings.map((w) => `- ${w.field}${w.quote ? ` ${JSON.stringify(w.quote)}` : ""} (${w.problem}) → ${w.downgraded}`),
    "",
    "Return the facts again with each quote copied exactly from the posting text, not from the company, title, location or workplace lines. If you can't find the exact wording there, return the facts unchanged.",
  ].join("\n");
}

export function schemaRetryMessage(errors: string[]): string {
  return ["Nothing stored. Fix these fields and return the facts again:", ...errors.map((e) => `- ${e.replace(/^results\.0\.facts\./, "")}`)].join(
    "\n",
  );
}

/** The system prompt (rules, then the candidate's profile) and its version. The evals use it too. */
export async function evaluationPrompt(): Promise<{ system: string; version: string }> {
  const profile = readProfile(await readFile(answerBankPath(), "utf8"));
  if (!profile) throw new Error(`No ## Profile section in ${answerBankPath()}`);
  const system = `${await readFile(PROMPT, "utf8")}\n\n## Candidate profile\n\n${profile}`;
  return { system, version: promptVersion(system, SCHEMA) };
}

/** One evaluation request, exactly as production sends it, so an eval measures what ships. */
export function evaluationParams(
  model: string,
  system: string,
  messages: Anthropic.MessageParam[],
  effort: Anthropic.OutputConfig["effort"] = "medium",
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
    messages,
  };
}

/**
 * Evaluate the next postings, at most `limit` (plus 3 audit items, as in the skill), or the
 * next of only the postings `within` (no audit items).
 * One posting is one conversation: the facts as structured output, checked and stored
 * by the same code the CLI uses, and at most one retry turn for what the checks found.
 */
export async function evaluatePostings(ctx: CallContext, options: { limit: number; within?: number[] }): Promise<StepResult> {
  const { system, version } = await evaluationPrompt();

  // One call: nextWork is stateless, so a second one would hand back whatever isn't stored yet.
  const items = await nextWork(ctx.db, { limit: options.limit, audit: options.within ? 0 : 3, within: options.within });
  const limit = pLimit(CONCURRENCY);
  const results = await Promise.allSettled(
    items.map((item) =>
      limit(() =>
        inSpan(`evaluate posting ${item.postingId}`, { "session.id": `run-${ctx.runId}`, "job_search.posting_id": item.postingId }, () =>
          evaluatePosting(ctx, system, version, item),
        ),
      ),
    ),
  );
  // Settled first, so no call is still writing when the run finishes.
  const failure = results.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  const skipped = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  return { done: items.length - skipped.length, skipped };
}

/** Null when the evaluation is stored (with or without downgrades), otherwise why not. */
async function evaluatePosting(
  ctx: CallContext,
  system: string,
  version: string,
  item: WorkItem,
): Promise<{ postingId: number; reason: string } | null> {
  const { postingId, snapshotId } = item;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: postingMessage(item) }];
  let rejected: { facts: unknown; schema: boolean } | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await logged(ctx, { kind: "evaluation", postingId, promptVersion: version }, () =>
      ctx.client.messages.create(evaluationParams(ctx.model, system, messages)),
    );
    // A refusal or a cut-off isn't something the checks caught: llm_calls.stop_reason records it, agent_attempts doesn't.
    if (response.stop_reason !== "end_turn") return { postingId, reason: `stop_reason ${response.stop_reason}` };
    // Constrained decoding: a turn that ended normally is valid JSON for the schema.
    const facts: unknown = JSON.parse(response.content.find((b) => b.type === "text")?.text ?? "");

    // The same answer again: nothing to resubmit ("otherwise leave it").
    if (rejected && isDeepStrictEqual(facts, rejected.facts)) return rejected.schema ? { postingId, reason: "schema errors not fixed" } : null;

    const input = { results: [{ postingId, snapshotId, facts }] };
    const report = await submitEvaluations(ctx.db, input, ctx.runId);
    await recordAttempts(ctx.db, ctx.runId, "evaluation", evaluationDrafts(input, report));
    const outcome = report.outcomes[0];
    if (outcome?.status === "error") return { postingId, reason: outcome.error };

    const schema = report.schemaErrors.length > 0;
    const retry = schema ? schemaRetryMessage(report.schemaErrors) : outcome?.warnings.length ? quoteRetryMessage(outcome.warnings) : null;
    if (!retry) return null;
    // A retry with schema errors stores nothing, so a first answer that was stored (with quote warnings) stands.
    if (attempt === 2) return schema && rejected?.schema ? { postingId, reason: "schema errors not fixed" } : null;
    rejected = { facts, schema };
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: retry });
  }
  return null;
}
