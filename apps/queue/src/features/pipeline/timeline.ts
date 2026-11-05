/** What each timeline event says, in a title and one line. */

import type { ApplicationDetail } from "@/lib/applications";
import { STAGE_LABELS } from "@/lib/labels";

type Event = ApplicationDetail["timeline"][number];

const SOURCE_TEXT: Record<string, string> = {
  queue: "from the queue",
  tracker: "set by you",
  proposal: "confirmed from the email",
  backfill: "rebuilt from the Notion import",
};

export function eventTitle(e: Event) {
  switch (e.type) {
    case "stage_changed":
      if (e.toStage === "applied" && (!e.fromStage || e.fromStage === "lead" || e.fromStage === "shortlisted")) return "Applied";
      if (e.payload.past && e.toStage) return `${STAGE_LABELS[e.toStage]} · added later`;
      return `${e.fromStage ? `${STAGE_LABELS[e.fromStage]} → ` : ""}${e.toStage ? STAGE_LABELS[e.toStage] : "?"}`;
    case "email_reply":
      return "Email reply";
    case "note":
      return e.payload.context === "call" ? "Call note" : "Note";
    case "answers_saved":
      return "What you sent, logged";
    case "followed_up":
      return "Followed up";
    case "snoozed":
      return "Snoozed";
    default:
      return e.type;
  }
}

/** The line under the title: the note's text, the email's words, or where the change came from. */
export function eventDetail(e: Event): { text: string; quote?: boolean } | null {
  const p = e.payload;
  if (e.type === "note") return p.text ? { text: p.text } : null;
  if (e.type === "email_reply") {
    const snippet = e.evidence?.snippet;
    return snippet
      ? { text: snippet, quote: true }
      : { text: [e.evidence?.from ?? p.from, e.evidence?.subject ?? p.subject].filter(Boolean).join(" · ") };
  }
  if (e.type === "answers_saved") {
    const n = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
    const parts = [n("added") && `${n("added")} added`, n("edited") && `${n("edited")} edited`, n("removed") && `${n("removed")} removed`].filter(
      Boolean,
    );
    return { text: [parts.join(", ") || "no answer changes", p.coverLetterChanged ? "cover letter changed" : null].filter(Boolean).join(" · ") };
  }
  const text = [
    SOURCE_TEXT[e.source],
    p.reason ? `reason: ${String(p.reason).replaceAll("_", " ")}` : null,
    p.note ? `“${p.note}”` : null,
    p.inferred ? "date guessed" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return text ? { text } : null;
}
