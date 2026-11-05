import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/client.ts";
import { llmCalls } from "../db/schema.ts";

/**
 * USD per million tokens, from the pricing page on 2026-10-29. Cache writes cost 1.25×
 * input for a 5-minute entry and 2× for a 1-hour one. The Batch API halves all of it.
 */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const WEB_SEARCH_USD = 0.01;

/** What one response cost. `input_tokens` is only the uncached part of the prompt. */
export function costUsd(model: string, usage: Anthropic.Usage): number {
  const price = PRICES[model];
  if (!price) throw new Error(`No prices for ${model}: add them to PRICES in src/llm/calls.ts`);
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  // Haiku 5.5 costs 5× for prompts over 100k tokens, cache included.
  const tier = model === "claude-haiku-5-5" && usage.input_tokens + write5m + write1h + read > 100_000 ? 5 : 1;
  const tokens =
    usage.input_tokens * price.input +
    write5m * price.input * 1.25 +
    write1h * price.input * 2 +
    read * price.cacheRead +
    usage.output_tokens * price.output;
  return (tier * tokens) / 1e6 + (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

/** Which prompt produced a call: the system prompt plus the output schema or tools, whose descriptions are instructions too. */
export function promptVersion(system: string, schemaOrTools: unknown): string {
  return createHash("sha256").update(system).update(JSON.stringify(schemaOrTools)).digest("hex").slice(0, 12);
}

export interface CallContext {
  client: Anthropic;
  db: Db;
  runId: number;
  model: string;
  /** In USD. No call starts once `spent` reaches `max`. */
  budget: { max: number; spent: number };
}

/** What a step did: how many postings it finished, and the ones it gave up on and why. */
export interface StepResult {
  done: number;
  skipped: { postingId: number; reason: string }[];
}

class BudgetExceeded extends Error {}

/**
 * Every API call goes through here. It refuses to start once the budget is spent, then
 * prices the response, adds it to the budget and logs it to llm_calls. Logging never
 * throws: losing a row is better than losing the result.
 */
export async function logged(
  ctx: Pick<CallContext, "db" | "budget"> & { runId?: number },
  meta: { kind: "evaluation" | "prep" | "judge" | "ask"; postingId?: number; promptVersion: string },
  request: () => Promise<Anthropic.Message & { _request_id?: string | null }>,
): Promise<Anthropic.Message> {
  if (ctx.budget.spent >= ctx.budget.max) {
    throw new BudgetExceeded(`budget reached: $${ctx.budget.spent.toFixed(2)} of $${ctx.budget.max}`);
  }
  const started = Date.now();
  const message = await request();
  const cost = costUsd(message.model, message.usage);
  ctx.budget.spent += cost;
  const usage = message.usage;
  try {
    await ctx.db.insert(llmCalls).values({
      runId: ctx.runId ?? null,
      kind: meta.kind,
      postingId: meta.postingId ?? null,
      model: message.model,
      promptVersion: meta.promptVersion,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      webSearches: usage.server_tool_use?.web_search_requests ?? 0,
      costUsd: cost,
      latencyMs: Date.now() - started,
      stopReason: message.stop_reason,
      requestId: message._request_id ?? null,
    });
  } catch (error) {
    console.error(`Couldn't log the ${meta.kind} call: ${error instanceof Error ? error.message : error}`);
  }
  return message;
}
