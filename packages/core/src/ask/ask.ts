/**
 * Ask: a question about the search, answered by Claude with read-only tools, on the API when
 * there's credit and on the subscription (`claude -p`) when there isn't. Either way the screen
 * gets the same events (events.ts).
 */
import type { Db } from "../db/client.ts";
import { localDate } from "../lib/dates.ts";
import { apiUsable } from "../llm/client.ts";
import { askOnApi } from "./api.ts";
import type { AskInput, Emit } from "./events.ts";
import { askOnSubscription } from "./subscription.ts";

/** The question as both runtimes send it: today's date, the earlier questions and answers as plain text, then the question. */
function questionText({ history, question }: AskInput, today = localDate()): string {
  const earlier = history.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join("\n\n");
  return [`Today is ${today}.`, ...(earlier ? [`Earlier in this conversation:\n\n${earlier}`] : []), `Question: ${question}`].join("\n\n");
}

/** Runs one question to the end; failures become an `error` event, never a throw. */
export async function ask(dbs: { db: Db; readonlyDb: Db }, input: AskInput, emit: Emit, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  try {
    const text = questionText(input);
    if (await apiUsable()) {
      emit({ type: "start", runtime: "api" });
      const costUsd = await askOnApi(dbs, text, emit, signal);
      emit({ type: "done", runtime: "api", costUsd, ms: Date.now() - started });
    } else {
      emit({ type: "start", runtime: "subscription" });
      const { costUsd } = await askOnSubscription(text, emit, signal);
      emit({ type: "done", runtime: "subscription", costUsd, ms: Date.now() - started });
    }
  } catch (error) {
    if (signal.aborted) return;
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
