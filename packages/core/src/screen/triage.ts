import { companyKeys } from "./company-key.ts";

/**
 * What to do with a posting that passed the screen, given what the candidate
 * already knows. Order matters: the first matching category wins.
 */
export type Triage =
  | { category: "tracked"; detail: string } // this exact role is in the Job search tracker
  | { category: "company_rejected"; detail: string } // the company rejected the candidate
  | { category: "company_in_process"; detail: string } // another role at a company already contacted
  | { category: "judged"; detail: string } // the old pipeline decided on this role
  | { category: "new"; detail: string };

export interface TriageContext {
  /** posting key → tracker stage, for tracker rows with a role URL */
  trackedRoles: Map<string, string>;
  /** company key → tracker stages of that company */
  companyStages: Map<string, Set<string>>;
  /** posting key → old pipeline verdict (only rejections settle a role) */
  priorVerdicts: Map<string, string>;
}

/** An application in one of these stages is active: the company's other roles wait until it ends. */
const ACTIVE_STAGES = ["applied", "screening", "interviewing", "offer"];

export function buildTriageContext(
  applications: { company: string; stage: string; postingKey: string | null }[],
  priorVerdicts: { postingKey: string; verdict: string }[],
): TriageContext {
  const ctx: TriageContext = { trackedRoles: new Map(), companyStages: new Map(), priorVerdicts: new Map() };
  for (const a of applications) {
    if (a.postingKey) ctx.trackedRoles.set(a.postingKey, a.stage);
    for (const key of companyKeys(a.company)) {
      const stages = ctx.companyStages.get(key) ?? new Set<string>();
      stages.add(a.stage);
      ctx.companyStages.set(key, stages);
    }
  }
  // Only the old pipeline's rejections settle a role. Its leads were the old
  // queue: they're evaluated again and get packs in the new format.
  for (const v of priorVerdicts) {
    if (v.verdict === "rejected") ctx.priorVerdicts.set(v.postingKey, v.verdict);
  }
  return ctx;
}

export function triage(posting: { postingKey: string; companyName: string; boardToken: string | null }, ctx: TriageContext): Triage {
  // Only a decision takes a role out. A tracker "lead" (never applied to) is
  // still a candidate: the old pipeline's leads must reach the new queue.
  const tracked = ctx.trackedRoles.get(posting.postingKey);
  if (tracked && tracked !== "lead") return { category: "tracked", detail: `in the tracker as ${tracked}` };

  // Match the company by its name and by its board token (e.g. "oakslab").
  const keys = [...companyKeys(posting.companyName), ...(posting.boardToken ? companyKeys(posting.boardToken) : [])];
  const stages = new Set(keys.flatMap((k) => [...(ctx.companyStages.get(k) ?? [])]));
  if (stages.has("rejected")) return { category: "company_rejected", detail: "the company rejected you" };
  const inProcess = ACTIVE_STAGES.filter((s) => stages.has(s));
  if (inProcess.length) return { category: "company_in_process", detail: `company is ${inProcess.join(", ")}` };

  const verdict = ctx.priorVerdicts.get(posting.postingKey);
  if (verdict) return { category: "judged", detail: `old pipeline: ${verdict}` };

  if (tracked === "lead") return { category: "new", detail: "a lead in your tracker" };
  if (stages.has("no_response")) return { category: "new", detail: "an earlier application there got no response" };
  return { category: "new", detail: stages.has("lead") ? "company is a Lead in the tracker" : "" };
}
