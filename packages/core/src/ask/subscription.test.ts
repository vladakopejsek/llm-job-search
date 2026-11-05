import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toEvents } from "./subscription.ts";

// One real `claude -p` run (2026-11-03), trimmed, with every id, path and value made fictional.
const fixture = readFileSync(path.join(import.meta.dirname, "__fixtures__/claude-stream.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

describe("toEvents", () => {
  it("turns a recorded run into the screen's events", () => {
    expect(fixture.flatMap(toEvents)).toMatchObject([
      { type: "tool_call", id: "toolu_01", name: "sql", input: { query: expect.stringContaining("application_events") } },
      { type: "tool_result", id: "toolu_01", ok: false, error: 'relation "replies" does not exist' },
      // Two calls in one turn: each result arrives on a line of its own.
      { type: "tool_call", id: "toolu_02", name: "sql" },
      { type: "tool_result", id: "toolu_02", ok: false, error: 'column "replied_on" does not exist' },
      { type: "tool_call", id: "toolu_03", name: "tracker_stats", input: { range: "90d" } },
      { type: "tool_result", id: "toolu_03", ok: true, rows: undefined },
      { type: "tool_call", id: "toolu_04", name: "applications", input: {} },
      { type: "tool_result", id: "toolu_04", ok: true, rows: 2, truncated: true },
      // Text arrives as deltas; the assistant line that repeats it whole gives nothing.
      { type: "text", text: "3 of the 9 applications" },
      { type: "text", text: " sent in October got a reply:\n- Email: 2 of 4" },
      { type: "text", text: "\n- Company form (ATS): 1 of 5" },
      { type: "done", runtime: "subscription", costUsd: 0.194879, ms: 22978 },
    ]);
  });

  it("says when the result was cut mid-JSON", () => {
    const cut = {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: '{"rows":[{"id":1}… [cut at 20000 characters]' }] }],
      },
    };
    expect(toEvents(cut)).toEqual([{ type: "tool_result", id: "t1", ok: true, truncated: true }]);
  });

  it("fails when the tools didn't load or the run failed", () => {
    const init = { type: "system", subtype: "init", mcp_servers: [{ name: "jobregator", status: "failed" }] };
    expect(toEvents(init)).toMatchObject([{ type: "error" }]);
    const maxTurns = { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 9, duration_ms: 60_000, total_cost_usd: 0.4 };
    expect(toEvents(maxTurns)).toMatchObject([{ type: "error" }]);
  });

  it("ignores everything else", () => {
    expect(toEvents({ type: "rate_limit_event", rate_limit_info: {} })).toEqual([]);
    expect(toEvents({ type: "system", subtype: "status", status: "requesting" })).toEqual([]);
  });
});
