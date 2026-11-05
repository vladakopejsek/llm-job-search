/** Decide: how many new leads wait, the best few, and the way into deciding them. */
import { Link, useNavigate } from "@tanstack/react-router";
import { Chip } from "@/components/jr/Chip";
import { FitMeter } from "@/components/jr/FitMeter";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { useHotkeys } from "@/lib/hotkeys";
import type { Overview } from "@/lib/queries";
import { Moment } from "./Moment.tsx";

type Lead = Overview["decide"][number];

const SHOWN = 3;

function EligibilityChip({ lead }: { lead: Lead }) {
  if (lead.eligibilityConfirmedAt) return <Chip>Confirmed by you</Chip>;
  if (unclear(lead)) return <Chip tone="warning">Eligible?</Chip>;
  return <Chip>{lead.facts.eligibility.status === "named" ? "Named in posting" : "Implied by region"}</Chip>;
}

const unclear = (lead: Lead) => lead.verdict === "needs_check" && !lead.eligibilityConfirmedAt;

export function DecideCard({ leads, className }: { leads: Lead[]; className?: string }) {
  const checks = leads.filter(unclear).length;
  const navigate = useNavigate();
  useHotkeys({ Enter: () => navigate({ to: "/focus" }) });

  return (
    <Moment title="Decide" className={className}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline gap-3">
            <span className="font-mono text-[44px] leading-none font-medium tracking-[-0.04em] md:text-[56px]">{leads.length}</span>
            <span className="text-[17px] font-medium">new {leads.length === 1 ? "lead" : "leads"}</span>
          </p>
          {checks > 0 && <p className="text-[13px] text-muted-foreground">{checks} need an eligibility check</p>}
        </div>
        <Button size="lg" asChild className="w-full md:w-auto">
          <Link to="/focus">
            <span>
              Start<span className="md:hidden"> deciding</span>
            </span>
            <KeyHint>↵</KeyHint>
          </Link>
        </Button>
      </div>
      <ul className="hidden border-t md:block">
        {leads.slice(0, SHOWN).map((lead) => (
          <li key={lead.postingId} className="grid h-11 grid-cols-[44px_150px_1fr_auto] items-center gap-3 border-b">
            <FitMeter score={lead.fitScore ?? 0} size="sm" />
            <span className="truncate font-medium">{lead.company}</span>
            <span className="truncate text-muted-foreground">{lead.title}</span>
            <EligibilityChip lead={lead} />
          </li>
        ))}
        {leads.length > SHOWN && <li className="flex h-9 items-center text-xs text-muted-foreground">+ {leads.length - SHOWN} more</li>}
      </ul>
    </Moment>
  );
}
