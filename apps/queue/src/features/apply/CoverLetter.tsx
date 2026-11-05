/** The cover letter: whether the form asks for one, the draft to adjust and copy, or a note that none is needed. */
import { Copy, Mail } from "lucide-react";
import { useDeferredValue } from "react";
import { Chip } from "@/components/jr/Chip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type SubmissionDraft, wordsChanged } from "@/lib/submission";

interface Props {
  form: SubmissionDraft;
  draftLetter: string | null;
  field: "required" | "optional" | "none" | null;
  onChange: (patch: Partial<SubmissionDraft>) => void;
  onCopy: () => void;
}

export function CoverLetter({ form, draftLetter, field, onChange, onCopy }: Props) {
  const letter = useDeferredValue(form.coverLetter);
  const changed = draftLetter && letter !== draftLetter ? wordsChanged(draftLetter, letter) : 0;
  if (form.noCoverLetter)
    return (
      <div className="flex items-center gap-2.5 px-0.5 text-muted-foreground">
        <Mail className="size-3.5" />
        <span className="grow text-[13px]">{field === "none" ? "Cover letter: the form doesn't ask for one." : "No cover letter sent."}</span>
        <Button variant="ghost" size="sm" onClick={() => onChange({ noCoverLetter: false })}>
          Add a letter
        </Button>
      </div>
    );
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border bg-card px-[18px] py-4">
      <div className="flex items-center gap-2.5">
        <span className="grow font-medium">
          Cover letter{field && field !== "none" && <span className="font-normal text-muted-foreground"> · {field} on the form</span>}
        </span>
        {changed > 0 && <Chip tone="warning">edited · {changed} words</Chip>}
      </div>
      <Textarea
        aria-label="Cover letter"
        value={form.coverLetter}
        placeholder={draftLetter ? undefined : "The letter you sent"}
        onChange={(e) => onChange({ coverLetter: e.target.value })}
        className="field-sizing-content min-h-48 text-[13.5px] leading-relaxed text-foreground-2"
      />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onChange({ noCoverLetter: true })}>
          I didn't send one
        </Button>
        <div className="grow" />
        {changed > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ coverLetter: draftLetter ?? "" })}>
            Reset to draft
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={!form.coverLetter.trim()} onClick={onCopy}>
          <Copy />
          Copy letter
        </Button>
      </div>
    </section>
  );
}
