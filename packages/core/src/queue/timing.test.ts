import { describe, expect, it } from "vitest";
import { decisionTimings, eventGate, summarise, type TimedEvent, UiEventInput } from "./timing.ts";

const T0 = Date.parse("2026-09-29T08:00:00Z");
const ev = (postingId: number, type: string, minute: number, arm: string | null = null): TimedEvent => ({
  postingId,
  type,
  arm,
  at: new Date(T0 + minute * 60_000),
});

describe("decisionTimings", () => {
  const phases = (events: TimedEvent[]) => decisionTimings(events).timings.map((t) => [t.phase, t.outcome, t.seconds / 60]);

  it("times triage from seeing a lead to shortlisting it, and applying from the session to the log", () => {
    const events = [
      ev(1, "details_opened", 0),
      ev(1, "pack_opened", 1),
      ev(1, "shortlisted", 2),
      ev(1, "session_started", 60),
      ev(1, "answer_copied", 70),
      ev(1, "apply_saved", 72),
    ];
    expect(phases(events)).toEqual([
      ["triage", "shortlisted", 2],
      ["apply", "applied", 12],
    ]);
  });

  it("doesn't start triage again when the apply session opens the posting", () => {
    const events = [
      ev(1, "details_opened", 0),
      ev(1, "shortlisted", 2),
      ev(1, "session_started", 60),
      ev(1, "posting_opened", 61),
      ev(1, "apply_saved", 80),
    ];
    expect(phases(events)).toEqual([
      ["triage", "shortlisted", 2],
      ["apply", "applied", 20],
    ]);
  });

  it("is back on the shortlist after undoing a skip from it, and back in triage after undoing the shortlist", () => {
    const fromShortlist = [
      ev(1, "details_opened", 0),
      ev(1, "shortlisted", 1),
      ev(1, "skipped", 2),
      ev(1, "undone", 3),
      ev(1, "posting_opened", 4),
      ev(1, "skipped", 6),
    ];
    expect(phases(fromShortlist)).toEqual([["triage", "shortlisted", 1]]);
    expect(
      phases([ev(1, "details_opened", 0), ev(1, "shortlisted", 1), ev(1, "undone", 2), ev(1, "posting_opened", 3), ev(1, "skipped", 5)]),
    ).toEqual([["triage", "skipped", 2]]);
  });

  it("times a skip from the shortlist as apply work", () => {
    expect(phases([ev(1, "details_opened", 0), ev(1, "shortlisted", 1), ev(1, "session_started", 30), ev(1, "skipped", 33)])).toEqual([
      ["triage", "shortlisted", 1],
      ["apply", "skipped", 3],
    ]);
  });

  it("times both phases, overlapping, when a lead is applied to without a shortlist (the old Apply dialog)", () => {
    expect(phases([ev(1, "posting_opened", 0), ev(1, "apply_dialog_opened", 20), ev(1, "apply_saved", 24)])).toEqual([
      ["triage", "applied", 24],
      ["apply", "applied", 4],
    ]);
  });

  it("takes breaks longer than 30 minutes out", () => {
    const { timings } = decisionTimings([ev(1, "session_started", 0), ev(1, "answer_copied", 10), ev(1, "apply_saved", 10 + 45)]);
    expect(timings[0]!.seconds).toBe(10 * 60);
  });

  it("counts decisions with no clock running, without timing them", () => {
    const { timings, untimed } = decisionTimings([ev(1, "skipped", 0), ev(2, "details_opened", 0), ev(2, "skipped", 2), ev(3, "apply_saved", 0)]);
    expect(timings.map((t) => [t.postingId, t.seconds])).toEqual([[2, 120]]);
    expect(untimed).toEqual({ applied: 1, skipped: 1, shortlisted: 0 });
  });

  it("drops a decision that was undone, and starts the next one afresh", () => {
    const { timings, untimed } = decisionTimings([
      ev(1, "details_opened", 0),
      ev(1, "shortlisted", 1),
      ev(1, "undone", 2),
      ev(1, "pack_opened", 5),
      ev(1, "skipped", 15),
      ev(2, "skipped", 0),
      ev(2, "undone", 1),
    ]);
    expect(timings.map((t) => [t.postingId, t.phase, t.outcome, t.seconds])).toEqual([[1, "triage", "skipped", 600]]);
    expect(untimed).toEqual({ applied: 0, skipped: 0, shortlisted: 0 });
  });

  it("drops both timings of an undone decision that ended two clocks", () => {
    const { timings } = decisionTimings([ev(1, "posting_opened", 0), ev(1, "apply_dialog_opened", 1), ev(1, "apply_saved", 2), ev(1, "undone", 3)]);
    expect(timings).toEqual([]);
  });

  it("forgets work before a snooze", () => {
    const { timings } = decisionTimings([
      ev(1, "details_opened", 0),
      ev(1, "snoozed", 5),
      ev(1, "card_expanded", 60 * 24),
      ev(1, "skipped", 60 * 24 + 8),
    ]);
    expect(timings[0]!.seconds).toBe(8 * 60);
  });

  it("keeps each decision's arm and sorts events by time first", () => {
    const { timings } = decisionTimings([ev(1, "apply_saved", 12, "no_pack"), ev(1, "session_started", 0, "no_pack")]);
    expect(timings).toMatchObject([{ phase: "apply", arm: "no_pack", seconds: 720 }]);
  });
});

describe("summarise", () => {
  it("gives triage and apply medians in minutes per arm", () => {
    const { timings } = decisionTimings([
      ev(1, "session_started", 0, "pack"),
      ev(1, "apply_saved", 10, "pack"),
      ev(2, "session_started", 0, "pack"),
      ev(2, "apply_saved", 20, "pack"),
      ev(3, "session_started", 0, "no_pack"),
      ev(3, "apply_saved", 30, "no_pack"),
      ev(4, "details_opened", 0),
      ev(4, "skipped", 1),
      ev(5, "details_opened", 0),
      ev(5, "shortlisted", 3),
    ]);
    expect(summarise(timings)).toEqual({
      pack: { triage: { decided: 0, shortlisted: 0, skipped: 0, medianMinutes: null }, apply: { applied: 2, medianMinutes: 15 } },
      no_pack: { triage: { decided: 0, shortlisted: 0, skipped: 0, medianMinutes: null }, apply: { applied: 1, medianMinutes: 30 } },
      none: { triage: { decided: 2, shortlisted: 1, skipped: 1, medianMinutes: 2 }, apply: { applied: 0, medianMinutes: null } },
    });
  });
});

describe("eventGate", () => {
  const e = (type: string, postingId = 1, tabId = "t") => ({ type, postingId, tabId }) as Parameters<ReturnType<typeof eventGate>>[0];

  it("drops a double fire of the same event, not a different one", () => {
    const pass = eventGate();
    expect(pass(e("pack_opened"), T0)).toBe(true);
    expect(pass(e("pack_opened"), T0 + 500)).toBe(false);
    expect(pass(e("apply_dialog_opened"), T0 + 600)).toBe(true);
    expect(pass(e("pack_opened", 2), T0 + 700)).toBe(true);
    expect(pass(e("pack_opened"), T0 + 5000)).toBe(true);
  });

  it("stops at the daily ceiling, and starts again the next day", () => {
    const pass = eventGate({ repeatMs: 0, perDay: 3 });
    expect([1, 2, 3, 4].map((id) => pass(e("card_expanded", id), T0))).toEqual([true, true, true, false]);
    expect(pass(e("card_expanded", 5), T0 + 86_400_000)).toBe(true);
  });
});

describe("UiEventInput", () => {
  it("refuses a large payload", () => {
    const base = { postingId: 1, type: "skipped", tabId: "t" };
    expect(UiEventInput.safeParse({ ...base, payload: { reason: "stack" } }).success).toBe(true);
    expect(UiEventInput.safeParse({ ...base, payload: { note: "x".repeat(600) } }).success).toBe(false);
  });
});
