import { describe, expect, it } from "vitest";
import { type HealthInput, healthOf, STALE_AFTER_DAYS } from "./filters.ts";

const today = new Date("2026-09-26T08:00:00Z");
const daysAgo = (n: number) => new Date(today.getTime() - n * 864e5);
const company = (overrides: Partial<HealthInput>): HealthInput => ({
  status: "active",
  lastFetch: { status: "ok" },
  openPostings: 3,
  newestPostingAt: daysAgo(3),
  ...overrides,
});

describe("healthOf", () => {
  it("counts whole days since the newest open role", () => {
    expect(healthOf(company({}), today)).toEqual({ daysSinceNewest: 3, stale: false, failing: false });
    expect(healthOf(company({ newestPostingAt: daysAgo(0.5) }), today).daysSinceNewest).toBe(0);
  });

  it("accepts the ISO string a row arrives as over JSON", () => {
    expect(healthOf(company({ newestPostingAt: daysAgo(10).toISOString() }), today).daysSinceNewest).toBe(10);
  });

  it("flags a watched board with nothing new for STALE_AFTER_DAYS", () => {
    expect(healthOf(company({ newestPostingAt: daysAgo(STALE_AFTER_DAYS - 1) }), today).stale).toBe(false);
    expect(healthOf(company({ newestPostingAt: daysAgo(STALE_AFTER_DAYS) }), today).stale).toBe(true);
  });

  it("flags a watched board with no open roles at all", () => {
    expect(healthOf(company({ openPostings: 0, newestPostingAt: null }), today)).toEqual({ daysSinceNewest: null, stale: true, failing: false });
  });

  it("leaves unfetched, failing, unsupported and unwatched boards to their own flags", () => {
    const empty = { openPostings: 0, newestPostingAt: null };
    expect(healthOf(company({ ...empty, lastFetch: null }), today).stale).toBe(false);
    expect(healthOf(company({ ...empty, lastFetch: { status: "error" } }), today).stale).toBe(false);
    expect(healthOf(company({ ...empty, lastFetch: { status: "unsupported" } }), today).stale).toBe(false);
    expect(healthOf(company({ status: "paused", newestPostingAt: daysAgo(200) }), today).stale).toBe(false);
  });

  it("marks a company failing when its last fetch errored", () => {
    expect(healthOf(company({ lastFetch: { status: "error" } }), today).failing).toBe(true);
    expect(healthOf(company({ lastFetch: { status: "unsupported" } }), today).failing).toBe(false);
  });
});
