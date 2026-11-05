/** Search what was sent in earlier applications, and insert a question and its answer into this one. */
import { splitHighlights } from "@llm-job-search/core/lib/highlight.ts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdaptiveSheet } from "@/components/jr/AdaptiveSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { pastAnswersQuery } from "./api.ts";

/** The search marks matches in its snippets; each is drawn as bold text, never as HTML (the text is scraped). */
function Marked({ text }: { text: string }) {
  return splitHighlights(text).map((s, i) =>
    s.hit ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: fragments of one string, never reordered
      <b key={i} className="font-semibold text-foreground">
        {s.text}
      </b>
    ) : (
      s.text
    ),
  );
}

export function PastAnswers({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (question: string, answer: string) => void;
}) {
  const [q, setQ] = useState("");
  const { data, isFetching, error } = useQuery(pastAnswersQuery(useDebounced(q)));
  return (
    <AdaptiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Past answers"
      description="Questions repeat across forms: start from what you sent before."
    >
      <Input autoFocus value={q} placeholder="e.g. notice period" onChange={(e) => setQ(e.target.value)} aria-label="Search past answers" />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {data && !data.length && !isFetching && <p className="text-sm text-muted-foreground">Nothing sent before matches “{q}”.</p>}
      <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
        {data?.map((hit) => (
          <li key={`${hit.applicationId}:${hit.question}`} className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <div className="flex min-w-0 grow flex-col gap-1">
              <span className="font-mono text-[11px] text-muted-foreground">
                {hit.company}
                {hit.role && ` · ${hit.role}`} · {formatDate(hit.appliedOn)}
              </span>
              <span className="text-muted-foreground">
                “<Marked text={hit.questionHeadline} />” → “<Marked text={hit.answerHeadline} />”
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => onInsert(hit.question, hit.answer)}>
              Insert
            </Button>
          </li>
        ))}
      </ul>
    </AdaptiveSheet>
  );
}
