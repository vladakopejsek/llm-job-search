/** Later: the lead leaves Decide and comes back on a preset date. Focus and the posting sheet share it. */
import { snoozePresets } from "@llm-job-search/core/queue/snooze.ts";
import { AdaptiveSheet } from "@/components/jr/AdaptiveSheet";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { formatDay, todayIso } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";

interface Props {
  posting: { company: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (until: string) => void;
}

export function LaterSheet({ posting, open, onOpenChange, onSnooze }: Props) {
  const presets = snoozePresets(todayIso());
  useHotkeys(Object.fromEntries(presets.map((p, i) => [String(i + 1), () => onSnooze(p.until)])), open);
  return (
    <AdaptiveSheet open={open} onOpenChange={onOpenChange} title="Back in the stack…" description={`${posting.company} · ${posting.title}`}>
      <div className="flex flex-col gap-2">
        {presets.map((p, i) => (
          <Button key={p.label} variant="secondary" size="lg" className="justify-between" onClick={() => onSnooze(p.until)}>
            <span>
              {p.label} <span className="font-mono text-xs text-muted-foreground">· {formatDay(new Date(`${p.until}T12:00`))}</span>
            </span>
            <KeyHint>{String(i + 1)}</KeyHint>
          </Button>
        ))}
      </div>
    </AdaptiveSheet>
  );
}
