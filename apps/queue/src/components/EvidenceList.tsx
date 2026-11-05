/** Every fact the evaluation stated, each with the posting's own words where it quoted them. */
import { Quote } from "@/components/jr/Quote";
import { evidence } from "@/lib/facts";
import type { Overview } from "@/lib/queries";

export function EvidenceList({ facts }: { facts: Overview["decide"][number]["facts"] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-[120px_1fr]">
      {evidence(facts).map((f) => (
        <div key={f.label} className="contents">
          <dt className="eyebrow pt-0.5">{f.label}</dt>
          <dd className="flex flex-col gap-1.5">
            {f.value}
            {f.quote && <Quote>{f.quote}</Quote>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
