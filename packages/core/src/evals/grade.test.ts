import { describe, expect, it } from "vitest";
import type { Facts } from "../agent/facts.ts";
import { labelOf } from "./dataset.ts";
import { type EvalCase, type Graded, grade, summarize, wilson } from "./grade.ts";

const TEXT = "Senior Engineer. Remote within the EU. You'll build React and TypeScript tools for warehouse operations.";
const facts = (over: Partial<Facts> = {}): Facts => ({
  remote: { scope: "europe", regions: ["EU"], quote: "Remote within the EU" },
  eligibility: { status: "implied", quote: "Remote within the EU" },
  usOnlySignals: [],
  office: { requirement: "none", location: null, quote: null },
  languages: { required: [], quote: null },
  stack: { primaryLanguages: ["TypeScript"], typescript: true, react: true, node: false, backendHeavy: false, quote: "React and TypeScript" },
  seniority: "senior",
  pay: { min: null, max: null, currency: null, period: null, basis: "unknown", quote: null },
  contract: { b2bMentioned: false, eorMentioned: false, quote: null },
  applicationQuestions: [],
  fit: { score: 8, reason: "TS/React product work" },
  whyFit: [{ point: "Warehouse domain", quote: "warehouse operations" }],
  gaps: [],
  ...over,
});
const item = { company: "Acme", title: "Senior Engineer", location: null, workplace: null, url: "https://x", text: TEXT };
const evalCase = (id: string, label: EvalCase["label"]): EvalCase => ({ id, postingId: 1, label, decision: null, production: null, item });
const answer = (output: string, stopReason = "end_turn") => ({ caseId: "a", rep: 0, stopReason, output });

describe("labelOf", () => {
  it("reads the candidate's decision as a label, and undecided stages as none", () => {
    expect(labelOf("applied", null)).toBe("apply");
    expect(labelOf("rejected", null)).toBe("apply");
    expect(labelOf("skipped", "applied_other_role")).toBe("apply");
    expect(labelOf("skipped", "not_eligible")).toBe("not_eligible");
    expect(labelOf("skipped", "pay")).toBe("not_interested");
    expect(labelOf("lead", null)).toBeNull();
  });
});

describe("grade", () => {
  it("runs the production checks: a lead, a rejection, and a quote that isn't in the text", () => {
    expect(grade(evalCase("a", "apply"), answer(JSON.stringify(facts()))).verdict).toBe("lead");
    const excluded = facts({ eligibility: { status: "excluded", quote: "Remote within the EU" } });
    expect(grade(evalCase("a", "apply"), answer(JSON.stringify(excluded))).verdict).toBe("rejected");
    const made = facts({ eligibility: { status: "named", quote: "Portugal welcome" } });
    expect(grade(evalCase("a", "apply"), answer(JSON.stringify(made))).quoteWarnings).toBe(1);
  });

  it("gives no verdict for a cut-off, a refusal or an unreadable answer, rather than a wrong one", () => {
    expect(grade(evalCase("a", "apply"), answer("{", "max_tokens")).status).toBe("truncated");
    expect(grade(evalCase("a", "apply"), answer("", "refusal")).status).toBe("refusal");
    expect(grade(evalCase("a", "apply"), answer("not json")).status).toBe("invalid");
    expect(grade(evalCase("a", "apply"), answer(JSON.stringify({ remote: {} }))).status).toBe("invalid");
  });
});

describe("summarize", () => {
  const cases = new Map([
    ["a", evalCase("a", "apply")],
    ["b", evalCase("b", "not_eligible")],
    ["c", evalCase("c", null)],
  ]);
  const run = (verdicts: Record<string, Graded["verdict"]>): Graded[] =>
    Object.entries(verdicts).map(([caseId, verdict]) => ({ caseId, rep: 0, status: "ok", verdict, reasons: [], quoteWarnings: 0, facts: null }));

  it("scores an oracle perfectly and a reject-everything run at zero recall", () => {
    const oracle = summarize(cases, run({ a: "lead", b: "rejected", c: "lead" }));
    expect([oracle.recall, oracle.ineligibleCaught, oracle.leadPrecision]).toEqual([
      { k: 1, n: 1 },
      { k: 1, n: 1 },
      { k: 1, n: 1 },
    ]);
    expect(summarize(cases, run({ a: "rejected", b: "rejected" })).recall).toEqual({ k: 0, n: 1 });
  });

  it("keeps answers without a verdict out of the rates", () => {
    const m = summarize(cases, [{ caseId: "a", rep: 0, status: "truncated", verdict: null, reasons: [], quoteWarnings: 0, facts: null }]);
    expect(m.recall.n).toBe(0);
    expect(m.noVerdict.truncated).toBe(1);
  });
});

describe("wilson", () => {
  it("gives a real interval at 0 of 10 and 10 of 10, where k/n ± 2σ collapses to a point", () => {
    expect(wilson({ k: 0, n: 10 })[1]).toBeCloseTo(0.278, 2);
    expect(wilson({ k: 10, n: 10 })[0]).toBeCloseTo(0.722, 2);
  });
});
