import { describe, expect, it } from "vitest";
import { type DecisionRow, pickPrecision } from "./feedback.ts";

const applied = (over: Partial<DecisionRow> = {}): DecisionRow => ({
  origin: "queue",
  stage: "applied",
  appliedOn: "2026-09-01",
  skipReason: null,
  ...over,
});
const skipped = (skipReason: string, over: Partial<DecisionRow> = {}): DecisionRow => ({
  origin: "queue",
  stage: "skipped",
  appliedOn: null,
  skipReason,
  ...over,
});

describe("pickPrecision", () => {
  it("is null with no decisions", () => {
    expect(pickPrecision([])).toEqual({ applied: 0, skipped: 0, skipReasons: {}, precision: null });
  });

  it("counts wrong-pick skips against applications", () => {
    const f = pickPrecision([applied(), applied(), applied(), skipped("stack")]);
    expect(f.precision).toBe(0.75);
    expect(f.skipReasons).toEqual({ stack: 1 });
  });

  it("keeps counting an application after the company replied", () => {
    const rows = ["screening", "interviewing", "offer", "rejected", "no_response"].map((stage) => applied({ stage }));
    expect(pickPrecision([...rows, skipped("not_eligible")])).toMatchObject({ applied: 5, precision: 5 / 6 });
  });

  it("counts an application made outside the queue as a good pick", () => {
    expect(pickPrecision([applied({ origin: "outside" }), skipped("seniority")]).precision).toBe(0.5);
  });

  it("doesn't count skips that say nothing about the pick", () => {
    const f = pickPrecision([applied(), ...["applied_other_role", "pay", "not_interested", "company"].map((r) => skipped(r))]);
    expect(f).toMatchObject({ applied: 1, skipped: 4, precision: 1 });
  });

  it("leaves out imported tracker rows and undecided leads", () => {
    const f = pickPrecision([
      applied({ origin: "import" }),
      skipped("stack", { origin: "import" }),
      applied({ stage: "lead", appliedOn: null }),
      applied({ appliedOn: null }),
    ]);
    expect(f).toEqual({ applied: 0, skipped: 0, skipReasons: {}, precision: null });
  });
});
