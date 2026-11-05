import type { Facts } from "./facts.ts";
import { quoteFound } from "./quotes.ts";

export interface QuoteWarning {
  field: string;
  quote: string | null;
  problem: "not_found" | "missing";
  /** What the claim was downgraded to. */
  downgraded: string;
}

/**
 * Check every quote in the facts against the posting text. A claim whose
 * evidence isn't found is downgraded, never kept: the eligibility status becomes
 * "unknown", a US-only signal is dropped, a language requirement is cleared.
 *
 * Downgrades lean towards keeping a role alive (recall first): an unverified
 * reason to reject is removed, and missing eligibility evidence becomes
 * "unknown", which leads to Needs check rather than Rejected.
 */
export function verifyFacts(facts: Facts, text: string): { facts: Facts; warnings: QuoteWarning[] } {
  const f: Facts = structuredClone(facts);
  const warnings: QuoteWarning[] = [];
  const ok = (quote: string | null) => quote !== null && quoteFound(quote, text);
  const warn = (field: string, quote: string | null, downgraded: string) =>
    warnings.push({ field, quote, problem: quote === null ? "missing" : "not_found", downgraded });

  // A scope that rejects needs its quote, like every other reason to reject.
  const scopeRejects = f.remote.scope === "us_only" || f.remote.scope === "americas";
  if ((scopeRejects || f.remote.quote !== null) && !ok(f.remote.quote)) {
    warn("remote.quote", f.remote.quote, "remote.scope → unknown");
    f.remote = { scope: "unknown", regions: [], quote: null };
  }

  if (f.eligibility.status !== "unknown" && !ok(f.eligibility.quote)) {
    warn("eligibility.quote", f.eligibility.quote, `eligibility.status ${f.eligibility.status} → unknown`);
    f.eligibility = { status: "unknown", quote: null };
  }

  f.usOnlySignals = f.usOnlySignals.filter((s, i) => {
    if (ok(s.quote)) return true;
    warn(`usOnlySignals[${i}].quote`, s.quote, `signal ${s.signal} dropped`);
    return false;
  });

  if ((f.office.requirement === "required_days" || f.office.requirement === "onsite") && !ok(f.office.quote)) {
    warn("office.quote", f.office.quote, `office.requirement ${f.office.requirement} → unknown`);
    f.office = { requirement: "unknown", location: f.office.location, quote: null };
  }

  const languageClaim = f.languages.required.length > 0;
  if (languageClaim && !ok(f.languages.quote)) {
    warn("languages.quote", f.languages.quote, "language requirements cleared");
    f.languages = { required: [], quote: null };
  }

  if (f.pay.quote !== null && !ok(f.pay.quote)) {
    warn("pay.quote", f.pay.quote, "pay → unknown");
    f.pay = { min: null, max: null, currency: null, period: null, basis: "unknown", quote: null };
  }

  // The languages go with their quote: an unquoted stack would still reject ("stack: Java").
  if (f.stack.quote !== null && !ok(f.stack.quote)) {
    warn("stack.quote", f.stack.quote, "stack languages cleared");
    f.stack = { ...f.stack, primaryLanguages: [], quote: null };
  }

  if (f.contract.quote !== null && !ok(f.contract.quote)) {
    warn("contract.quote", f.contract.quote, "contract mentions cleared");
    f.contract = { b2bMentioned: false, eorMentioned: false, quote: null };
  }

  f.whyFit = f.whyFit.filter((w, i) => {
    if (ok(w.quote)) return true;
    warn(`whyFit[${i}].quote`, w.quote, "point dropped");
    return false;
  });

  f.gaps = f.gaps.map((g, i) => {
    if (g.quote === null || ok(g.quote)) return g;
    warn(`gaps[${i}].quote`, g.quote, "gap kept without its quote");
    return { ...g, quote: null };
  });

  return { facts: f, warnings };
}
