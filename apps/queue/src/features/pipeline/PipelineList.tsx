/** Every application, grouped by where it stands: in conversation first, then waiting, then closed (folded into one line). */
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { StageTrack, trackStep } from "@/components/jr/StageTrack";
import { Button } from "@/components/ui/button";
import { useFollowedUp } from "@/lib/applications";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PipelineRow } from "./api.ts";

const OPEN_GROUPS = [
  { title: "Offer", stage: "offer" },
  { title: "Interviewing", stage: "interviewing" },
  { title: "Screening", stage: "screening" },
] as const;
/** Waiting rows shown before "+ N more". */
const WAITING_SHOWN = 5;
const AT: Record<number, string> = { 0: "at application", 1: "after screening", 2: "after interview", 3: "after offer" };

const upcoming = (r: PipelineRow) => (r.nextStepAt && new Date(r.nextStepAt) > new Date() ? r.nextStepAt : null);

function Row({ row, status, action }: { row: PipelineRow; status: ReactNode; action?: ReactNode }) {
  const closed = row.stage === "rejected" || row.stage === "no_response";
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-t px-4 py-3 first:border-t-0 md:min-h-14 md:grid-cols-[170px_1fr_180px_90px] md:px-5 md:py-0">
      <Link
        to="/pipeline"
        search={(s) => ({ ...s, app: row.id })}
        className="col-span-1 grid grid-cols-1 gap-0.5 md:col-span-3 md:grid-cols-subgrid md:items-center"
      >
        <b className="truncate font-semibold">{row.company}</b>
        <span className="truncate text-muted-foreground">{row.role}</span>
        <span className="font-mono text-xs">{status}</span>
      </Link>
      <span className="justify-self-end">{action ?? <StageTrack reached={trackStep(row.reached, row.responded)} ended={closed} />}</span>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="eyebrow flex gap-2">
        {title} <span className="font-mono">{count}</span>
      </h2>
      <ul className="overflow-hidden rounded-xl border bg-card">{children}</ul>
    </section>
  );
}

/** `due`: a follow-up is due, by the same rule as Today's Nudge (packages/core/src/queue/queries.ts followUps). */
function WaitingRow({ row, due }: { row: PipelineRow; due: boolean }) {
  const followedUp = useFollowedUp();
  const quiet = row.daysWaiting ?? 0;
  return (
    <Row
      row={row}
      status={<span className={due ? "text-warning" : "text-muted-foreground"}>{quiet}d quiet</span>}
      action={
        due ? (
          <Button variant="outline" size="sm" disabled={followedUp.isPending} onClick={() => followedUp.mutate([row.id])}>
            Followed up
          </Button>
        ) : undefined
      }
    />
  );
}

export function PipelineList({ rows, followUpDue }: { rows: PipelineRow[]; followUpDue: ReadonlySet<number> }) {
  const [allWaiting, setAllWaiting] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const waiting = rows.filter((r) => r.stage === "applied").sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));
  const closed = rows.filter((r) => r.stage === "rejected" || r.stage === "no_response");
  const rejectedAt = (reached: number) => closed.filter((r) => r.stage === "rejected" && r.reached === reached).length;
  const summary = [0, 1, 2, 3]
    .map((i) => rejectedAt(i) && `${rejectedAt(i)} ${AT[i]}`)
    .concat(closed.filter((r) => r.stage === "no_response").length && `${closed.filter((r) => r.stage === "no_response").length} no response`)
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {OPEN_GROUPS.map(({ title, stage }) => {
        const group = rows.filter((r) => r.stage === stage);
        if (!group.length) return null;
        return (
          <Group key={stage} title={title} count={group.length}>
            {group.map((row) => {
              const next = upcoming(row);
              return <Row key={row.id} row={row} status={next ? formatWhen(next) : <span className="text-muted-foreground">set next step</span>} />;
            })}
          </Group>
        );
      })}
      {waiting.length > 0 && (
        <Group title="Waiting" count={waiting.length}>
          {(allWaiting ? waiting : waiting.slice(0, WAITING_SHOWN)).map((row) => (
            <WaitingRow key={row.id} row={row} due={followUpDue.has(row.id)} />
          ))}
          {!allWaiting && waiting.length > WAITING_SHOWN && (
            <li className="border-t">
              <button
                type="button"
                onClick={() => setAllWaiting(true)}
                className="h-10 w-full px-5 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                + {waiting.length - WAITING_SHOWN} more
              </button>
            </li>
          )}
        </Group>
      )}
      {closed.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((s) => !s)}
            className="flex items-center gap-3.5 rounded-xl border bg-card px-5 py-3.5 text-left"
          >
            <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", showClosed && "rotate-90")} />
            <span className="eyebrow shrink-0">
              Closed <span className="font-mono">{closed.length}</span>
            </span>
            <span className="truncate text-[13px] text-muted-foreground">{summary}</span>
          </button>
          {showClosed && (
            <ul className="overflow-hidden rounded-xl border bg-card">
              {closed.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  status={
                    <span className="text-muted-foreground">
                      {row.stage === "rejected" ? [AT[row.reached], row.rejectionReason].filter(Boolean).join(" · ") : "no response"}
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
