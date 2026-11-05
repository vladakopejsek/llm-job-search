import { describe, expect, it } from "vitest";
import { snoozePresets } from "./snooze.ts";

const untils = (today: string) => snoozePresets(today).map((p) => p.until);

describe("snoozePresets", () => {
  it("offers 3 days, a week, and the coming Monday", () => {
    expect(untils("2026-09-29")).toEqual(["2026-10-02", "2026-10-06", "2026-10-05"]); // a Tuesday
  });

  it("makes next Monday a week away on a Monday, and tomorrow on a Sunday", () => {
    expect(untils("2026-09-28")[2]).toBe("2026-10-05");
    expect(untils("2026-10-04")[2]).toBe("2026-10-05");
  });

  it("crosses month and year ends", () => {
    expect(untils("2026-12-30")).toEqual(["2027-01-02", "2027-01-06", "2027-01-04"]);
  });
});
