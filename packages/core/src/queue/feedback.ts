/**
 * "Picks worth applying": the candidate's own decisions as implicit feedback on
 * what the pipeline puts in the queue. Pure, so the counting rules are tested
 * without a database.
 */
import type { Origin, Stage } from "../applications/constants.ts";
import type { SkipReason } from "./actions.ts";

/** Skips that mean the pipeline picked wrongly: the role never fit. */
export const WRONG_PICK_REASONS = ["not_eligible", "stack", "seniority"] as const satisfies readonly SkipReason[];

export interface DecisionRow {
  origin: Origin | string;
  stage: Stage | string;
  appliedOn: string | null;
  skipReason: string | null;
}

/**
 * Hits: roles applied to, in the queue or outside it ("Already applied"), at
 * whatever stage they've reached since. Misses: skips for a wrong pick. Other
 * skips (pay, not interested, another role at the company, stop watching) say
 * nothing about the pick, and imported tracker rows never came from the queue.
 */
export function pickPrecision(rows: readonly DecisionRow[]) {
  let applied = 0;
  let skipped = 0;
  let wrongPicks = 0;
  const skipReasons: Record<string, number> = {};
  for (const r of rows) {
    if (r.origin === "import") continue;
    if (r.stage === "skipped") {
      const reason = r.skipReason ?? "other";
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
      skipped++;
      if ((WRONG_PICK_REASONS as readonly string[]).includes(reason)) wrongPicks++;
    } else if (r.stage !== "lead" && r.appliedOn) {
      applied++;
    }
  }
  return {
    applied,
    skipped,
    skipReasons,
    /** Applied ÷ (applied + wrong-pick skips). Null until there's data. */
    precision: applied + wrongPicks ? applied / (applied + wrongPicks) : null,
  };
}
