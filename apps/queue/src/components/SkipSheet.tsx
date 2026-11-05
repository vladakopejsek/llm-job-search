/** Why skip: the reasons that grade the agent's pick, then the ones that record something else. Focus and the apply session share it. */
import { WRONG_PICK_REASONS } from "@llm-job-search/core/queue/feedback.ts";
import { ChevronRight } from "lucide-react";
import { AdaptiveSheet } from "@/components/jr/AdaptiveSheet";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { useHotkeys } from "@/lib/hotkeys";
import { SKIP_LABELS } from "@/lib/labels";

const REASONS = ["not_eligible", "stack", "seniority", "pay", "not_interested"] as const;
const WRONG_PICKS = WRONG_PICK_REASONS.length;

interface Props {
  posting: { company: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSkip: (reason: (typeof REASONS)[number] | "company") => void;
  /** The two reasons that need details open their own dialogs. */
  onAlreadyApplied: () => void;
  onOtherRole: () => void;
}

export function SkipSheet({ posting, open, onOpenChange, onSkip, onAlreadyApplied, onOtherRole }: Props) {
  useHotkeys(Object.fromEntries(REASONS.map((reason, i) => [String(i + 1), () => onSkip(reason)])), open);
  return (
    <AdaptiveSheet open={open} onOpenChange={onOpenChange} title="Why skip?" description={`${posting.company} · ${posting.title}`}>
      <div className="grid grid-cols-2 gap-2">
        {REASONS.map((reason, i) => (
          <Button key={reason} variant="secondary" size="lg" className="justify-between last:col-span-2" onClick={() => onSkip(reason)}>
            {SKIP_LABELS[reason]}
            <KeyHint>{String(i + 1)}</KeyHint>
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">The first {WRONG_PICKS} count as a wrong pick by the agent. The rest are your preference.</p>
      <div className="flex flex-col border-t pt-2">
        <Button variant="ghost" size="lg" className="justify-between px-1 text-foreground" onClick={onAlreadyApplied}>
          Already applied…
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="lg" className="justify-between px-1 text-foreground" onClick={onOtherRole}>
          Applied to another role here…
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="lg" className="justify-start px-1 text-destructive hover:text-destructive" onClick={() => onSkip("company")}>
          Stop watching {posting.company}
        </Button>
      </div>
    </AdaptiveSheet>
  );
}
