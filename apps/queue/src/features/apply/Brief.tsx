/** What to have in mind while filling in the form: fit, why you fit, gaps and what to say, what to ask, why them. */
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Chip } from "@/components/jr/Chip";
import { FitMeter } from "@/components/jr/FitMeter";
import { Quote } from "@/components/jr/Quote";
import { Button } from "@/components/ui/button";
import { factChips } from "@/lib/facts";
import type { Overview } from "@/lib/queries";
import { track } from "@/timing/track";

type Shortlisted = Overview["shortlist"][number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

export function Brief({ lead, showPack }: { lead: Shortlisted; showPack: boolean }) {
  const pack = showPack ? lead.pack : null;
  return (
    <aside className="flex flex-col gap-[22px] overflow-y-auto border-l bg-card px-8 py-8">
      <div className="flex items-center gap-3">
        <FitMeter score={lead.fitScore ?? 0} />
        <span className="font-mono">{lead.fitScore ?? "?"}/10</span>
        <div className="grow" />
        <Button variant="outline" size="sm" asChild>
          <a href={lead.url} target="_blank" rel="noreferrer" onClick={() => track("posting_opened", lead.postingId)}>
            <ArrowUpRight />
            Open form
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {factChips(lead.facts).map((chip) => (
          <Chip key={chip} tone="solid">
            {chip}
          </Chip>
        ))}
      </div>
      <div className="h-px bg-border" />
      <Section title="Why you fit">
        <ul className="flex flex-col gap-2 text-[13px] text-foreground-2">
          {(pack ? pack.whyFit.map((w) => w.text) : lead.facts.whyFit.map((w) => w.point)).map((point) => (
            <li key={point}>· {point}</li>
          ))}
        </ul>
      </Section>
      {pack && pack.gaps.length > 0 && (
        <Section title="Gaps → say this">
          {pack.gaps.map((g) => (
            <p key={g.gap} className="text-[13px]">
              <b className="font-medium">{g.gap}</b> <span className="text-muted-foreground">“{g.sayThis}”</span>
            </p>
          ))}
        </Section>
      )}
      {pack && pack.askThem.length > 0 && (
        <Section title="Ask them">
          <ol className="flex list-inside list-decimal flex-col gap-2 text-[13px] text-foreground-2">
            {pack.askThem.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </Section>
      )}
      {pack && pack.whyUs.length > 0 && (
        <Section title="Why them">
          {pack.whyUs.map((w) => (
            <div key={w.point} className="flex flex-col gap-1">
              <Quote>{w.point}</Quote>
              <a
                href={w.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="pl-4 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                source
              </a>
            </div>
          ))}
        </Section>
      )}
      {!showPack && lead.pack && <p className="text-xs text-muted-foreground">Timing experiment: this one is applied to without the prep pack.</p>}
    </aside>
  );
}
