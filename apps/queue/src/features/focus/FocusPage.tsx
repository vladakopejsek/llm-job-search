/**
 * Focus: decide leads one at a time, best first. Y shortlist, N skip, L later,
 * J/K next/previous, P/E/O open the pack, evidence and posting text, Esc back
 * to Today. On the phone the same three decisions sit under the thumb.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronLeft } from "lucide-react";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { overviewQuery } from "@/lib/queries";
import { useStack } from "@/lib/use-stack";
import { track } from "@/timing/track";
import { LeadView } from "./LeadView.tsx";
import { useDecisions } from "./use-decisions.ts";

function CaughtUp({ shortlisted }: { shortlisted: number }) {
  return (
    <div className="mx-auto flex max-w-[920px] flex-col items-start gap-4 px-4 pt-16 md:px-8">
      <p className="eyebrow">Decide</p>
      <h2 className="text-[30px] leading-[1.08] font-semibold tracking-[-0.035em] md:text-[44px]">All caught up.</h2>
      <p className="text-muted-foreground">
        {shortlisted ? `${shortlisted} on your shortlist, ready to apply at your desk.` : "Nothing on your shortlist yet."}
      </p>
      <Button variant="outline" size="lg" asChild>
        <Link to="/">Back to Today</Link>
      </Button>
    </div>
  );
}

export function FocusPage() {
  const { data, error } = useQuery(overviewQuery);
  const stack = useStack(data?.decide);
  const decisions = useDecisions(stack);
  const lead = stack.current;
  // Other leads at the same company, still to decide: "+2 roles here".
  const otherRoles = lead ? (data?.decide.filter((l) => l.companyId === lead.companyId).length ?? 1) - 1 : 0;
  const progress = stack.total ? (stack.decidedCount / stack.total) * 100 : 0;

  return (
    <>
      <header className="flex h-14 items-center justify-between gap-3.5 px-2 md:h-[60px] md:justify-start md:border-b md:px-8">
        <Button variant="ghost" size="sm" asChild className="h-11 md:h-8">
          <Link to="/">
            <ChevronLeft />
            Today
          </Link>
        </Button>
        <h1 className="hidden text-[15px] font-semibold md:block">Decide</h1>
        {lead && (
          <span className="font-mono text-[13px] md:text-xs">
            {stack.position} <span className="text-muted-foreground">/ {stack.total}</span>
          </span>
        )}
        <div className="hidden grow md:block" />
        <span className="hidden items-center gap-1.5 font-mono text-xs text-muted-foreground md:flex">
          <KeyHint>K</KeyHint>
          <KeyHint>J</KeyHint> prev / next · <KeyHint>Esc</KeyHint> exit
        </span>
        {lead ? (
          <Button variant="ghost" size="icon-lg" asChild className="md:hidden">
            <a href={lead.url} target="_blank" rel="noreferrer" aria-label="Open posting" onClick={() => track("posting_opened", lead.postingId)}>
              <ArrowUpRight />
            </a>
          </Button>
        ) : (
          <span className="size-10 md:hidden" />
        )}
      </header>
      <div className="h-0.5 bg-border" role="progressbar" aria-valuenow={Math.round(progress)} aria-label="Decided this session">
        <div className="h-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {error && <p className="px-4 pt-6 text-destructive md:px-8">Couldn't load leads: {error.message}</p>}
      {data &&
        (lead ? (
          <LeadView key={lead.postingId} lead={lead} otherRoles={otherRoles} decisions={decisions} onNext={stack.next} onPrevious={stack.previous} />
        ) : (
          <CaughtUp shortlisted={data.shortlist.length} />
        ))}
    </>
  );
}
