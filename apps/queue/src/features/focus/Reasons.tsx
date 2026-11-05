/** Why you fit and the gaps, with what to say about each: at most three of each, from the posting's own words. */
import { Quote } from "@/components/jr/Quote";
import type { Lead } from "./api.ts";

const SHOWN = 3;

export function Reasons({ lead, showPack }: { lead: Lead; showPack: boolean }) {
  const fits = lead.facts.whyFit.slice(0, SHOWN);
  // The pack words each gap as something to say; without it (or in the no-pack arm) the evaluation's own gaps.
  const pack = showPack ? lead.pack : null;
  const gaps = pack
    ? pack.gaps.slice(0, SHOWN).map((g) => ({ gap: g.gap, say: g.sayThis, quote: null }))
    : lead.facts.gaps.slice(0, SHOWN).map((g) => ({ gap: g.gap, say: null, quote: g.quote }));
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section className="flex flex-col gap-2.5 md:gap-3.5">
        <h2 className="eyebrow">Why you fit</h2>
        {fits.length ? (
          <ul className="flex flex-col gap-2 md:gap-4">
            {fits.map((f) => (
              <li key={f.point} className="flex flex-col gap-1.5">
                <span className="font-medium">{f.point}</span>
                <span className="hidden md:block">
                  <Quote>{f.quote}</Quote>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{lead.facts.fit.reason}</p>
        )}
      </section>
      {gaps.length > 0 && (
        <section className="flex flex-col gap-2.5 md:gap-3.5">
          <h2 className="eyebrow">{pack ? "Gaps → say this" : "Gaps"}</h2>
          <ul className="flex flex-col gap-2 md:gap-4">
            {gaps.map((g) => (
              <li key={g.gap} className="flex flex-col gap-1.5">
                <span className="font-medium">{g.gap}</span>
                {g.say && <span className="text-[13px] text-muted-foreground">“{g.say}”</span>}
                {g.quote && (
                  <span className="hidden md:block">
                    <Quote>{g.quote}</Quote>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
