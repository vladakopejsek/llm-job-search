/** Apply: the shortlist, whether each pack is drafted, drafting the missing ones, and the way into the apply session (at the desk). */
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Dot } from "@/components/jr/Dot";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { useHotkeys } from "@/lib/hotkeys";
import type { Overview } from "@/lib/queries";
import { useDraftPacks } from "./api.ts";
import { Moment } from "./Moment.tsx";

type Shortlisted = Overview["shortlist"][number];

export function ApplyCard({
  shortlist,
  drafting,
  draftFailure,
  className,
}: {
  shortlist: Shortlisted[];
  drafting: boolean;
  draftFailure: string | null;
  className?: string;
}) {
  const navigate = useNavigate();
  useHotkeys({ a: () => navigate({ to: "/apply", search: {} }) });
  const draft = useDraftPacks();
  const ready = shortlist.filter((l) => l.pack).length;
  // A closed role gets no pack: Draft packs skips it.
  const toDraft = shortlist.filter((l) => !l.pack && !l.closedAt).length;
  const busy = drafting || draft.isPending;
  return (
    <Moment title="Apply" className={className}>
      <div className="flex flex-col gap-2">
        <p className="flex items-baseline gap-3">
          <span className="font-mono text-[44px] leading-none font-medium tracking-[-0.04em] md:text-[56px]">{shortlist.length}</span>
          <span className="text-[17px] font-medium">shortlisted</span>
        </p>
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Monitor className="size-3.5 md:hidden" />
          <span className="md:hidden">Apply at your desk · </span>packs ready {ready} of {shortlist.length}
        </p>
      </div>
      <ul className="border-t">
        {shortlist.map((lead) => (
          <li key={lead.postingId} className="border-b last:border-b-0">
            <Link to="/apply" search={{ posting: lead.postingId }} className="flex h-11 items-center gap-2.5 max-md:pointer-events-none">
              {lead.pack ? <Check className="size-3.5 text-foreground-2" /> : <Dot className="mx-1" />}
              <span className="font-medium">{lead.company}</span>
              <span className="grow truncate text-muted-foreground">{lead.title}</span>
              {lead.closedAt ? (
                <span className="font-mono text-[11px] text-muted-foreground">closed</span>
              ) : (
                !lead.pack && <span className="font-mono text-[11px] text-muted-foreground">{busy ? "drafting…" : "no pack"}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {draftFailure && !busy && <p className="text-[13px] text-destructive">Drafting stopped: {draftFailure}</p>}
      {toDraft > 0 && (
        <Button
          variant="outline"
          disabled={busy}
          className="self-start"
          onClick={() => draft.mutate([], { onError: (error) => toast.error(`Couldn't draft packs: ${error.message}`) })}
        >
          {busy ? "Drafting packs…" : `Draft ${toDraft} ${toDraft === 1 ? "pack" : "packs"}`}
        </Button>
      )}
      <Button variant="outline" asChild className="hidden self-start md:inline-flex">
        <Link to="/apply" search={{}}>
          Start apply session
          <KeyHint>A</KeyHint>
        </Link>
      </Button>
    </Moment>
  );
}
