/**
 * What deciding a lead does: the stack moves on at once, the server records
 * it, and a 7-second toast offers Undo. A decision the server refuses puts the
 * lead back. These live with the page, not the lead's view: an Undo can come
 * after Focus has moved on to the next lead.
 */
import type { SkipReason } from "@llm-job-search/core/queue/actions.ts";
import { toast } from "sonner";
import { useShortlist, useSkip, useSnooze, useUndo } from "@/lib/decisions";
import { formatDay } from "@/lib/format";
import { skipText } from "@/lib/labels";
import type { useStack } from "@/lib/use-stack";
import { type Lead, useConfirmEligible } from "./api.ts";

const UNDO_MS = 7000;

export function useDecisions(stack: ReturnType<typeof useStack<Lead>>) {
  const shortlist = useShortlist();
  const skip = useSkip();
  const snooze = useSnooze();
  const confirmEligible = useConfirmEligible();
  const undo = useUndo();

  /** A decision that's already stored (the Already applied / Other role dialogs): move on and offer Undo. */
  const recorded = (lead: Lead, message: string) => {
    const id = lead.postingId;
    stack.markDecided(id);
    toast(message, {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () =>
          undo.mutateAsync([id]).then(
            () => stack.markOpen(id),
            (e: Error) => toast.error(e.message),
          ),
      },
    });
  };

  const decide = (lead: Lead, message: string, run: () => Promise<unknown>) => {
    stack.markDecided(lead.postingId);
    run().then(
      () => recorded(lead, message),
      (e: Error) => {
        stack.markOpen(lead.postingId);
        toast.error(`${lead.company}: ${e.message}`);
      },
    );
  };

  return {
    shortlist: (lead: Lead) =>
      decide(lead, `Shortlisted ${lead.company} · ${lead.pack ? "pack ready" : "no pack yet"}`, () => shortlist.mutateAsync([lead.postingId])),
    /** The eligibility gate's yes: note how you know, then shortlist. */
    shortlistEligible: (lead: Lead, note: string) =>
      decide(lead, `Shortlisted ${lead.company} · eligibility noted`, async () => {
        await confirmEligible.mutateAsync([lead.postingId, note]);
        await shortlist.mutateAsync([lead.postingId]);
      }),
    skip: (lead: Lead, reason: SkipReason) =>
      decide(lead, `Skipped ${lead.company}: ${skipText(reason)}`, () => skip.mutateAsync([lead.postingId, reason])),
    later: (lead: Lead, until: string) =>
      decide(lead, `${lead.company} is back ${formatDay(new Date(`${until}T12:00`))}`, () => snooze.mutateAsync([lead.postingId, until])),
    recorded,
  };
}
