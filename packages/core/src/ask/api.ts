/**
 * Ask on the API: a tool loop written by hand on the Messages API. Each turn streams its text
 * to the screen; a turn that ends in tool calls gets all their results back in one message,
 * and the loop goes on until the model ends its turn. Every call is logged and priced
 * (llm/calls.ts), within a budget per question.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/client.ts";
import { logged, promptVersion } from "../llm/calls.ts";
import { createClient, MODEL } from "../llm/client.ts";
import type { Emit } from "./events.ts";
import { apiTools, runTool, type ToolResult } from "./tools.ts";

export const PROMPT = path.join(import.meta.dirname, "../agent/prompts/ask.md");
/** Model turns per question: a runaway guard, since a plain question needs two or three. */
const MAX_TURNS = 8;
/** USD per question; no call starts once it's spent. */
const MAX_USD = 0.5;

type Send = (messages: Anthropic.MessageParam[]) => Promise<Anthropic.Message>;
type Run = (name: string, input: unknown) => Promise<ToolResult>;

/**
 * The loop itself, given a way to send the conversation and to run a tool, so the tests can
 * replay canned turns. Throws when it stops without an answer.
 */
export async function askLoop(send: Send, run: Run, question: string, emit: Emit): Promise<void> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await send(messages);
    // The whole content goes back, thinking blocks included: the model expects its turn unchanged.
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "end_turn") return;
    if (response.stop_reason !== "tool_use") throw new Error(STOPPED[response.stop_reason ?? ""] ?? `stopped: ${response.stop_reason}`);

    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    for (const c of calls) emit({ type: "tool_call", id: c.id, name: c.name, input: c.input });
    // Read-only, so the turn's tools run at once; results go back in one message, in call order.
    const results = await Promise.all(
      calls.map(async (c): Promise<Anthropic.ToolResultBlockParam> => {
        const r = await run(c.name, c.input);
        emit({ type: "tool_result", id: c.id, ok: r.ok, rows: r.rows, truncated: r.truncated, error: r.error });
        return { type: "tool_result", tool_use_id: c.id, content: r.content, ...(!r.ok && { is_error: true }) };
      }),
    );
    messages.push({ role: "user", content: results });
  }
  throw new Error(`no answer after ${MAX_TURNS} turns`);
}

const STOPPED: Record<string, string> = {
  refusal: "Claude declined to answer this question.",
  max_tokens: "the answer hit the length limit.",
};

/** One question on the API. Returns what it cost. */
export async function askOnApi(dbs: { db: Db; readonlyDb: Db }, question: string, emit: Emit, signal: AbortSignal): Promise<number> {
  const system = await readFile(PROMPT, "utf8");
  const tools = apiTools();
  const version = promptVersion(system, tools);
  const client = createClient();
  const ctx = { db: dbs.db, budget: { max: MAX_USD, spent: 0 } };

  const send: Send = (messages) =>
    logged(ctx, { kind: "ask", promptVersion: version }, async () => {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          // The tools and system prompt are the cached prefix; the top-level breakpoint caches the growing conversation.
          cache_control: { type: "ephemeral" },
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          output_config: { effort: "medium" },
          tools,
          messages,
        },
        { signal },
      );
      stream.on("text", (text) => emit({ type: "text", text }));
      return { ...(await stream.finalMessage()), _request_id: stream.request_id };
    });

  await askLoop(send, (name, input) => runTool(dbs.readonlyDb, name, input), question, emit);
  return ctx.budget.spent;
}
