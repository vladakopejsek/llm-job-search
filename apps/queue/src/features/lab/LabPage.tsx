/**
 * The Lab: the tool measuring itself, by definitions written down before the
 * data (docs/metrics.md). It says what the loop is before the numbers.
 */
import { useQuery } from "@tanstack/react-query";
import { labQuery } from "./api.ts";
import { Checks } from "./Checks.tsx";
import { Picks } from "./Picks.tsx";
import { Rewrites } from "./Rewrites.tsx";
import { Runs } from "./Runs.tsx";
import { Timing } from "./Timing.tsx";

export function LabPage() {
  const { data, error } = useQuery(labQuery);
  return (
    <>
      <header className="flex h-14 items-center gap-3.5 border-b px-4 md:h-[60px] md:px-8">
        <h1 className="text-base font-semibold md:text-[15px]">Lab</h1>
        {data && (
          <span className="font-mono text-xs text-muted-foreground">
            {data.picks.applied + data.picks.skipped} decisions · {data.checks.items} agent items · {data.runs.length} recent runs
          </span>
        )}
      </header>
      <div className="flex max-w-[1240px] flex-col gap-6 px-4 py-6 md:px-12 md:py-10">
        <div className="flex max-w-[820px] flex-col gap-3">
          <h2 className="text-[26px] leading-[1.08] font-semibold tracking-[-0.035em] md:text-[34px]">
            Does the agent pick well, and does the pack save time?
          </h2>
          <p className="text-[15px] text-muted-foreground">
            Claude reads each posting and drafts a prep pack. Code checks every quote and makes the verdict. You make every decision, and nothing is
            sent without you. These numbers measure that loop by definitions fixed before the data; small groups are drawn faint and marked.
          </p>
        </div>
        {error && <p className="text-destructive">{error.message}</p>}
        {data && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <Picks picks={data.picks} className="md:col-span-5" />
            <Timing timing={data.timing} className="md:col-span-7" />
            <Checks checks={data.checks} className="md:col-span-6" />
            <Rewrites rewrites={data.rewrites} className="md:col-span-6" />
            <Runs runs={data.runs} />
          </div>
        )}
      </div>
    </>
  );
}
