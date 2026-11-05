/**
 * Ask on the subscription: `claude -p` with only Ask's tools (served by ask/mcp-server.ts),
 * its JSON lines turned into the same events the API loop emits. It runs from an empty
 * directory and loads no settings, so no CLAUDE.md, memory, plugin, hook or connector of the
 * machine gets into the conversation.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { MODEL } from "../llm/client.ts";
import { claudeEnv } from "../llm/subscription.ts";
import { PROMPT } from "./api.ts";
import type { AskEvent, Emit } from "./events.ts";

const MAX_TURNS = 8;
/** A backstop: a question normally takes under a minute. */
const TIMEOUT_MS = 3 * 60_000;

const MCP_CONFIG = {
  mcpServers: {
    jobregator: {
      command: path.join(import.meta.dirname, "../../node_modules/.bin/tsx"),
      args: [path.join(import.meta.dirname, "mcp-server.ts")],
    },
  },
};

/**
 * One line of `claude -p --output-format stream-json --include-partial-messages` as the events
 * the screen shows; most lines give none:
 * - a `stream_event` with a `text_delta` → `text`;
 * - an `assistant` message's `tool_use` blocks → `tool_call`, the name without `mcp__jobregator__`;
 * - a `user` message's `tool_result` blocks → `tool_result`. A failed one has `is_error` and its
 *   text as a string: that's the `error`. A successful one has a list of text blocks holding the
 *   JSON our tools return (ask/tools.ts `capped`): `rows` and `truncated` come from there, and a
 *   text that no longer parses was cut, so `truncated: true`;
 * - the `system` `init` line → `error` when the jobregator MCP server didn't connect;
 * - the `result` line → `done` with its `total_cost_usd` and `duration_ms`, or `error` when it failed.
 */
export function toEvents(line: unknown): AskEvent[] {
  const l = line as Line;
  switch (l.type) {
    case "stream_event": {
      const delta = l.event.delta;
      return delta?.type === "text_delta" ? [{ type: "text", text: delta.text }] : [];
    }
    case "assistant":
      return l.message.content
        .filter((b) => b.type === "tool_use")
        .map((b): AskEvent => ({ type: "tool_call", id: b.id, name: b.name.replace(/^mcp__jobregator__/, ""), input: b.input }));
    case "user":
      return l.message.content.filter((b) => b.type === "tool_result").map(toolResult);
    case "system": {
      const server = l.mcp_servers?.find((s) => s.name === "jobregator");
      return l.subtype === "init" && server?.status !== "connected"
        ? [{ type: "error", message: `Ask's tools didn't load: the jobregator MCP server is ${server?.status ?? "missing"}.` }]
        : [];
    }
    case "result":
      return l.is_error
        ? [{ type: "error", message: `claude -p stopped: ${l.subtype}` }]
        : [{ type: "done", runtime: "subscription", costUsd: l.total_cost_usd, ms: l.duration_ms }];
    default:
      return [];
  }
}

/** One `tool_result` block as the screen's event: the third case above `toEvents`. */
function toolResult(block: ToolResultBlock): AskEvent {
  const id = block.tool_use_id;
  const text = typeof block.content === "string" ? block.content : block.content.map((c) => c.text).join("");
  if (block.is_error) return { type: "tool_result", id, ok: false, error: text };
  try {
    const parsed = JSON.parse(text);
    return { type: "tool_result", id, ok: true, rows: Array.isArray(parsed?.rows) ? parsed.rows.length : undefined, truncated: parsed?.truncated };
  } catch {
    // capped() in ask/tools.ts cut it mid-JSON.
    return { type: "tool_result", id, ok: true, truncated: true };
  }
}

// Only the fields toEvents reads, on the lines and blocks it reads. A cast, not a check: these
// come from claude, not from the user.
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; is_error?: boolean; content: string | { type: string; text: string }[] };
type Block = { type: "tool_use"; id: string; name: string; input: unknown } | ToolResultBlock | { type: "text" | "thinking" };
type Line =
  | { type: "stream_event"; event: { delta?: { type: string; text: string } } }
  | { type: "assistant" | "user"; message: { content: Block[] } }
  | { type: "system"; subtype: string; mcp_servers?: { name: string; status: string }[] }
  | { type: "result"; subtype: string; is_error: boolean; total_cost_usd: number; duration_ms: number };

/** One question on the subscription. Throws when claude fails or stops without an answer. */
export async function askOnSubscription(question: string, emit: Emit, signal: AbortSignal): Promise<{ costUsd: number | null }> {
  const cwd = path.join(tmpdir(), "jobregator-ask");
  mkdirSync(cwd, { recursive: true });
  // biome-ignore format: one flag per line
  const args = [
    "-p", question,
    "--system-prompt", readFileSync(PROMPT, "utf8"),
    "--tools", "",
    "--mcp-config", JSON.stringify(MCP_CONFIG),
    "--strict-mcp-config",
    "--allowedTools", "mcp__jobregator__*",
    "--setting-sources", "",
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--no-session-persistence", "--disable-slash-commands",
    "--model", MODEL, "--effort", "medium", "--max-turns", String(MAX_TURNS),
  ];
  const child = spawn("claude", args, { cwd, env: claudeEnv(), signal, timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  // A spawn failure (no claude on PATH, an abort) rejects `closed`: handled below, not left unhandled meanwhile.
  closed.catch(() => {});
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });

  let done: Extract<AskEvent, { type: "done" }> | undefined;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      if (!line.trim()) continue;
      for (const event of toEvents(JSON.parse(line))) {
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") done = event;
        else emit(event);
      }
    }
    const [code] = await closed;
    if (!done) throw new Error(`claude -p stopped without an answer (exit ${code}): ${stderr.trim().split("\n").at(-1) ?? ""}`);
    return { costUsd: done.costUsd };
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
