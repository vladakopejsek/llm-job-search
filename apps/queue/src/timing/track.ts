/**
 * Record what the candidate does, for the time-per-decision numbers
 * (packages/core/src/queue/timing.ts). Fire-and-forget: sendBeacon queues the
 * request even when the page is navigating away, never blocks, and a failure
 * only means a missing data point.
 */
import type { UiEventType } from "@llm-job-search/core/queue/timing.ts";
import { armOf } from "./experiment.ts";

/** One id per page load, to tell sessions apart. */
const tabId = crypto.randomUUID();

export function track(type: UiEventType, postingId: number, payload: Record<string, unknown> = {}) {
  try {
    const body = JSON.stringify({ postingId, type, arm: armOf(postingId), tabId, payload });
    // As a JSON Blob: a plain string would go as text/plain, which the route's validator rejects.
    if (!navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" })))
      void fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  } catch {
    // Timing is best effort.
  }
}
