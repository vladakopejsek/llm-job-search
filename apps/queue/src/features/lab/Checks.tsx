/** What the checks catch (docs/metrics.md, 5): every agent submission, and what code stopped before it reached you. */
import type { Lab } from "./api.ts";
import { Bar, Card } from "./parts.tsx";

/** Problem codes shown, most frequent first. */
const TOP = 5;

export function Checks({ checks, className }: { checks: Lab["checks"]; className?: string }) {
  const codes = Object.entries(checks.problemsByCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP);
  const most = codes[0]?.[1] ?? 0;
  const figures = [
    { n: checks.items, label: "items submitted" },
    { n: checks.firstTryClean, label: "clean on the first try" },
    { n: checks.fixedOnRetry, label: "fixed on a retry" },
    { n: checks.neverStored, label: "never stored" },
  ];
  return (
    <Card title="What the checks catch · agent attempts" className={className}>
      <div className="flex flex-wrap gap-x-7 gap-y-3">
        {figures.map((f) => (
          <div key={f.label}>
            <div className="font-mono text-[28px] leading-tight">{f.n}</div>
            <div className="text-xs text-muted-foreground">{f.label}</div>
          </div>
        ))}
      </div>
      {codes.length > 0 && (
        <div className="grid grid-cols-[minmax(0,200px)_1fr_36px] items-center gap-x-3 gap-y-2 text-[12.5px]">
          <span className="eyebrow col-span-full">Top problems · every one stopped before it reached you</span>
          {codes.map(([code, n]) => (
            <div key={code} className="contents">
              <span className="truncate font-mono">{code}</span>
              <Bar share={n / most} />
              <span className="text-right font-mono">{n}</span>
            </div>
          ))}
        </div>
      )}
      {checks.fileErrors > 0 && <p className="text-xs text-muted-foreground">{checks.fileErrors} unreadable files.</p>}
    </Card>
  );
}
