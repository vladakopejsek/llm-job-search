/** What a lead's evaluated facts say, in the few words a chip or an evidence line needs. */
import type { Overview } from "./queries.ts";

type Facts = Overview["decide"][number]["facts"];

const REMOTE: Record<Facts["remote"]["scope"], string | null> = {
  worldwide: "Remote · worldwide",
  europe: "Remote · Europe",
  specific_countries: "Remote",
  us_only: "US only",
  americas: "Americas only",
  onsite_or_hybrid: "On-site / hybrid",
  unknown: null,
};

function remoteText(remote: Facts["remote"]) {
  const base = REMOTE[remote.scope];
  return base && remote.scope === "specific_countries" && remote.regions.length ? `${base} · ${remote.regions.join(", ")}` : base;
}

function payText(pay: Facts["pay"]) {
  if (pay.min === null && pay.max === null) return null;
  const n = (v: number | null) => (v === null ? "?" : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
  const range = pay.min === pay.max ? n(pay.min) : `${n(pay.min)}–${n(pay.max)}`;
  return `${pay.currency ?? ""} ${range}${pay.period ? ` / ${pay.period}` : ""}`.trim();
}

const contractTerms = (contract: Facts["contract"]) =>
  [contract.b2bMentioned ? "Contractors OK" : null, contract.eorMentioned ? "Hires via EOR" : null].filter((t): t is string => t !== null);

/** The chips under the title: where, how much, on what terms. */
export function factChips(facts: Facts) {
  return [remoteText(facts.remote), payText(facts.pay), ...contractTerms(facts.contract)].filter((c): c is string => c !== null);
}

/** Every fact the evaluation stated, with the posting's own words where it quoted them. */
export function evidence(facts: Facts) {
  const office = facts.office.requirement === "none" || facts.office.requirement === "unknown" ? null : facts.office;
  const languages = facts.languages.required;
  return [
    { label: "Remote", value: remoteText(facts.remote) ?? "not stated", quote: facts.remote.quote },
    { label: "Eligibility", value: facts.eligibility.status, quote: facts.eligibility.quote },
    office && { label: "Office", value: `${office.requirement.replace("_", " ")} ${office.location ?? ""}`.trim(), quote: office.quote },
    { label: "Pay", value: payText(facts.pay) ?? "not stated", quote: facts.pay.quote },
    { label: "Contract", value: contractTerms(facts.contract).join(", ") || "not stated", quote: facts.contract.quote },
    { label: "Stack", value: facts.stack.primaryLanguages.join(", ") || "not stated", quote: facts.stack.quote },
    languages.length ? { label: "Languages", value: languages.join(", "), quote: facts.languages.quote } : null,
    { label: "Level", value: facts.seniority.replace("_", " "), quote: null },
  ].filter((f) => f !== null);
}
