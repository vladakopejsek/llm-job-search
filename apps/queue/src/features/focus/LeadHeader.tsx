/** Company, title and the chips that decide most leads at a glance. */
import { Chip } from "@/components/jr/Chip";
import { factChips } from "@/lib/facts";
import { formatDate } from "@/lib/format";
import type { Lead } from "./api.ts";

export function LeadHeader({ lead, otherRoles }: { lead: Lead; otherRoles: number }) {
  const eyebrow = [
    lead.company,
    lead.priority && `priority ${lead.priority}`,
    lead.postedAt && `posted ${formatDate(lead.postedAt)}`,
    lead.ats !== "none" && lead.ats !== "other" && lead.ats,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2.5 md:gap-3.5">
      <p className="eyebrow">{eyebrow.join(" · ")}</p>
      <h2 className="text-[30px] leading-[1.08] font-semibold tracking-[-0.035em] md:text-[44px]">{lead.title}</h2>
      <div className="flex flex-wrap gap-1.5 md:gap-2">
        {factChips(lead.facts).map((chip) => (
          <Chip key={chip} tone="solid">
            {chip}
          </Chip>
        ))}
        {otherRoles > 0 && <Chip>+{otherRoles === 1 ? "1 role" : `${otherRoles} roles`} here</Chip>}
        {lead.companyApplication && (
          <Chip tone="warning">{lead.companyApplication.replace(/ (\d{4}-\d{2}-\d{2})$/, (_, d) => ` ${formatDate(d)}`)} here</Chip>
        )}
      </div>
    </div>
  );
}
