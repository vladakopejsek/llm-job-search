/** Picks worth applying (docs/metrics.md, 4), and why the rest were skipped: wrong picks solid, your preferences dim. */
import { WRONG_PICK_REASONS } from "@llm-job-search/core/queue/feedback.ts";
import { percent } from "@/lib/format";
import { SKIP_LABELS } from "@/lib/labels";
import type { Lab } from "./api.ts";
import { Bar, Card } from "./parts.tsx";

const isWrongPick = (reason: string) => (WRONG_PICK_REASONS as readonly string[]).includes(reason);

export function Picks({ picks, className }: { picks: Lab["picks"]; className?: string }) {
  const reasons = Object.entries(picks.skipReasons).sort((a, b) => b[1] - a[1]);
  const most = reasons[0]?.[1] ?? 0;
  const wrong = reasons.filter(([r]) => isWrongPick(r)).reduce((sum, [, n]) => sum + n, 0);
  return (
    <Card title="Picks worth applying" className={className}>
      <p className="flex items-baseline gap-3">
        <span className="font-mono text-[52px] leading-none tracking-[-0.04em]">{percent(picks.precision)}</span>
        <span className="text-[13px] text-muted-foreground">
          {picks.applied} of {picks.applied + wrong}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">applied ÷ (applied + skips for not eligible, stack or level)</p>
      {reasons.length > 0 && (
        <div className="grid grid-cols-[150px_1fr_28px] items-center gap-x-3 gap-y-2 text-[12.5px]">
          <span className="eyebrow col-span-full">Why you skipped</span>
          {reasons.map(([reason, n]) => (
            <div key={reason} className="contents">
              <span className={isWrongPick(reason) ? undefined : "text-muted-foreground"}>
                {SKIP_LABELS[reason as keyof typeof SKIP_LABELS]?.replace("…", "") ?? reason}
              </span>
              <Bar share={n / most} tone={isWrongPick(reason) ? "on" : "dim"} />
              <span className="font-mono">{n}</span>
            </div>
          ))}
        </div>
      )}
      <p className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-foreground-2" />
          counts as a wrong pick
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-muted-2" />
          your preference
        </span>
      </p>
    </Card>
  );
}
