import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { askLoop } from "./api.ts";
import type { AskEvent } from "./events.ts";
import type { ToolResult } from "./tools.ts";

type Block = Anthropic.ContentBlock;
const turn = (stop_reason: Anthropic.StopReason, ...content: Block[]) => ({ stop_reason, content }) as Anthropic.Message;
const call = (id: string, name: string, input: unknown = {}) => ({ type: "tool_use", id, name, input }) as Block;
const text = (t: string) => ({ type: "text", text: t }) as Block;

/** Replays `turns` and records what the loop sent and emitted. */
function harness(turns: Anthropic.Message[], run: (name: string) => ToolResult = () => ({ ok: true, content: "[]", rows: 0 })) {
  const sent: Anthropic.MessageParam[][] = [];
  const events: AskEvent[] = [];
  const loop = askLoop(
    async (messages) => {
      sent.push(structuredClone(messages));
      const next = turns.shift();
      if (!next) throw new Error("no more turns");
      return next;
    },
    async (name) => run(name),
    "How many replies in October?",
    (e) => events.push(e),
  );
  return { loop, sent, events };
}

describe("askLoop", () => {
  it("runs a tool round, sends the result back and stops at end_turn", async () => {
    const { loop, sent, events } = harness([turn("tool_use", call("t1", "tracker_stats", { range: "90d" })), turn("end_turn", text("Seven."))]);
    await loop;
    expect(sent).toHaveLength(2);
    expect(sent[1]!.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" }] });
    expect(events).toEqual([
      { type: "tool_call", id: "t1", name: "tracker_stats", input: { range: "90d" } },
      { type: "tool_result", id: "t1", ok: true, rows: 0, truncated: undefined, error: undefined },
    ]);
  });

  it("answers parallel calls in one message, in call order", async () => {
    const { loop, sent } = harness([turn("tool_use", call("a", "sql"), call("b", "applications")), turn("end_turn", text("Done."))]);
    await loop;
    const results = sent[1]!.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["a", "b"]);
  });

  it("marks a failed tool as is_error and lets the model carry on", async () => {
    const { loop, sent, events } = harness([turn("tool_use", call("t1", "sql")), turn("end_turn", text("I couldn't count that."))], () => ({
      ok: false,
      content: "syntax error",
      error: "syntax error",
    }));
    await loop;
    expect(sent[1]!.at(-1)!.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "syntax error", is_error: true }]);
    expect(events.at(-1)).toMatchObject({ type: "tool_result", ok: false, error: "syntax error" });
  });

  it("stops after 8 turns without an answer", async () => {
    const { loop, sent } = harness(Array.from({ length: 9 }, (_, i) => turn("tool_use", call(`t${i}`, "sql"))));
    await expect(loop).rejects.toThrow("no answer after 8 turns");
    expect(sent).toHaveLength(8);
  });

  it("turns a refusal into an error", async () => {
    await expect(harness([turn("refusal")]).loop).rejects.toThrow(/declined/);
  });
});
