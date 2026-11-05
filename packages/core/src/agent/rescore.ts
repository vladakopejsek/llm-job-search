import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { evaluations } from "../db/schema.ts";
import type { Facts } from "./facts.ts";
import { decide } from "./rules.ts";

/**
 * Re-apply the current rules to every stored evaluation. The facts (what the
 * model read, already quote-checked) don't change, so a rule fix costs no
 * model calls. Returns what changed.
 */
export async function rescoreEvaluations(db: Db) {
  const rows = await db
    .select({ id: evaluations.id, facts: evaluations.facts, verdict: evaluations.verdict, reasons: evaluations.reasons })
    .from(evaluations);
  const changed: { id: number; from: string; to: string; reasons: string[] }[] = [];
  for (const row of rows) {
    const d = decide(row.facts as Facts);
    if (d.verdict === row.verdict && d.reasons.join("|") === row.reasons.join("|")) continue;
    await db.update(evaluations).set({ verdict: d.verdict, reasons: d.reasons, evidence: d.evidence }).where(eq(evaluations.id, row.id));
    changed.push({ id: row.id, from: row.verdict, to: d.verdict, reasons: d.reasons });
  }
  return { total: rows.length, changed };
}
