/** Four numbers on how the search is going: as columns (desktop header) or one line (phone, page bottom). */
import { percent } from "@/lib/format";
import type { statsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Tiles = Awaited<ReturnType<NonNullable<ReturnType<typeof statsQuery>["queryFn"]>>>["tiles"];

export function WeekStats({ tiles, layout, className }: { tiles: Tiles; layout: "columns" | "line"; className?: string }) {
  const stats = [
    { label: "applied / wk", value: tiles.applications.thisWeek },
    { label: "response", value: percent(tiles.responseRate.rate) },
    { label: "active", value: tiles.activePipeline.n },
    { label: "ghosted", value: tiles.ghosted.n },
  ];
  if (layout === "line") {
    return (
      <p className={cn("text-center font-mono text-[11px] text-muted-foreground", className)}>
        {stats.map(({ label, value }) => `${value} ${label}`).join(" · ")}
      </p>
    );
  }
  return (
    <dl className={cn("grid grid-flow-col grid-rows-2 gap-x-7 gap-y-0.5 text-right font-mono text-xs", className)}>
      {stats.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-xl">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
