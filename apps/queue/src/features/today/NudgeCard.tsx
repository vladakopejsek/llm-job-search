/** Nudge: applications quiet for 14+ days. You write the follow-up yourself; this only records it. */
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDrop, useFollowedUp } from "@/lib/applications";
import { daysSince, formatDate } from "@/lib/format";
import type { Overview } from "@/lib/queries";
import { Moment } from "./Moment.tsx";

type FollowUp = Overview["followUps"][number];

function NudgeRow({ app }: { app: FollowUp }) {
  const followedUp = useFollowedUp();
  const drop = useDrop();
  const busy = followedUp.isPending || drop.isPending;
  return (
    <article className="flex flex-col gap-2.5 border-t pt-3.5">
      <div className="flex items-baseline gap-2.5">
        <span className="font-semibold">{app.company}</span>
        <span className="grow truncate text-muted-foreground">{app.role}</span>
        <span className="font-mono text-xs text-warning">{daysSince(app.lastContact ?? app.appliedOn)}d</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="grow font-mono text-[11px] text-muted-foreground">
          {[app.appliedOn && `applied ${formatDate(app.appliedOn)}`, app.followedUpOn && `followed up ${formatDate(app.followedUpOn)}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => drop.mutate([app.applicationId], { onError: (e) => toast.error(e.message) })}
        >
          Drop
        </Button>
        {app.canFollowUp && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => followedUp.mutate([app.applicationId], { onError: (e) => toast.error(e.message) })}
          >
            Followed up
          </Button>
        )}
      </div>
    </article>
  );
}

export function NudgeCard({ followUps, className }: { followUps: FollowUp[]; className?: string }) {
  return (
    <Moment title="Nudge · quiet 14+ days" className={className}>
      {followUps.map((app) => (
        <NudgeRow key={app.applicationId} app={app} />
      ))}
      <p className="border-t pt-2 text-xs text-muted-foreground">You write the follow-up. Nothing is ever sent from here.</p>
    </Moment>
  );
}
