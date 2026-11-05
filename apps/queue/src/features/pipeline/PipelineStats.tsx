/** How the search is going over the range: four tiles, then the funnel from applying to an offer. */
import type { ReactNode } from "react";
import { percent } from "@/lib/format";
import type { statsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Stats = Awaited<ReturnType<NonNullable<ReturnType<typeof statsQuery>["queryFn"]>>>;

const STEP_LABELS: Record<string, string> = {
  applied: "Applied",
  replied: "Replied",
  screening: "Screening",
  interviewing: "Interview",
  offer: "Offer",
};
const RANGE_LABELS: Record<string, string> = { "30d": "last 30 days", "90d": "last 90 days", all: "all time" };

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3.5 md:px-[18px] md:py-4">
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-2xl leading-tight font-medium tracking-[-0.03em] md:text-[30px]">
        {value} {note && <span className="text-sm font-normal tracking-normal text-muted-foreground">{note}</span>}
      </span>
    </div>
  );
}

export function Tiles({ stats }: { stats: Stats }) {
  const t = stats.tiles;
  const active = [
    t.activePipeline.interviewing && `${t.activePipeline.interviewing} interview`,
    t.activePipeline.screening && `${t.activePipeline.screening} screen`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label="Applied" value={t.applications.thisWeek} note={`this wk · ${t.applications.n} total`} />
      <Tile label="Response rate" value={percent(t.responseRate.rate)} note={`${t.responseRate.responded} of ${t.responseRate.n}`} />
      <Tile label="Active" value={t.activePipeline.n} note={active || undefined} />
      <Tile label={`Ghosted ${t.ghosted.afterDays}d+`} value={t.ghosted.n} />
    </div>
  );
}

/** Neutral bars, each as long as its share of the first step; the number and the step's conversion beside it. */
export function Funnel({ stats }: { stats: Stats }) {
  const first = stats.funnel.steps[0]?.n ?? 0;
  return (
    <section className="grid grid-cols-[84px_1fr_76px] items-center gap-x-3.5 gap-y-2 rounded-xl border bg-card px-5 py-[18px] text-[13px] md:grid-cols-[110px_1fr_76px]">
      <h2 className="eyebrow col-span-full pb-1">Funnel · {RANGE_LABELS[stats.range]}</h2>
      {stats.funnel.steps.map((s) => (
        <div key={s.step} className="contents">
          <span>{STEP_LABELS[s.step] ?? s.step}</span>
          <div
            className={cn("h-2.5 min-w-0.5 rounded-r-[4px]", s.n ? "bg-foreground-2" : "bg-muted-2")}
            style={{ width: first ? `${(s.n / first) * 100}%` : 0 }}
          />
          <span className={cn("text-right font-mono", !s.n && "text-muted-foreground")}>
            {s.n} {s.conversion !== null && <span className="text-muted-foreground">{percent(s.conversion)}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}
