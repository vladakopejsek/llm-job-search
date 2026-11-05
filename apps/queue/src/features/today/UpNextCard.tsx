/** Up next: the soonest scheduled call, and the way to its call card. */
import { PROGRESS, type Stage } from "@llm-job-search/core/applications/constants.ts";
import { Link, useNavigate } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { KeyHint } from "@/components/jr/KeyHint";
import { StageTrack, trackStep } from "@/components/jr/StageTrack";
import { Button } from "@/components/ui/button";
import { daysBetweenIso, formatDate, formatWhen, todayIso } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import type { Overview } from "@/lib/queries";

type UpNext = NonNullable<Overview["upNext"]>;

const inDays = (at: string) => {
  const days = daysBetweenIso(todayIso(), new Date(at).toLocaleDateString("sv-SE"));
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
};

export function UpNextCard({ next }: { next: UpNext }) {
  const navigate = useNavigate();
  const call = { to: "/call/$applicationId", params: { applicationId: String(next.applicationId) } } as const;
  useHotkeys({ c: () => navigate(call) });
  const reached = Math.max(0, (PROGRESS as readonly Stage[]).indexOf(next.stage));
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:flex-row md:items-center md:gap-8 md:px-7 md:py-6">
      <div className="flex shrink-0 flex-col gap-1.5 md:min-w-[230px]">
        <span className="eyebrow">Up next · {inDays(next.at!)}</span>
        <span className="font-mono text-xl font-medium tracking-[-0.02em] whitespace-nowrap md:text-[26px]">{formatWhen(next.at!)}</span>
      </div>
      <div className="hidden w-px self-stretch bg-border md:block" />
      <div className="flex grow flex-col gap-1.5">
        <p className="text-[17px] font-semibold">
          {next.company} <span className="font-normal text-muted-foreground">· {next.role}</span>
        </p>
        <p className="text-[13px] text-muted-foreground">{[next.kind, next.with && `with ${next.with}`].filter(Boolean).join(" ")}</p>
        <div className="mt-1.5 hidden items-center gap-3 md:flex">
          <StageTrack reached={trackStep(reached, !!next.firstResponseOn)} />
          <span className="font-mono text-[11px] text-muted-foreground">
            {[next.appliedOn && `applied ${formatDate(next.appliedOn)}`, next.firstResponseOn && `replied ${formatDate(next.firstResponseOn)}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>
      <Button variant="outline" size="lg" asChild className="w-full md:w-auto">
        <Link {...call}>
          <Phone />
          Open call card
          <KeyHint>C</KeyHint>
        </Link>
      </Button>
    </section>
  );
}
