/** Fit, why, and whether you can apply from where you live: the two things that decide most leads. */
import { Check } from "lucide-react";
import { Chip } from "@/components/jr/Chip";
import { FitMeter } from "@/components/jr/FitMeter";
import type { Lead } from "./api.ts";

function Eligibility({ lead }: { lead: Lead }) {
  if (lead.eligibilityConfirmedAt) return <span className="font-medium">Confirmed by you</span>;
  if (lead.verdict === "needs_check") return <Chip tone="warning">Eligible?</Chip>;
  const { status, quote } = lead.facts.eligibility;
  return (
    <span className="flex items-center gap-2 font-medium whitespace-nowrap">
      {status === "named" ? "Named in posting" : "Implied by region"}
      {/* Quotes are checked against the posting text before they're stored, so one that's here was found there. */}
      {quote && (
        <span className="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-[0.05em] text-primary-ink uppercase">
          <Check className="size-3.5" />
          quoted
        </span>
      )}
    </span>
  );
}

export function FitPanel({ lead }: { lead: Lead }) {
  const score = lead.fitScore ?? 0;
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 md:gap-6 md:px-6 md:py-5">
      <div className="flex items-center gap-3.5">
        <FitMeter score={score} />
        <span className="font-mono text-[22px] font-medium">
          {score}
          <span className="text-sm text-muted-foreground">/10</span>
        </span>
      </div>
      <p className="line-clamp-3 hidden grow text-[13px] text-muted-foreground md:block" title={lead.facts.fit.reason}>
        {lead.facts.fit.reason}
      </p>
      <div className="h-10 w-px shrink-0 bg-border max-md:hidden" />
      <div className="ml-auto flex flex-col items-start gap-1 text-[13px] md:ml-0 md:w-[250px] md:shrink-0 md:text-sm">
        <span className="eyebrow hidden md:block">Eligibility</span>
        <Eligibility lead={lead} />
      </div>
    </div>
  );
}
