/** Today, the home screen: only what needs you now, one card per kind of thing. */
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Dot } from "@/components/jr/Dot";
import { KeyHint } from "@/components/jr/KeyHint";
import { formatDay } from "@/lib/format";
import { setSearchOpen } from "@/lib/overlays";
import { overviewQuery, statsQuery } from "@/lib/queries";
import { lastRun } from "@/lib/run-status";
import { ApplyCard } from "./ApplyCard.tsx";
import { DecideCard } from "./DecideCard.tsx";
import { NudgeCard } from "./NudgeCard.tsx";
import { RepliesCard } from "./RepliesCard.tsx";
import { UpNextCard } from "./UpNextCard.tsx";
import { WeekStats } from "./WeekStats.tsx";

const COUNT = ["Nothing needs", "One thing needs", "Two things need", "Three things need", "Four things need", "Five things need"];

export function TodayPage() {
  const overview = useQuery(overviewQuery);
  const stats = useQuery(statsQuery());
  const data = overview.data;

  const leads = data?.decide.length ?? 0;
  const shortlisted = data?.shortlist.length ?? 0;
  const moments = data ? [data.upNext ? 1 : 0, leads, shortlisted, data.replies.length, data.followUps.length].filter((n) => n > 0).length : 0;
  const run = data ? lastRun(data.status) : null;

  return (
    <>
      <header className="flex h-14 items-center gap-3 px-4 md:h-[60px] md:gap-3.5 md:border-b md:px-8">
        <h1 className="text-base font-semibold tracking-[-0.01em] md:text-[15px]">Today</h1>
        <span className="font-mono text-xs text-muted-foreground">{formatDay()}</span>
        <div className="grow" />
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="hidden h-[34px] w-[300px] items-center gap-2 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground md:flex"
        >
          <Search className="size-3.5" />
          Search or jump to…
          <span className="ml-auto">
            <KeyHint>⌘K</KeyHint>
          </span>
        </button>
      </header>

      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-4 py-2 md:gap-5 md:px-8 md:py-11">
        {overview.error && <p className="text-destructive">Couldn't load today: {overview.error.message}</p>}
        {data && run && (
          <>
            <div className="flex items-end justify-between gap-6 py-2 md:pb-3">
              <div className="flex flex-col gap-2.5 md:gap-3.5">
                <p className="eyebrow flex items-center gap-2.5">
                  <Dot tone={run.tone} />
                  {run.label}
                </p>
                <h2 className="text-[30px] leading-[1.08] font-semibold tracking-[-0.035em] md:text-[44px]">{COUNT[moments]} you today.</h2>
                {moments === 0 && <p className="text-muted-foreground">New leads arrive with the next collect.</p>}
              </div>
              {stats.data && <WeekStats tiles={stats.data.tiles} layout="columns" className="hidden md:grid" />}
            </div>
            {data.upNext && <UpNextCard next={data.upNext} />}
            {(leads > 0 || shortlisted > 0) && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:gap-5">
                {leads > 0 && <DecideCard leads={data.decide} className={shortlisted ? "md:col-span-7" : "md:col-span-12"} />}
                {shortlisted > 0 && (
                  <ApplyCard
                    shortlist={data.shortlist}
                    drafting={data.drafting}
                    draftFailure={data.draftFailure}
                    className={leads ? "md:col-span-5" : "md:col-span-12"}
                  />
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:gap-5">
              {data.replies.length > 0 && (
                <RepliesCard replies={data.replies} className={data.followUps.length ? "md:col-span-7" : "md:col-span-12"} />
              )}
              {data.followUps.length > 0 && (
                <NudgeCard followUps={data.followUps} className={data.replies.length ? "md:col-span-5" : "md:col-span-12"} />
              )}
            </div>
            {stats.data && <WeekStats tiles={stats.data.tiles} layout="line" className="pt-1 md:hidden" />}
          </>
        )}
      </div>
    </>
  );
}
