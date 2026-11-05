/** Timing: what the candidate does in the app and when, to measure time per decision (docs/metrics.md). */

import type { Db } from "@llm-job-search/core/db/client.ts";
import { eventGate, recordUiEvent, timingSummary, UiEventInput } from "@llm-job-search/core/queue/timing.ts";
import { Hono } from "hono";
import { z } from "zod";
import { json, ok, query } from "../util.ts";

export const timingRoutes = (db: Db) => {
  const pass = eventGate();
  return (
    new Hono()
      // Sent with navigator.sendBeacon, fire-and-forget: the page never waits for it.
      // Repeats and anything past the daily ceiling are dropped (eventGate), so a UI bug can't fill the database.
      .post("/track", json(UiEventInput), async (c) => {
        const event = c.req.valid("json");
        if (pass(event)) await recordUiEvent(db, event);
        return c.json(ok);
      })
      // ?since=<ISO time>: only decisions since then (the experiment's start).
      .get("/timing", query(z.object({ since: z.iso.datetime().optional() })), async (c) => {
        const { since } = c.req.valid("query");
        return c.json(await timingSummary(db, since ? new Date(since) : null));
      })
  );
};
