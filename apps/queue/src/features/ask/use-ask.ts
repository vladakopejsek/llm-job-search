/**
 * One Ask conversation: posts each question with the earlier answers, reads the answer's
 * event stream (server-sent events, one JSON AskEvent each) and keeps the turns in state.
 * Nothing is saved: a reload starts a new conversation.
 */
import { type AskEvent, MAX_HISTORY, type Runtime } from "@llm-job-search/core/ask/events.ts";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type ToolPart = Extract<AskEvent, { type: "tool_call" }> & { result?: Extract<AskEvent, { type: "tool_result" }> };
/** What a turn shows, in the order it arrived: text and tool calls interleaved. */
type Part = { type: "text"; text: string } | ToolPart;

export interface Turn {
  question: string;
  parts: Part[];
  runtime?: Runtime;
  done?: { costUsd: number | null; ms: number };
  error?: string;
  pending: boolean;
}

/** A turn after one more event. */
function apply(turn: Turn, event: AskEvent): Turn {
  switch (event.type) {
    case "start":
      return { ...turn, runtime: event.runtime };
    case "text": {
      const last = turn.parts.at(-1);
      if (last?.type === "text") return { ...turn, parts: [...turn.parts.slice(0, -1), { type: "text", text: last.text + event.text }] };
      return { ...turn, parts: [...turn.parts, { type: "text", text: event.text }] };
    }
    case "tool_call":
      return { ...turn, parts: [...turn.parts, event] };
    case "tool_result":
      return { ...turn, parts: turn.parts.map((p) => (p.type === "tool_call" && p.id === event.id ? { ...p, result: event } : p)) };
    case "done":
      return { ...turn, done: { costUsd: event.costUsd, ms: event.ms } };
    case "error":
      return { ...turn, error: event.message };
  }
}

/** The answer as plain text, for the next question's history. */
const answerText = (turn: Turn) =>
  turn.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");

/** The `data:` payloads of a server-sent event stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
  }
}

export function useAsk() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const running = useRef<AbortController | null>(null);
  // Leaving the page stops the answer: otherwise the server keeps paying for one nobody reads.
  useEffect(() => () => running.current?.abort(), []);
  // After "New conversation" the list is empty while the stopped answer still finishes: nothing to update.
  const updateLast = (fn: (t: Turn) => Turn) => setTurns((ts) => (ts.length ? [...ts.slice(0, -1), fn(ts.at(-1)!)] : ts));

  async function send(question: string) {
    const history = turns
      .filter((t) => t.done)
      .slice(-MAX_HISTORY)
      .map((t) => ({ question: t.question, answer: answerText(t) }));
    const controller = new AbortController();
    running.current = controller;
    setTurns((ts) => [...ts, { question, parts: [], pending: true }]);
    try {
      const res = await api.ask.$post({ json: { question, history } }, { init: { signal: controller.signal } });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      for await (const data of sseData(res.body)) {
        const event = JSON.parse(data) as AskEvent;
        updateLast((t) => apply(t, event));
      }
    } catch (error) {
      if (!controller.signal.aborted) updateLast((t) => ({ ...t, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      updateLast((t) => ({ ...t, pending: false, ...(controller.signal.aborted && !t.done && { error: "Stopped." }) }));
      running.current = null;
    }
  }

  return {
    turns,
    busy: turns.at(-1)?.pending ?? false,
    send,
    stop: () => running.current?.abort(),
    reset: () => {
      running.current?.abort();
      setTurns([]);
    },
  };
}
