import { Facts } from "../agent/facts.ts";
import { decide, type Verdict } from "../agent/rules.ts";
import { verifyFacts } from "../agent/verify.ts";
import type { BatchRow } from "./batch.ts";

/**
 * The candidate's decision on a posting: "apply" (applied, shortlisted, or another role
 * at the company), "not_eligible" (skipped as not eligible), "not_interested" (skipped
 * for pay, the company, or taste). Null for an unlabelled case, graded on agreement only.
 */
export type Label = "apply" | "not_eligible" | "not_interested";

export interface EvalCase {
  id: string;
  postingId: number;
  label: Label | null;
  /** Where the label came from, e.g. "applied" or "skipped: pay". */
  decision: string | null;
  /** What the shipped pipeline decided for this text: a reference, not ground truth. */
  production: Verdict | null;
  item: { company: string; title: string; location: string | null; workplace: string | null; url: string; text: string };
}

/**
 * "truncated", "refusal" and "invalid" (unparseable, or failing the Zod limits) are
 * answers without a verdict. They're counted on their own, never as a wrong verdict.
 */
type Status = "ok" | "truncated" | "refusal" | "invalid";

export interface Graded {
  caseId: string;
  rep: number;
  status: Status;
  verdict: Verdict | null;
  reasons: string[];
  /** Quotes not found in the posting (each one downgraded a claim, as in production). */
  quoteWarnings: number;
  facts: Facts | null;
}

/** The production path without the database: parse, check every quote against the text, apply the rules. */
export function grade(c: EvalCase, row: Pick<BatchRow, "caseId" | "rep" | "stopReason" | "output">): Graded {
  const none = (status: Status): Graded => ({ caseId: row.caseId, rep: row.rep, status, verdict: null, reasons: [], quoteWarnings: 0, facts: null });
  if (row.stopReason === "max_tokens") return none("truncated");
  if (row.stopReason === "refusal") return none("refusal");
  let json: unknown;
  try {
    json = JSON.parse(row.output ?? "");
  } catch {
    return none("invalid");
  }
  const parsed = Facts.safeParse(json);
  if (!parsed.success) return none("invalid");
  const { facts, warnings } = verifyFacts(parsed.data, c.item.text);
  const decision = decide(facts);
  return { ...none("ok"), verdict: decision.verdict, reasons: decision.reasons, quoteWarnings: warnings.length, facts };
}

export interface Rate {
  k: number;
  n: number;
}

/** 95% Wilson interval: honest for small n and for rates near 0 or 1, where k/n ± 2σ isn't. */
export function wilson({ k, n }: Rate): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface Metrics {
  rows: number;
  noVerdict: Record<Exclude<Status, "ok">, number>;
  /** Postings the candidate wanted that still reach them (lead or needs check). A rejection here is a missed job. */
  recall: Rate;
  /** Postings skipped as not eligible that the model rejects. */
  ineligibleCaught: Rate;
  /** Of the labelled postings called "lead", those the candidate wanted. */
  leadPrecision: Rate;
  quoteWarnings: number;
}

/** Labelled metrics over every graded row (reps included). Rows without a verdict only count in noVerdict. */
export function summarize(cases: Map<string, EvalCase>, graded: Graded[]): Metrics {
  const m: Metrics = {
    rows: graded.length,
    noVerdict: { truncated: 0, refusal: 0, invalid: 0 },
    recall: { k: 0, n: 0 },
    ineligibleCaught: { k: 0, n: 0 },
    leadPrecision: { k: 0, n: 0 },
    quoteWarnings: 0,
  };
  for (const g of graded) {
    m.quoteWarnings += g.quoteWarnings;
    if (g.status !== "ok") {
      m.noVerdict[g.status]++;
      continue;
    }
    const label = cases.get(g.caseId)?.label;
    if (label === "apply") {
      m.recall.n++;
      if (g.verdict !== "rejected") m.recall.k++;
    }
    if (label === "not_eligible") {
      m.ineligibleCaught.n++;
      if (g.verdict === "rejected") m.ineligibleCaught.k++;
    }
    if (label && g.verdict === "lead") {
      m.leadPrecision.n++;
      if (label === "apply") m.leadPrecision.k++;
    }
  }
  return m;
}
