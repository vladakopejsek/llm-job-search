/**
 * A session over a list of postings (Focus's leads, the apply session's
 * shortlist): the ones it started with, in order, and which are done. The
 * order is fixed when the session starts, so finishing one (which drops it
 * from the refetched list) moves on instead of reshuffling, and postings that
 * arrive mid-session wait for the next session.
 */
import { useState } from "react";

export function useStack<T extends { postingId: number }>(leads: T[] | undefined, startAt?: number) {
  const [ids, setIds] = useState<number[] | null>(null);
  // Adjusting state while rendering, once the leads first arrive (react.dev: "storing information from previous renders").
  if (leads && ids === null) setIds(leads.map((l) => l.postingId));

  const [decided, setDecided] = useState<ReadonlySet<number>>(new Set());
  const [currentId, setCurrentId] = useState<number | null>(startAt ?? null);

  const byId = new Map((leads ?? []).map((l) => [l.postingId, l]));
  const open = (ids ?? []).filter((id) => byId.has(id) && !decided.has(id));
  const index = currentId !== null && open.includes(currentId) ? open.indexOf(currentId) : 0;
  const current = open[index] === undefined ? null : byId.get(open[index]!)!;

  const move = (step: number) => {
    const next = open[index + step];
    if (next !== undefined) setCurrentId(next);
  };

  return {
    current,
    /** Every posting of the session, in order, with whether it's done. */
    all: (ids ?? []).flatMap((id) => (byId.has(id) || decided.has(id) ? [{ id, item: byId.get(id), done: decided.has(id) }] : [])),
    total: ids?.length ?? 0,
    decidedCount: decided.size,
    /** 1-based place of the current lead in the session. */
    position: current && ids ? ids.indexOf(current.postingId) + 1 : 0,
    next: () => move(1),
    previous: () => move(-1),
    show: (id: number) => setCurrentId(id),
    /** Take the lead out and show the one after it (or before it, at the end). */
    markDecided(id: number) {
      const at = open.indexOf(id);
      // Only if it's still the one shown: a decision confirmed after moving on mustn't pull the view back.
      setCurrentId((shown) => (shown === null || shown === id ? (open[at + 1] ?? open[at - 1] ?? null) : shown));
      setDecided((d) => new Set(d).add(id));
    },
    /** Undo, or a decision the server refused: the lead is back, and shown. */
    markOpen(id: number) {
      setDecided((d) => {
        const next = new Set(d);
        next.delete(id);
        return next;
      });
      setCurrentId(id);
    },
  };
}
