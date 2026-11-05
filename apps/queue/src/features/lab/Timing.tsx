/** Time per decision (docs/metrics.md, 2 and 3): triage per lead, applying with the pack and without it. */
import { ExperimentSwitch } from "@/timing/ExperimentSwitch";
import { type Lab, SMALL } from "./api.ts";
import { Bar, Card, sampleText } from "./parts.tsx";

/** Minutes as m:ss. */
const clock = (minutes: number | null) =>
  minutes === null ? "–" : `${Math.floor(minutes)}:${String(Math.round((minutes % 1) * 60)).padStart(2, "0")}`;

export function Timing({ timing, className }: { timing: Lab["timing"]; className?: string }) {
  const pack = timing.byArm.pack?.apply;
  const noPack = timing.byArm.no_pack?.apply;
  const rows = [
    { label: "Triage · per lead", minutes: timing.triage.medianMinutes, n: timing.triage.decided, tone: "on" as const },
    { label: "Apply · with pack", minutes: pack?.medianMinutes ?? null, n: pack?.applied ?? 0, tone: "go" as const },
    { label: "Apply · without pack", minutes: noPack?.medianMinutes ?? null, n: noPack?.applied ?? 0, tone: "on" as const },
  ];
  const longest = Math.max(...rows.map((r) => r.minutes ?? 0), 0);
  const saving = pack?.medianMinutes && noPack?.medianMinutes ? 1 - pack.medianMinutes / noPack.medianMinutes : null;
  const smallArm = Math.min(pack?.applied ?? 0, noPack?.applied ?? 0) < SMALL;

  return (
    <Card title="Time per decision · median" aside={<ExperimentSwitch />} className={className}>
      <div className="grid grid-cols-[150px_1fr_90px] items-center gap-x-3.5 gap-y-3.5 text-[13px] md:grid-cols-[170px_1fr_110px]">
        {rows.map((r) => {
          const small = r.n < SMALL;
          return (
            <div key={r.label} className="contents">
              <span className={small ? "text-muted-foreground" : undefined}>{r.label}</span>
              <Bar share={longest ? (r.minutes ?? 0) / longest : 0} tone={small ? "faint" : r.tone} />
              <span className={`text-right font-mono ${small ? "text-muted-foreground" : ""}`}>
                {clock(r.minutes)} <span className="text-[11px] text-muted-foreground">{sampleText(r.n, SMALL)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="h-px bg-border" />
      <p className="text-[13px] text-foreground-2">
        {saving === null
          ? "The pack vs no-pack comparison needs applications in both arms. Turn the experiment on and apply as usual: each lead with a pack is assigned an arm."
          : `With the pack, applying takes about ${Math.abs(Math.round(saving * 100))}% ${saving >= 0 ? "less" : "more"} time.${smallArm ? " Early signal: an arm has fewer than 5 applications." : ""}`}
      </p>
      <p className="font-mono text-[11px] text-muted-foreground">
        {timing.untimed.applied + timing.untimed.skipped + timing.untimed.shortlisted} decisions untimed · gaps over 30 min removed
      </p>
    </Card>
  );
}
