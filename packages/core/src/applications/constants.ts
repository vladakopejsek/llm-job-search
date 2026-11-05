/**
 * Application vocabulary shared by the database schema, the server and the
 * browser. Plain values and Zod only: the queue app bundles this file.
 */
import { z } from "zod";

/** "shortlisted": the candidate said yes to a lead and will apply; its prep pack is drafted first. */
export const STAGES = ["lead", "shortlisted", "applied", "screening", "interviewing", "offer", "rejected", "no_response", "skipped"] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

/** Decisions about a posting that aren't applications: the tracker leaves them out. */
export const PRE_APPLY_STAGES = ["lead", "shortlisted", "skipped"] as const satisfies readonly Stage[];
export const isPreApply = (stage: Stage) => (PRE_APPLY_STAGES as readonly Stage[]).includes(stage);
/** Stages where the company is talking to the candidate; its other roles wait. */
export const ACTIVE_STAGES = ["applied", "screening", "interviewing", "offer"] as const satisfies readonly Stage[];
/** Stages the company can move an application to by replying. */
export const RESPONSE_STAGES = ["screening", "interviewing", "offer", "rejected"] as const satisfies readonly Stage[];
/** How far an application got, in order. A later stage implies the earlier ones. */
export const PROGRESS = ["applied", "screening", "interviewing", "offer"] as const satisfies readonly Stage[];
/**
 * A reply proposing a stage the application is already past (a screening invite confirmed once it's
 * interviewing, or rejected): history, not a move. A rejection is never behind; a reply to an
 * application given up on (no_response) revives it.
 */
export function isBehind(proposed: Stage, current: Stage): boolean {
  const order = PROGRESS as readonly Stage[];
  return proposed !== "rejected" && (current === "rejected" || order.indexOf(proposed) < order.indexOf(current));
}

export const CHANNELS = ["ats_form", "email", "linkedin", "referral", "recruiter", "other"] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;
export const CHANNEL_LABELS: Record<Channel, string> = {
  ats_form: "Company form (ATS)",
  email: "Email",
  linkedin: "LinkedIn",
  referral: "Referral",
  recruiter: "Recruiter",
  other: "Other",
};

/** "queue": decided in the queue. "outside": applied elsewhere, logged as "Already applied". "import": the Notion tracker. */
const ORIGINS = ["queue", "outside", "import"] as const;
export type Origin = (typeof ORIGINS)[number];

const EVENT_SOURCES = ["queue", "tracker", "proposal", "backfill"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const NOTE_CONTEXTS = ["call", "general"] as const;

/** What the next scheduled step with the company is. */
export const NEXT_STEP_KINDS = ["screening", "interview", "other"] as const;
/** Stages that end an application: its next step, if any, is cleared. */
export const CLOSED_STAGES = ["rejected", "no_response", "skipped"] as const satisfies readonly Stage[];

/** Days without a reply before an application shows up in Follow-ups. */
export const FOLLOW_UP_AFTER_DAYS = 14;
/** An application logged as "Already applied" this long ago won't be offered for a follow-up. */
export const OUTSIDE_FOLLOW_UP_MAX_DAYS = 28;
/** No reply after this many days counts as ghosted in the tracker. */
export const GHOST_AFTER_DAYS = 30;

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
