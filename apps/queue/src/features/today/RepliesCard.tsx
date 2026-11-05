/** Replies to confirm: stage changes read from Gmail, applied only when you confirm them. */
import { isBehind } from "@llm-job-search/core/applications/constants.ts";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Chip } from "@/components/jr/Chip";
import { Quote } from "@/components/jr/Quote";
import { Button } from "@/components/ui/button";
import type { Overview } from "@/lib/queries";
import { useConfirmReply, useDismissReply } from "./api.ts";
import { Moment } from "./Moment.tsx";

type Reply = Overview["replies"][number];

const stageLabel = (stage: string) => stage.replace("_", " ");

function ReplyRow({ reply }: { reply: Reply }) {
  const confirm = useConfirmReply();
  const dismiss = useDismissReply();
  const busy = confirm.isPending || dismiss.isPending;
  const { from, subject, date, snippet } = reply.evidence;
  return (
    <article className="flex flex-col gap-2.5 border-t pt-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-semibold">{reply.company}</span>
        <span className="grow truncate text-muted-foreground">{reply.role}</span>
        <Chip>{stageLabel(reply.currentStage)}</Chip>
        {isBehind(reply.proposedStage, reply.currentStage) ? (
          // Confirming logs it as a past step (acceptProposal): the stage stays.
          <span className="text-xs text-muted-foreground">an earlier {stageLabel(reply.proposedStage)}, kept as history</span>
        ) : (
          <>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <Chip tone={reply.proposedStage === "rejected" ? "destructive" : "go"}>{stageLabel(reply.proposedStage)}</Chip>
          </>
        )}
      </div>
      <Quote>{snippet}</Quote>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grow font-mono text-[11px] text-muted-foreground">
          {from} · “{subject}” · {date}
        </span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => dismiss.mutate([reply.id], { onError: (e) => toast.error(e.message) })}>
          Dismiss
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => confirm.mutate([reply.id], { onError: (e) => toast.error(e.message) })}>
          Confirm
        </Button>
      </div>
    </article>
  );
}

export function RepliesCard({ replies, className }: { replies: Reply[]; className?: string }) {
  return (
    <Moment title={`Replies to confirm · ${replies.length}`} className={className}>
      {replies.map((reply) => (
        <ReplyRow key={reply.id} reply={reply} />
      ))}
    </Moment>
  );
}
