/** The latest daily runs: what was collected, evaluated and drafted, what the API cost, and how long it took. */
import { formatDay } from "@/lib/format";
import type { Lab } from "./api.ts";

const COLUMNS = ["Listed", "New", "Evaluated", "Leads", "Packs", "Feed errors", "Cost", "Took"] as const;
const n = (v: number | null) => (v === null ? "–" : v >= 10_000 ? `${Math.round(v / 1000)}k` : String(v));

export function Runs({ runs }: { runs: Lab["runs"] }) {
  return (
    <section className="overflow-x-auto rounded-xl border bg-card md:col-span-12">
      <table className="w-full min-w-[700px] font-mono text-[13px]">
        <thead>
          <tr className="eyebrow h-11 text-left">
            <th className="px-5 font-normal">Run</th>
            <th className="font-normal">Started</th>
            {COLUMNS.map((c) => (
              <th key={c} className="px-3 text-right font-normal last:pr-5">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="h-12 border-t">
              <td className="px-5">#{r.id}</td>
              <td className="text-muted-foreground">{formatDay(new Date(r.startedAt))}</td>
              {[r.read, r.newPostings, r.evaluated, r.leads, r.packs].map((v, i) => (
                <td key={COLUMNS[i]} className="px-3 text-right">
                  {n(v)}
                </td>
              ))}
              <td className={`px-3 text-right ${r.feedErrors ? "text-warning" : ""}`}>{n(r.feedErrors)}</td>
              <td className="px-3 text-right">{r.costUsd === null ? "–" : `$${r.costUsd.toFixed(2)}`}</td>
              <td className="px-3 pr-5 text-right">{r.minutes === null ? "running" : `${r.minutes}m`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
