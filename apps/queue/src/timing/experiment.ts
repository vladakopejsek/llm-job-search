/**
 * The timing experiment: with it on, each lead that has a prep pack is worked
 * either with the pack or without it, so the two can be timed against each
 * other (docs/metrics.md). The arm comes from a hash of the posting id and a
 * salt drawn when the experiment starts: random, so the candidate can't pick
 * the easy roles for one arm, and stable across reloads.
 *
 * The switch is kept in this browser (localStorage), like the collapsed cards.
 * Storage can be unavailable, so every access is guarded.
 */
import type { Arm } from "@llm-job-search/core/queue/timing.ts";
import { useSyncExternalStore } from "react";

const KEY = "job-search.queue.experiment";

export interface Experiment {
  salt: string;
  /** ISO time; the experiment's counts start here. */
  startedAt: string;
}

function load(): Experiment | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Experiment) : null;
  } catch {
    return null;
  }
}

let current = load();
const listeners = new Set<() => void>();

function commit(next: Experiment | null) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Not persisted; still works for this page view.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useExperiment = () => useSyncExternalStore(subscribe, () => current);
export const startExperiment = () => commit({ salt: crypto.randomUUID(), startedAt: new Date().toISOString() });
export const stopExperiment = () => commit(null);

/** FNV-1a: small, fast, and spreads consecutive ids evenly. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Only leads with a pack take part: without one there's nothing to leave out. */
function armFor(experiment: Experiment | null, postingId: number, hasPack: boolean): Arm | null {
  if (!experiment || !hasPack) return null;
  return hash(`${experiment.salt}:${postingId}`) % 2 ? "no_pack" : "pack";
}

/**
 * The arm of each lead on screen, for `track()`: the card or detail page that
 * knows whether a lead has a pack records it when it renders, and events sent
 * from elsewhere (the Apply dialog, the decision buttons) look it up.
 */
const arms = new Map<number, Arm | null>();
const rememberArm = (postingId: number, arm: Arm | null) => arms.set(postingId, arm);
export const armOf = (postingId: number): Arm | null => (current ? (arms.get(postingId) ?? null) : null);

/** The arm of a lead, remembered for its events. */
export function useArm(postingId: number, hasPack: boolean): Arm | null {
  const arm = armFor(useExperiment(), postingId, hasPack);
  rememberArm(postingId, arm);
  return arm;
}
