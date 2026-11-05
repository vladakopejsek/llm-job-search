import { placeNames } from "../screen/rules.ts";
import { searchConfig } from "../search-config.ts";
import type { Facts } from "./facts.ts";

/**
 * The candidate's filters as code: from verified facts to a verdict. The same
 * facts always give the same verdict, every rule has a unit test, and changing
 * a filter means changing a line here, not rewording a prompt.
 */

let officeCities: RegExp | undefined;

/** Where the candidate goes to an office (the search config's `officeCities`); anywhere else the role has to be fully remote. */
function inOfficeCity(location: string | null): boolean {
  officeCities ??= placeNames(searchConfig().officeCities);
  return officeCities.test(location ?? "");
}

let spoken: RegExp | undefined;

/** Required languages the candidate doesn't speak. Speaking any one named in an entry ("Portuguese or Spanish") is enough. */
function unspoken(required: string[]): string[] {
  spoken ??= placeNames(["English", ...searchConfig().languages]);
  return required.filter((l) => !spoken!.test(l));
}

/** Fit at or above this is a lead: 5 is "good, but notable gaps" (the rubric), worth the candidate's look. */
export const MIN_FIT = 5;

const TS_FRIENDLY = /^(typescript|javascript|ts|js|node(\.?js)?|react)$/i;
/** Query, shell and markup languages come with any stack, so they don't name one. */
const AUXILIARY = /^(sql|pl\/sql|t-sql|pql|graphql|bash|shell|html|css)$/i;

export type Verdict = "lead" | "rejected" | "needs_check";
type Evidence = "verified" | "partial" | "none";

export interface Decision {
  verdict: Verdict;
  reasons: string[];
  evidence: Evidence;
}

export function decide(f: Facts): Decision {
  const { country } = searchConfig().home;
  const evidence: Evidence = f.eligibility.status === "named" ? "verified" : f.eligibility.status === "implied" ? "partial" : "none";
  const reject: string[] = [];

  // Eligibility
  if (f.eligibility.status === "excluded") reject.push(`${country} excluded`);
  // The scope has no "Americas or Europe": a role open to both comes as "americas" with eligibility implied, which wins.
  if ((f.remote.scope === "us_only" || f.remote.scope === "americas") && evidence === "none") reject.push(`remote scope: ${f.remote.scope}`);
  else if (f.usOnlySignals.length >= 2 && f.eligibility.status === "unknown") {
    reject.push(`US-only signals: ${f.usOnlySignals.map((s) => s.signal).join(", ")}`);
  }
  const officeBound = f.office.requirement === "required_days" || f.office.requirement === "onsite";
  if (officeBound && !inOfficeCity(f.office.location)) {
    reject.push(`office required${f.office.location ? ` in ${f.office.location}` : ""}`);
  }
  for (const language of unspoken(f.languages.required)) reject.push(`${language} required`);

  // Profile
  if (f.seniority === "junior") reject.push("junior role");
  if (f.seniority === "manager") reject.push("people-management role");
  // A stack the posting doesn't name is unknown, not a reason to reject. "Strong SQL" alone doesn't name one either.
  // One entry can name several ("JavaScript/TypeScript", "JavaScript (Node.js)"), and each of them counts.
  const languages = f.stack.primaryLanguages.flatMap((l) => l.split(/\s*[/,()]\s*/)).filter((l) => l && !AUXILIARY.test(l));
  const stackStated = f.stack.typescript || f.stack.react || languages.length > 0;
  const tsSide = f.stack.typescript || f.stack.react || languages.some((l) => TS_FRIENDLY.test(l));
  // A backend role isn't rejected for being backend: the fit score judges how well it matches the profile.
  if (stackStated && !tsSide) reject.push(`stack: ${f.stack.primaryLanguages.join(", ")}`);

  if (reject.length) return { verdict: "rejected", reasons: reject, evidence };

  if (f.eligibility.status === "unknown") {
    return { verdict: "needs_check", reasons: [`eligibility from ${country} unclear`], evidence };
  }
  if (f.fit.score < MIN_FIT) return { verdict: "rejected", reasons: [`low fit (${f.fit.score})`], evidence };
  return { verdict: "lead", reasons: [`fit ${f.fit.score}: ${f.fit.reason}`], evidence };
}
