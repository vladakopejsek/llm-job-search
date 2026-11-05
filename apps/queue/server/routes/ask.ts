/** Ask: a question in, the answer streamed back as server-sent events (one JSON AskEvent each). */
import { ask } from "@llm-job-search/core/ask/ask.ts";
import { type AskEvent, AskInput } from "@llm-job-search/core/ask/events.ts";
import type { Db } from "@llm-job-search/core/db/client.ts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { json } from "../util.ts";

/** `readonlyDb` is null without DATABASE_URL_READONLY: Ask then answers with an error, never on the read-write role. */
export const askRoutes = (db: Db, readonlyDb: Db | null) =>
  new Hono().post("/ask", json(AskInput), (c) => {
    const input = c.req.valid("json");
    return streamSSE(c, async (stream) => {
      // Events are written in order, and all of them before the stream closes.
      let written = Promise.resolve();
      const send = (event: AskEvent) => {
        written = written.then(() => stream.writeSSE({ data: JSON.stringify(event) }));
      };
      if (!readonlyDb) send({ type: "error", message: "DATABASE_URL_READONLY isn't set, so Ask has no read-only connection." });
      else {
        // A closed tab or the Stop button aborts the API stream or kills claude.
        const controller = new AbortController();
        stream.onAbort(() => controller.abort());
        await ask({ db, readonlyDb }, input, send, controller.signal);
      }
      await written;
    });
  });
