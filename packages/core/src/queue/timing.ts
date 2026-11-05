/**
 * How long the candidate spends per decision, in two phases: triage (looking
 * at a lead until shortlisting or skipping it) and apply (working on the
 * application until it's logged). The queue app records what they do
 * (`ui_events`); `decisionTimings` turns that into durations. Pure, so the
 * counting rules are tested without a database. Definitions: docs/metrics.md.
 */
import { and, asc, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { uiEvents } from "../db/schema.ts";
import { median } from "../tracker/stats.ts";

/** Looking at a lead to decide it: the triage clock starts at the first of these. */
const TRIAGE_STARTS = ["posting_opened", "details_opened", "card_expanded", "pack_opened"] as const;
/** Working on the application: the apply clock starts at the first of these. */
const APPLY_STARTS = ["apply_dialog_opened", "session_started", "answer_copied"] as const;
/** A decision: the clocks it ends stop (STOPS). */
const END_EVENTS = ["apply_saved", "skipped", "shortlisted"] as const;
/** The lead goes away without a decision (snoozed), or a decision is taken back (Undo): start over. */
const RESET_EVENTS = ["snoozed", "undone"] as const;
const UI_EVENT_TYPES = [...TRIAGE_STARTS, ...APPLY_STARTS, ...END_EVENTS, ...RESET_EVENTS] as const;
export type UiEventType = (typeof UI_EVENT_TYPES)[number];

const ARMS = ["pack", "no_pack"] as const;
export type Arm = (typeof ARMS)[number];

/** Limits that keep a UI bug from filling the database with events. */
const MAX_PAYLOAD_CHARS = 500;
/** Real use is a few hundred events a day; far more means a bug is sending them in a loop. */
const MAX_EVENTS_PER_DAY = 2000;
/** The same event from the same tab again this soon is a double fire (a re-render, a double click), not new work. */
const REPEAT_MS = 2000;

export const UiEventInput = z
  .object({
    postingId: z.number().int().positive(),
    type: z.enum(UI_EVENT_TYPES),
    arm: z.enum(ARMS).nullable().default(null),
    tabId: z.string().min(1).max(64),
    // Small by design: a skip reason.
    payload: z
      .record(z.string(), z.unknown())
      .default({})
      .refine((p) => JSON.stringify(p).length <= MAX_PAYLOAD_CHARS, `payload over ${MAX_PAYLOAD_CHARS} characters`),
  })
  .strict();
export type UiEventInput = z.infer<typeof UiEventInput>;

/**
 * Whether to store an event. A guard against a UI bug filling the database:
 * repeats within REPEAT_MS are dropped, and so is everything past
 * MAX_EVENTS_PER_DAY. Kept in memory by the app's server, so a restart resets it.
 */
export function eventGate(limits = { repeatMs: REPEAT_MS, perDay: MAX_EVENTS_PER_DAY }) {
  const lastSeen = new Map<string, number>();
  let day = "";
  let count = 0;
  return (e: Pick<UiEventInput, "postingId" | "type" | "tabId">, now = Date.now()): boolean => {
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      count = 0;
      lastSeen.clear();
    }
    if (count >= limits.perDay) return false;
    const key = `${e.tabId}:${e.postingId}:${e.type}`;
    const last = lastSeen.get(key);
    lastSeen.set(key, now);
    if (last !== undefined && now - last < limits.repeatMs) return false;
    count++;
    return true;
  };
}

export async function recordUiEvent(db: Db, e: UiEventInput) {
  await db.insert(uiEvents).values(e);
}

/** A pause longer than this between two events is a break, not work on the lead. */
const BREAK_MS = 30 * 60_000;

export interface TimedEvent {
  postingId: number;
  type: string;
  arm: string | null;
  at: Date;
}

type EndEvent = (typeof END_EVENTS)[number];
type Outcome = "applied" | "skipped" | "shortlisted";
type Phase = "triage" | "apply";
const OUTCOME_OF: Record<EndEvent, Outcome> = { apply_saved: "applied", skipped: "skipped", shortlisted: "shortlisted" };
/** A shortlist ends triage only; applying or skipping ends whichever clock is running. */
const STOPS: Record<EndEvent, Phase[]> = { shortlisted: ["triage"], skipped: ["triage", "apply"], apply_saved: ["triage", "apply"] };
const STARTS: Record<Phase, readonly string[]> = { triage: TRIAGE_STARTS, apply: APPLY_STARTS };

export interface DecisionTiming {
  postingId: number;
  phase: Phase;
  outcome: Outcome;
  /** The arm of the decision event: which way the candidate actually worked. */
  arm: string | null;
  /** From the phase's first start event to the decision, breaks taken out. */
  seconds: number;
  at: Date;
}

interface Clock {
  lastAt: number;
  workedMs: number;
}

/**
 * One timing per phase a decision ends, when that phase's clock was running.
 * A decision with no clock running (skipped from a summary) isn't timed but
 * is counted in `untimed`. A decision later undone is dropped, and so is the
 * work before a snooze: the next decision on that lead starts new clocks.
 */
export function decisionTimings(events: readonly TimedEvent[]): { timings: DecisionTiming[]; untimed: Record<Outcome, number> } {
  const byPosting = new Map<number, TimedEvent[]>();
  for (const e of events) byPosting.set(e.postingId, [...(byPosting.get(e.postingId) ?? []), e]);

  const timings: DecisionTiming[] = [];
  const untimed = { applied: 0, skipped: 0, shortlisted: 0 };
  for (const [postingId, list] of byPosting) {
    const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    let clocks: Partial<Record<Phase, Clock>> = {};
    // Once shortlisted, triage is over: opening the posting from the apply session doesn't start it again.
    let shortlisted = false;
    // What an Undo would take back: the timings the last decision added or its untimed count, and whether it was shortlisted before.
    let last: { timed: number; outcome: Outcome; shortlisted: boolean } | null = null;

    for (const e of sorted) {
      const at = e.at.getTime();
      for (const clock of Object.values(clocks)) {
        if (at - clock.lastAt <= BREAK_MS) clock.workedMs += at - clock.lastAt;
        clock.lastAt = at;
      }
      for (const phase of ["triage", "apply"] as const) {
        if (STARTS[phase].includes(e.type) && !(phase === "triage" && shortlisted)) clocks[phase] ??= { lastAt: at, workedMs: 0 };
      }
      if ((END_EVENTS as readonly string[]).includes(e.type)) {
        const outcome = OUTCOME_OF[e.type as EndEvent];
        const stopped = STOPS[e.type as EndEvent].filter((phase) => clocks[phase]);
        for (const phase of stopped) {
          timings.push({ postingId, phase, outcome, arm: e.arm, seconds: Math.round(clocks[phase]!.workedMs / 1000), at: e.at });
          delete clocks[phase];
        }
        if (!stopped.length) untimed[outcome]++;
        last = { timed: stopped.length, outcome, shortlisted };
        shortlisted = outcome === "shortlisted";
      } else if (e.type === "undone") {
        if (last?.timed) timings.splice(-last.timed);
        else if (last) untimed[last.outcome]--;
        shortlisted = last?.shortlisted ?? false;
        last = null;
        clocks = {};
      } else if (e.type === "snoozed") {
        clocks = {};
      }
    }
  }
  return { timings, untimed };
}

export interface ArmSummary {
  triage: { decided: number; shortlisted: number; skipped: number; medianMinutes: number | null };
  apply: { applied: number; medianMinutes: number | null };
}

/** The median of some timings, in minutes to one decimal. */
function minutes(xs: readonly DecisionTiming[]) {
  const m = median(xs.map((t) => t.seconds));
  return m === null ? null : Math.round((m / 60) * 10) / 10;
}

/** Medians per arm ("pack", "no_pack", and "none" for work outside the experiment). */
export function summarise(timings: readonly DecisionTiming[]): Record<string, ArmSummary> {
  const out: Record<string, ArmSummary> = {};
  for (const arm of new Set(timings.map((t) => t.arm ?? "none"))) {
    const mine = timings.filter((t) => (t.arm ?? "none") === arm);
    const triage = mine.filter((t) => t.phase === "triage");
    const applied = mine.filter((t) => t.phase === "apply" && t.outcome === "applied");
    out[arm] = {
      triage: {
        decided: triage.length,
        shortlisted: triage.filter((t) => t.outcome === "shortlisted").length,
        skipped: triage.filter((t) => t.outcome === "skipped").length,
        medianMinutes: minutes(triage),
      },
      apply: { applied: applied.length, medianMinutes: minutes(applied) },
    };
  }
  return out;
}

/** Timings for decisions since `since` (the experiment's start, or all time). */
export async function timingSummary(db: Db, since: Date | null) {
  // Load whole histories of the postings decided in range, so a clock started before `since` still counts.
  const decided = await db
    .selectDistinct({ postingId: uiEvents.postingId })
    .from(uiEvents)
    .where(and(inArray(uiEvents.type, [...END_EVENTS]), since ? gte(uiEvents.at, since) : undefined));
  if (!decided.length) return { byArm: {}, triage: { decided: 0, medianMinutes: null }, untimed: { applied: 0, skipped: 0, shortlisted: 0 } };
  const events = await db
    .select({ postingId: uiEvents.postingId, type: uiEvents.type, arm: uiEvents.arm, at: uiEvents.at })
    .from(uiEvents)
    .where(
      inArray(
        uiEvents.postingId,
        decided.map((d) => d.postingId),
      ),
    )
    .orderBy(asc(uiEvents.at));
  const { timings, untimed } = decisionTimings(events);
  const inRange = since ? timings.filter((t) => t.at >= since) : timings;
  // Triage over every arm: the experiment is about applying, so one median for deciding.
  const triage = inRange.filter((t) => t.phase === "triage");
  return { byArm: summarise(inRange), triage: { decided: triage.length, medianMinutes: minutes(triage) }, untimed };
}
