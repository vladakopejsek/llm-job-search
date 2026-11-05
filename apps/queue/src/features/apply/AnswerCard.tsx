/** One question of the form with its answer: read it, adjust it, copy it into the form. */
import { Check, Copy, Trash2 } from "lucide-react";
import { useDeferredValue } from "react";
import { Chip } from "@/components/jr/Chip";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type AnswerRow, isEdited, wordCount, wordsChanged } from "@/lib/submission";
import { cn } from "@/lib/utils";

interface Props {
  row: AnswerRow;
  number: number;
  copied: boolean;
  focused: boolean;
  onChange: (patch: Partial<AnswerRow>) => void;
  onCopy: () => void;
  onRemove: () => void;
  onFocus: () => void;
}

export function AnswerCard({ row, number, copied, focused, onChange, onCopy, onRemove, onFocus }: Props) {
  const answer = useDeferredValue(row.answer);
  const edited = isEdited(row.drafted, answer);
  const changed = edited && row.drafted ? wordsChanged(row.drafted, answer) : 0;
  return (
    <article
      onFocusCapture={onFocus}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-card px-[18px] py-4",
        focused && "border-foreground-2 shadow-[0_0_0_3px_var(--muted)]",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-xs text-muted-foreground">{String(number).padStart(2, "0")}</span>
        {row.origin === "added" && !row.drafted ? (
          <Input
            aria-label={`Question ${number}`}
            value={row.question}
            placeholder="Paste the question from the form"
            onChange={(e) => onChange({ question: e.target.value })}
            className="h-8 grow font-medium"
          />
        ) : (
          <span className="grow font-medium">{row.question}</span>
        )}
        {edited ? (
          <Chip tone="warning">edited · {changed} words</Chip>
        ) : (
          copied && (
            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-[0.05em] text-primary-ink uppercase">
              <Check className="size-3.5" />
              copied
            </span>
          )
        )}
      </div>

      {row.kind === "choice" ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            aria-label={`Answer ${number}`}
            value={row.answer}
            onChange={(e) => onChange({ answer: e.target.value })}
            className="field-sizing-content h-8 w-auto max-w-full min-w-24 font-semibold"
          />
          <span className="text-[13px] text-muted-foreground">
            {[row.why, row.options?.length ? `Options: ${row.options.join(" · ")}` : null].filter(Boolean).join(" ")}
          </span>
        </div>
      ) : (
        <Textarea
          aria-label={`Answer ${number}`}
          value={row.answer}
          placeholder="Your answer, as you'll send it"
          onChange={(e) => onChange({ answer: e.target.value })}
          className="field-sizing-content min-h-16 text-[13.5px] leading-relaxed text-foreground-2"
        />
      )}

      <div className="flex items-center gap-2">
        <Chip>{row.origin === "pack" ? "from pack" : "added"}</Chip>
        <span className="grow font-mono text-[11px] text-muted-foreground">{wordCount(answer)} words</span>
        {edited && row.drafted && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ answer: row.drafted ?? "" })}>
            Reset to draft
          </Button>
        )}
        {row.origin === "added" && (
          <Button variant="ghost" size="icon-sm" aria-label={`Remove question ${number}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
        <Button variant={focused ? "outline" : "ghost"} size="sm" disabled={!row.answer.trim()} onClick={onCopy}>
          <Copy />
          Copy
          {focused && <KeyHint>C</KeyHint>}
        </Button>
      </div>
    </article>
  );
}
