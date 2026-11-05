/**
 * Any posting, opened from ⌘K: what it is, the verdict and why, the facts
 * with their quotes, the text, your decision, and "Wrong verdict?" to have the
 * next run look at it again.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EvidenceList } from "@/components/EvidenceList";
import { Chip } from "@/components/jr/Chip";
import { FitMeter } from "@/components/jr/FitMeter";
import { LaterSheet } from "@/components/LaterSheet";
import { AlreadyAppliedSheet, OtherRoleSheet } from "@/components/SkipDetails";
import { SkipSheet } from "@/components/SkipSheet";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useShortlist, useSkip, useSnooze, useUndo } from "@/lib/decisions";
import { formatDate } from "@/lib/format";
import { closePosting, useOverlays } from "@/lib/overlays";
import { track } from "@/timing/track";
import { decisionText, type PostingDetail, postingQuery, useCancelReevaluation, useReevaluate } from "./api.ts";

const VERDICT: Record<string, { label: string; tone: "go" | "warning" | "outline" }> = {
  lead: { label: "lead", tone: "go" },
  needs_check: { label: "Eligibility unclear", tone: "warning" },
  rejected: { label: "rejected", tone: "outline" },
};
/** Undo is refused once the company has replied; these are the stages it can take back. */
const UNDOABLE = new Set(["lead", "skipped", "shortlisted", "applied"]);

function Decision({ detail }: { detail: PostingDetail }) {
  const shortlist = useShortlist();
  const skip = useSkip();
  const snooze = useSnooze();
  const undo = useUndo();
  const [sheet, setSheet] = useState<"skip" | "later" | "already_applied" | "other_role" | null>(null);
  const { posting, application } = detail;
  const id = posting.id;
  const target = { postingId: id, company: posting.company.name, title: posting.title };
  const decided = decisionText(application);
  const busy = shortlist.isPending || skip.isPending || snooze.isPending || undo.isPending;
  const close = (open: boolean) => !open && setSheet(null);
  const done = (message: string) => {
    setSheet(null);
    toast(message);
  };

  if (decided)
    return (
      <div className="flex items-center gap-3 rounded-xl bg-muted px-4 py-3">
        <span className="grow">{decided}</span>
        {application && UNDOABLE.has(application.stage) && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => undo.mutate([id], { onError: (e) => toast.error(e.message) })}>
            Undo
          </Button>
        )}
      </div>
    );
  if (posting.closedAt) return <p className="text-sm text-muted-foreground">Closed {formatDate(posting.closedAt)}: nothing to decide.</p>;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            shortlist.mutate([id], { onSuccess: () => toast(`Shortlisted ${posting.company.name}`), onError: (e) => toast.error(e.message) })
          }
        >
          Yes · shortlist
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setSheet("skip")}>
          Skip
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setSheet("later")}>
          Later
        </Button>
      </div>
      <SkipSheet
        posting={target}
        open={sheet === "skip"}
        onOpenChange={close}
        onSkip={(reason) =>
          skip.mutate([id, reason], { onSuccess: () => done(`Skipped ${posting.company.name}`), onError: (e) => toast.error(e.message) })
        }
        onAlreadyApplied={() => setSheet("already_applied")}
        onOtherRole={() => setSheet("other_role")}
      />
      <LaterSheet
        posting={target}
        open={sheet === "later"}
        onOpenChange={close}
        onSnooze={(until) =>
          snooze.mutate([id, until], { onSuccess: () => done(`Snoozed until ${formatDate(until)}`), onError: (e) => toast.error(e.message) })
        }
      />
      <AlreadyAppliedSheet posting={target} open={sheet === "already_applied"} onOpenChange={close} onDone={done} />
      <OtherRoleSheet posting={target} open={sheet === "other_role"} onOpenChange={close} onDone={done} />
    </>
  );
}

function WrongVerdict({ detail }: { detail: PostingDetail }) {
  const request = useReevaluate();
  const cancel = useCancelReevaluation();
  const [note, setNote] = useState("");
  const pending = detail.reevaluation;
  return (
    <Collapsible className="flex flex-col gap-2.5" defaultOpen={!!pending}>
      <CollapsibleTrigger className="group flex items-center gap-2 text-left">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="eyebrow">Wrong verdict?</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2.5">
        {pending ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="grow text-muted-foreground">
              Asked {formatDate(pending.requestedAt)}; the next run evaluates it again.{pending.note && ` Your note: “${pending.note}”`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate([detail.posting.id], { onError: (e) => toast.error(e.message) })}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What's wrong with it (only for you; the agent never sees it)"
              aria-label="Note"
            />
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={request.isPending}
              onClick={() =>
                request.mutate([detail.posting.id, note], {
                  onSuccess: () => toast("The next run evaluates it again"),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Evaluate again
            </Button>
            {request.error && <p className="text-sm text-destructive">{request.error.message}</p>}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Body({ detail }: { detail: PostingDetail }) {
  const { posting, evaluation } = detail;
  const verdict = evaluation && VERDICT[evaluation.verdict];
  const eyebrow = [
    posting.company.name,
    posting.company.priority && `priority ${posting.company.priority}`,
    posting.postedAt && `posted ${formatDate(posting.postedAt)}`,
    posting.company.ats !== "none" && posting.company.ats !== "other" && posting.company.ats,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-5 px-5 py-6 md:px-7">
      <div className="flex items-center gap-2.5 pr-8">
        <SheetDescription className="eyebrow grow">{eyebrow.join(" · ")}</SheetDescription>
        <Button variant="ghost" size="sm" asChild>
          <a href={posting.url} target="_blank" rel="noreferrer" onClick={() => track("posting_opened", posting.id)}>
            <ArrowUpRight />
            Posting
          </a>
        </Button>
      </div>
      <SheetTitle className="text-[28px] leading-[1.08] font-semibold tracking-[-0.035em]">{posting.title}</SheetTitle>
      {evaluation ? (
        <div className="flex flex-col gap-2.5 rounded-xl border bg-card px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <FitMeter score={evaluation.fitScore ?? 0} />
            <span className="font-mono">{evaluation.fitScore ?? "?"}/10</span>
            {verdict && <Chip tone={verdict.tone}>{verdict.label}</Chip>}
            {posting.closedAt && <Chip>closed</Chip>}
          </div>
          <p className="text-[13px] text-muted-foreground">{evaluation.reasons.join(" · ")}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not evaluated{posting.screenStatus === "reject" ? `: the screen left it out (${posting.screenReason ?? "a rule"})` : " yet"}.
        </p>
      )}
      <Decision detail={detail} />
      {evaluation && (
        <section className="flex flex-col gap-3">
          <h3 className="eyebrow">Facts</h3>
          <EvidenceList facts={evaluation.facts} />
        </section>
      )}
      <Collapsible className="flex flex-col gap-2">
        <CollapsibleTrigger className="group flex items-center gap-2 text-left">
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="eyebrow">Posting text · first seen {formatDate(posting.firstSeenAt)}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="max-h-[50vh] overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-2">
          {posting.text}
        </CollapsibleContent>
      </Collapsible>
      <WrongVerdict detail={detail} />
    </div>
  );
}

export function PostingSheet() {
  const { postingId } = useOverlays();
  const { data, error } = useQuery({ ...postingQuery(postingId ?? 0), enabled: postingId !== null });
  return (
    <Sheet open={postingId !== null} onOpenChange={(open) => !open && closePosting()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
        {error && <p className="p-7 text-destructive">{error.message}</p>}
        {data && <Body key={data.posting.id} detail={data} />}
        {!data && !error && <SheetTitle className="sr-only">Loading posting</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}
