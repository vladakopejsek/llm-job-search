/** Words for the app's codes, shared by old and new screens. */
import type { Stage } from "@llm-job-search/core/applications/constants.ts";
import type { SkipReason } from "@llm-job-search/core/queue/actions.ts";

export const SKIP_LABELS: Record<SkipReason, string> = {
  not_eligible: "Not eligible",
  stack: "Wrong stack",
  seniority: "Wrong level",
  pay: "Pay",
  not_interested: "Not interested",
  already_applied: "Already applied…",
  applied_other_role: "Applied to another role…",
  company: "Stop watching company",
};

/** A skip reason in a sentence: "Skipped · wrong stack". */
export const skipText = (reason: string | null) =>
  reason && reason in SKIP_LABELS ? SKIP_LABELS[reason as SkipReason].replace("…", "").toLowerCase() : "no reason";

export const STAGE_LABELS: Record<Stage, string> = {
  lead: "lead",
  shortlisted: "shortlisted",
  applied: "applied",
  screening: "screening",
  interviewing: "interview",
  offer: "offer",
  rejected: "rejected",
  no_response: "no response",
  skipped: "skipped",
};
