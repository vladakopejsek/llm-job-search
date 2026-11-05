/** Evidence on demand: the pack, the facts with their quotes, and the posting text, each one key away. */
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { EvidenceList } from "@/components/EvidenceList";
import { KeyHint } from "@/components/jr/KeyHint";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { evidence } from "@/lib/facts";
import { formatDate } from "@/lib/format";
import { type Lead, postingTextQuery } from "./api.ts";

export type Detail = "pack" | "evidence" | "text";

function Row({
  name,
  summary,
  hint,
  open,
  onToggle,
  children,
}: {
  name: string;
  summary: ReactNode;
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="border-t first:border-t-0">
      <CollapsibleTrigger className="group grid min-h-12 w-full grid-cols-[18px_1fr_auto] items-center gap-x-3 px-4 text-left md:min-h-14 md:grid-cols-[18px_160px_1fr_auto] md:px-5">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="font-medium">{name}</span>
        <span className="truncate text-[13px] text-muted-foreground max-md:hidden">{summary}</span>
        <KeyHint>{hint}</KeyHint>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-5 md:pl-[54px]">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function PackDetails({ lead, pack }: { lead: Lead; pack: NonNullable<Lead["pack"]> }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>{pack.summary}</p>
      {lead.payTarget && (
        <p>
          <span className="eyebrow mr-2">Ask for</span>
          <span className="font-mono">{lead.payTarget.text}</span>
          {lead.payTarget.warning && <span className="block text-warning">{lead.payTarget.warning}</span>}
        </p>
      )}
      {pack.applicationAnswers.map((a) => (
        <div key={a.question} className="flex flex-col gap-1">
          <span className="font-medium">{a.question}</span>
          <span className="whitespace-pre-wrap text-foreground-2">
            {a.answer}
            {a.why && <span className="text-muted-foreground"> · {a.why}</span>}
          </span>
        </div>
      ))}
      {lead.youAnswer.length > 0 && <p className="text-muted-foreground">Yours to answer: {lead.youAnswer.join(" · ")}</p>}
      <p className="text-muted-foreground">{pack.coverLetter ? "Cover letter drafted." : "No cover letter: the form doesn't ask for one."}</p>
    </div>
  );
}

function PostingText({ lead }: { lead: Lead }) {
  const { data, error } = useQuery(postingTextQuery(lead));
  if (error) return <p className="text-destructive">{error.message}</p>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  return <div className="max-h-[60vh] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-foreground-2">{data.text}</div>;
}

export function Details({
  lead,
  showPack,
  open,
  onToggle,
}: {
  lead: Lead;
  showPack: boolean;
  open: ReadonlySet<Detail>;
  onToggle: (d: Detail) => void;
}) {
  const facts = evidence(lead.facts);
  const pack = lead.pack;
  const answers = pack?.applicationAnswers.length ?? 0;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {showPack && (
        <Row
          name="Pack"
          hint="P"
          open={open.has("pack") && !!pack}
          onToggle={() => onToggle("pack")}
          summary={
            pack
              ? [
                  `${answers} ${answers === 1 ? "answer" : "answers"} drafted`,
                  lead.payTarget && `ask ${lead.payTarget.text}`,
                  pack.coverLetter ? "letter drafted" : "no letter needed",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "not drafted yet: shortlist it, then Draft packs on Today"
          }
        >
          {pack && <PackDetails lead={lead} pack={pack} />}
        </Row>
      )}
      <Row
        name="Evidence"
        hint="E"
        open={open.has("evidence")}
        onToggle={() => onToggle("evidence")}
        summary={`${facts.length} facts, ${facts.filter((f) => f.quote).length} quoted`}
      >
        <EvidenceList facts={lead.facts} />
      </Row>
      <Row
        name="Posting text"
        hint="O"
        open={open.has("text")}
        onToggle={() => onToggle("text")}
        summary={`captured ${formatDate(lead.textCapturedAt)}`}
      >
        {open.has("text") && <PostingText lead={lead} />}
      </Row>
    </div>
  );
}
