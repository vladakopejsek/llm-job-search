import { describe, expect, it } from "vitest";
import type { Stage } from "../applications/constants.ts";
import { computeTrackerStats, fitBucket, isoWeekStart, median, type StatsApp, type StatsEvent, type StatsInput } from "./stats.ts";

const TODAY = "2026-09-26"; // a Saturday

const app = (id: number, over: Partial<StatsApp> = {}): StatsApp => ({
  id,
  company: `Co ${id}`,
  role: "Engineer",
  stage: "applied",
  origin: "import",
  channel: null,
  appliedOn: null,
  ats: "ashby",
  companySource: "import",
  fitScore: null,
  remoteScope: null,
  eligibility: null,
  hasSubmission: false,
  coverLetterSent: false,
  ...over,
});

let nextId = 1;
const ev = (applicationId: number, type: string, occurredOn: string, toStage: Stage | null = null, inferred = false): StatsEvent => ({
  id: nextId++,
  applicationId,
  type,
  toStage,
  occurredOn,
  inferred,
});
const applied = (id: number, on: string, inferred = false) => ev(id, "stage_changed", on, "applied", inferred);
const moved = (id: number, to: Stage, on: string, inferred = false) => ev(id, "stage_changed", on, to, inferred);

const stats = (apps: StatsApp[], events: StatsEvent[], over: Partial<StatsInput> = {}) =>
  computeTrackerStats({ apps, events, today: TODAY, range: "all", ...over });

describe("helpers", () => {
  it("median of odd and even counts", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 10])).toBe(3.5);
  });

  it("ISO weeks start on Monday, across a year boundary", () => {
    expect(isoWeekStart("2026-09-28")).toBe("2026-09-28"); // Monday
    expect(isoWeekStart("2026-09-27")).toBe("2026-09-21"); // Sunday belongs to the week before
    expect(isoWeekStart("2027-01-01")).toBe("2026-12-28"); // Friday; week starts in the old year
    expect(isoWeekStart("2027-01-03")).toBe("2026-12-28");
    expect(isoWeekStart("2027-01-04")).toBe("2027-01-04");
  });

  it("fit buckets", () => {
    expect([null, 0, 5, 6, 7, 8, 10].map(fitBucket)).toEqual(["unknown", "le5", "le5", "6to7", "6to7", "8plus", "8plus"]);
  });
});

describe("computeTrackerStats", () => {
  it("leaves out leads and skipped roles", () => {
    const s = stats([app(1), app(2, { stage: "lead" }), app(3, { stage: "skipped" })], [applied(1, "2026-09-01"), moved(3, "skipped", "2026-09-02")]);
    expect(s.tiles.applications.n).toBe(1);
  });

  it("uses the column's date over an applied event (one undone and applied again), and the event when the column is empty", () => {
    const s = stats([app(1, { appliedOn: "2026-09-20" }), app(2, { appliedOn: null })], [applied(1, "2026-01-01"), applied(2, "2026-09-10")]);
    expect(s.weekly.firstRecord).toBe("2026-09-10");
    expect(s.tiles.applications.thisWeek).toBe(0); // 20 Sep is the Sunday before this week
  });

  it("a rejection counts as a reply", () => {
    const s = stats(
      [app(1, { stage: "rejected" }), app(2)],
      [applied(1, "2026-09-01"), moved(1, "rejected", "2026-09-05"), applied(2, "2026-09-01")],
    );
    expect(s.tiles.responseRate).toMatchObject({ responded: 1, n: 2, rate: 0.5, rejections: 1 });
    expect(s.funnel.steps.map((x) => x.n)).toEqual([2, 1, 0, 0, 0]);
    expect(s.tiles.medianDaysToFirstReply).toMatchObject({ days: 4, n: 1 });
  });

  it("an email reply is the first response even before the stage changes", () => {
    const s = stats(
      [app(1, { stage: "screening" })],
      [applied(1, "2026-09-01"), ev(1, "email_reply", "2026-09-03"), moved(1, "screening", "2026-09-06")],
    );
    expect(s.tiles.medianDaysToFirstReply.days).toBe(2);
  });

  it("median over an even number of replies", () => {
    const s = stats(
      [app(1, { stage: "rejected" }), app(2, { stage: "rejected" })],
      [applied(1, "2026-09-01"), moved(1, "rejected", "2026-09-02"), applied(2, "2026-09-01"), moved(2, "rejected", "2026-09-05")],
    );
    expect(s.tiles.medianDaysToFirstReply).toMatchObject({ days: 2.5, n: 2 });
  });

  it("reaching a later stage implies the earlier ones", () => {
    const s = stats(
      [app(1, { stage: "offer" }), app(2, { stage: "rejected" }), app(3, { stage: "interviewing" }), app(4)],
      [
        applied(1, "2026-09-01"),
        moved(1, "offer", "2026-09-15"), // skipped screening/interviewing in the log
        applied(2, "2026-09-01"),
        moved(2, "screening", "2026-09-04"),
        moved(2, "rejected", "2026-09-10"),
        applied(3, "2026-09-01"),
        applied(4, "2026-09-01"),
      ],
    );
    expect(s.funnel.steps.map((x) => [x.step, x.n])).toEqual([
      ["applied", 4],
      ["replied", 3],
      ["screening", 3],
      ["interviewing", 2],
      ["offer", 1],
    ]);
    expect(s.funnel.steps.map((x) => x.conversion)).toEqual([null, 0.75, 1, 2 / 3, 0.5]);
    expect(s.funnel.outcomes).toEqual({ rejected: 1, noResponse: 0, waiting: 1 });
    expect(s.tiles.activePipeline).toMatchObject({ n: 2, offer: 1, interviewing: 1, screening: 0 });
  });

  it("conversion from an empty step is null, not 0%", () => {
    const s = stats([app(1)], [applied(1, "2026-09-01")]);
    expect(s.funnel.steps.map((x) => x.conversion)).toEqual([null, 0, null, null, null]);
  });

  it("ghosted: 30 days without a reply, not 29", () => {
    const s = stats(
      [app(1), app(2), app(3, { stage: "no_response" }), app(4, { stage: "rejected" })],
      [applied(1, "2026-08-27"), applied(2, "2026-08-28"), applied(3, "2026-08-01"), applied(4, "2026-08-01"), moved(4, "rejected", "2026-09-20")],
    );
    expect(s.tiles.ghosted.n).toBe(2); // 1 (30 days) and 3; 2 is 29 days; 4 replied
  });

  it("ghosted is a count for now, whatever the range", () => {
    const s = stats([app(1)], [applied(1, "2026-01-01")], { range: "30d" });
    expect(s.tiles.applications.n).toBe(0);
    expect(s.tiles.ghosted.n).toBe(1);
  });

  it("the range filters by applied date", () => {
    const apps = [app(1), app(2), app(3)];
    const events = [applied(1, "2026-09-26"), applied(2, "2026-08-28"), applied(3, "2026-08-27")];
    expect(stats(apps, events, { range: "30d" }).tiles.applications.n).toBe(2); // 28 Aug is day 30
    expect(stats(apps, events, { range: "90d" }).tiles.applications.n).toBe(3);
  });

  describe("inferred dates", () => {
    const apps = [app(1, { stage: "rejected" }), app(2, { stage: "rejected" }), app(3, { stage: "no_response" })];
    const events = [
      applied(1, "2026-09-01"),
      moved(1, "rejected", "2026-09-04"),
      applied(2, "2026-09-01"),
      moved(2, "rejected", "2026-09-20", true), // reply date guessed
      applied(3, "2026-08-01", true), // applied date guessed
      moved(3, "no_response", "2026-08-01", true),
    ];

    it("are used by default and counted", () => {
      const s = stats(apps, events);
      expect(s.tiles.applications.n).toBe(3);
      expect(s.tiles.medianDaysToFirstReply).toMatchObject({ days: 11, n: 2, inferred: 1 });
      expect(s.inferred).toMatchObject({ events: 3, appliedDates: 1 });
      expect(s.tiles.ghosted).toMatchObject({ n: 1, inferred: 1 });
    });
  });

  it("weekly buckets by ISO week, across a year boundary, with replies in the week they came", () => {
    const s = computeTrackerStats({
      apps: [app(1, { stage: "rejected" }), app(2), app(3)],
      events: [
        applied(1, "2026-12-27"), // Sunday: week of 21 Dec
        moved(1, "rejected", "2027-01-02"), // Saturday: week of 28 Dec
        applied(2, "2026-12-28"),
        applied(3, "2027-01-04"),
      ],
      today: "2027-01-05",
      range: "all",
    });
    expect(s.weekly.weeks).toEqual([
      { weekStart: "2026-12-21", applied: 1, responses: 0 },
      { weekStart: "2026-12-28", applied: 1, responses: 1 },
      { weekStart: "2027-01-04", applied: 1, responses: 0 },
    ]);
    expect(s.tiles.applications.thisWeek).toBe(1);
  });

  it("weekly covers the whole range, empty weeks included", () => {
    const s = stats([app(1)], [applied(1, "2026-09-25")], { range: "30d" });
    expect(s.weekly.weeks[0]!.weekStart).toBe("2026-08-24"); // Monday of 28 Aug's week
    expect(s.weekly.weeks.at(-1)).toEqual({ weekStart: "2026-09-21", applied: 1, responses: 0 });
    expect(s.weekly.weeks).toHaveLength(5);
  });

  it("breakdowns: buckets, fixed rows for fit and cover letter, unknown last", () => {
    const s = stats(
      [
        app(1, {
          stage: "rejected",
          fitScore: 8,
          remoteScope: "europe",
          eligibility: "implied",
          hasSubmission: true,
          coverLetterSent: true,
          channel: "ats_form",
        }),
        app(2, { fitScore: 6, hasSubmission: true, coverLetterSent: false, ats: "greenhouse" }),
        app(3, { ats: "greenhouse" }),
        app(4, { ats: null, companySource: null }),
      ],
      [applied(1, "2026-09-01"), moved(1, "rejected", "2026-09-03"), applied(2, "2026-09-01"), applied(3, "2026-09-01"), applied(4, "2026-09-01")],
    );
    expect(s.breakdowns.fitBucket.map((r) => [r.label, r.n, r.responded])).toEqual([
      ["8+", 1, 1],
      ["6–7", 1, 0],
      ["≤ 5", 0, 0],
      ["No fit score", 2, 0],
    ]);
    expect(s.breakdowns.fitBucket[2]!.rate).toBeNull();
    expect(s.breakdowns.coverLetter.map((r) => [r.key, r.n])).toEqual([
      ["sent", 1],
      ["not_sent", 1],
      ["not_logged", 2],
    ]);
    expect(s.breakdowns.ats.map((r) => [r.label, r.n])).toEqual([
      ["Greenhouse", 2],
      ["Ashby", 1],
      ["No company link", 1],
    ]);
    expect(s.breakdowns.remoteScope.map((r) => r.label)).toEqual(["Europe", "No evaluation"]);
    expect(s.breakdowns.channel.map((r) => [r.label, r.rate])).toEqual([
      ["Company form (ATS)", 1],
      ["Not recorded", 0],
    ]);
    expect(s.breakdowns.companySource.map((r) => r.label)).toEqual(["Notion import", "Not recorded"]);
  });

  it("counts applications without any date as undated", () => {
    const s = stats([app(1), app(2, { appliedOn: "2026-09-01" })], []);
    expect(s.undated).toBe(1);
    expect(s.tiles.applications.n).toBe(1);
  });
});

describe("rejections", () => {
  it("split by how far the application got", () => {
    const apps = [app(1, { stage: "rejected" }), app(2, { stage: "rejected" }), app(3, { stage: "rejected" }), app(4, { stage: "applied" })];
    const events = [
      applied(1, "2026-09-07"),
      moved(1, "screening", "2026-09-14"),
      moved(1, "rejected", "2026-09-22"),
      applied(2, "2026-09-01"),
      moved(2, "rejected", "2026-09-05"),
      applied(3, "2026-09-02"),
      moved(3, "interviewing", "2026-09-10"),
      moved(3, "rejected", "2026-09-20"),
      applied(4, "2026-09-03"),
    ];
    const r = stats(apps, events).rejections;
    expect(r.n).toBe(3);
    expect(r.byStage).toEqual([
      { stage: "applied", n: 1 },
      { stage: "screening", n: 1 },
      { stage: "interviewing", n: 1 },
      { stage: "offer", n: 0 },
    ]);
    // The funnel counts the screen even though the application ended rejected.
    expect(stats(apps, events).funnel.steps.find((s) => s.step === "screening")!.n).toBe(2);
  });
});
