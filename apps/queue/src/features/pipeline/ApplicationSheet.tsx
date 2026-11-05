/** One application, over the Pipeline: where it stands, the next step, what you sent, and its history. A full page on the phone. */
import { CHANNEL_LABELS, type Channel } from "@llm-job-search/core/applications/constants.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useState } from "react";
import { StageTrack, trackStep } from "@/components/jr/StageTrack";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { type ApplicationDetail, applicationQuery } from "@/lib/applications";
import { formatDate } from "@/lib/format";
import { type PipelineRow, useRejectionReason } from "./api.ts";
import { NextStep } from "./NextStep.tsx";
import { SentSection } from "./SentSection.tsx";
import { StageDialog } from "./StageDialogs.tsx";
import { Timeline } from "./Timeline.tsx";

function RejectionReason({ applicationId, reason }: { applicationId: number; reason: string | null }) {
  const save = useRejectionReason();
  const [text, setText] = useState(reason ?? "");
  return (
    <section className="flex flex-col gap-2">
      <h3 className="eyebrow">Why they said no</h3>
      <Textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="The email's words, or your own note"
        aria-label="Rejection reason"
      />
      {text !== (reason ?? "") && (
        <Button size="sm" variant="outline" className="self-start" disabled={save.isPending} onClick={() => save.mutate([applicationId, text])}>
          Save reason
        </Button>
      )}
    </section>
  );
}

function Body({ detail, row }: { detail: ApplicationDetail; row: PipelineRow | undefined }) {
  const [dialog, setDialog] = useState<"move" | "past" | null>(null);
  const a = detail.application;
  const closed = a.stage === "rejected" || a.stage === "no_response";
  const url = detail.posting?.url ?? a.roleUrl;
  const sent = [
    a.appliedOn && `applied ${formatDate(a.appliedOn)}`,
    a.channel && `via ${CHANNEL_LABELS[a.channel as Channel]?.toLowerCase() ?? a.channel}`,
  ].filter(Boolean);
  return (
    <>
      <div className="flex flex-col gap-3.5 border-b px-5 pt-6 pb-5 md:px-7">
        <div className="flex items-center gap-2.5 pr-8">
          <SheetDescription className="eyebrow grow">{[a.company, ...sent].join(" · ")}</SheetDescription>
          {url && (
            <Button variant="ghost" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ArrowUpRight />
                Posting
              </a>
            </Button>
          )}
        </div>
        <SheetTitle className="text-[28px] leading-[1.08] font-semibold tracking-[-0.035em]">{a.role ?? "Untitled role"}</SheetTitle>
        {row && <StageTrack reached={trackStep(row.reached, row.responded)} ended={closed} labelled />}
        {!closed && (
          <NextStep key={String(a.nextStepAt)} applicationId={a.id} step={{ at: a.nextStepAt, kind: a.nextStepKind, with: a.nextStepWith }} />
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialog("move")}>
            Change stage
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog("past")}>
            Add a past step
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-[22px] px-5 py-5 md:px-7">
        {a.stage === "rejected" && <RejectionReason key={a.rejectionReason} applicationId={a.id} reason={a.rejectionReason} />}
        <SentSection applicationId={a.id} submission={detail.submission} />
        <div className="h-px bg-border" />
        <Timeline applicationId={a.id} events={detail.timeline} />
        {detail.postingText && (
          <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger className="group flex items-center gap-2 text-left">
              <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <span className="eyebrow">
                Posting text
                {detail.postingText.pinned && detail.postingText.capturedAt ? ` · as of ${formatDate(detail.postingText.capturedAt)}` : ""}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="max-h-[50vh] overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-2">
              {detail.postingText.text}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      {dialog && <StageDialog key={dialog} applicationId={a.id} current={a.stage} kind={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

export function ApplicationSheet({ id, row, onClose }: { id: number | undefined; row: PipelineRow | undefined; onClose: () => void }) {
  const { data, error } = useQuery({ ...applicationQuery(id ?? 0), enabled: id !== undefined });
  return (
    <Sheet open={id !== undefined} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
        {error && <p className="p-7 text-destructive">{error.message}</p>}
        {/* Keyed: switching to another application mustn't carry half-typed edits over. */}
        {data && <Body key={data.application.id} detail={data} row={row} />}
        {!data && !error && <SheetTitle className="sr-only">Loading application</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}
