import { describe, expect, it } from "vitest";
import type { Facts } from "../agent/facts.ts";
import { roleFactsLine, roleQuotes } from "./queries.ts";

const facts = {
  remote: { scope: "europe", regions: ["EU", "UK"], quote: "Remote within Europe" },
  eligibility: { status: "implied", quote: "Remote within Europe" },
  usOnlySignals: [],
  office: { requirement: "none", location: null, quote: null },
  languages: { required: [], quote: null },
  stack: { primaryLanguages: ["TypeScript", "Go"], typescript: true, react: true, node: true, backendHeavy: false, quote: "TypeScript and Go" },
  seniority: "senior",
  pay: { min: 70000, max: 90000, currency: "EUR", period: "year", basis: "salary", quote: null },
  contract: { b2bMentioned: false, eorMentioned: false, quote: null },
  applicationQuestions: [],
  fit: { score: 8, reason: "" },
  whyFit: [{ point: "React", quote: "You love React" }],
  gaps: [{ gap: "Go", quote: null }],
} satisfies Facts;

describe("role facts", () => {
  it("one line: remote, eligibility, stack, seniority, pay", () => {
    expect(roleFactsLine(facts)).toBe("Remote in Europe (EU, UK) · eligibility implied · TypeScript/Go · senior · EUR 70,000–90,000/year");
    expect(roleFactsLine({ ...facts, pay: { ...facts.pay, min: null, max: null } })).toContain("pay not stated");
  });

  it("quotes: why-fit first, no duplicates, at most three", () => {
    expect(roleQuotes(facts)).toEqual(["You love React", "TypeScript and Go", "Remote within Europe"]);
  });
});
