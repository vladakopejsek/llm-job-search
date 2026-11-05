/** One lead, full view: everything needed to decide it, and the three ways to. */
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { KeyHint } from "@/components/jr/KeyHint";
import { LaterSheet } from "@/components/LaterSheet";
import { AlreadyAppliedSheet, OtherRoleSheet } from "@/components/SkipDetails";
import { SkipSheet } from "@/components/SkipSheet";
import { Button } from "@/components/ui/button";
import { useHotkeys } from "@/lib/hotkeys";
import { useOverlays } from "@/lib/overlays";
import { useArm } from "@/timing/experiment";
import { track } from "@/timing/track";
import type { Lead } from "./api.ts";
import { type Detail, Details } from "./Details.tsx";
import { EligibilityGate } from "./EligibilityGate.tsx";
import { FitPanel } from "./FitPanel.tsx";
import { LeadHeader } from "./LeadHeader.tsx";
import { Reasons } from "./Reasons.tsx";
import type { useDecisions } from "./use-decisions.ts";

type Sheet = "skip" | "later" | "gate" | "already_applied" | "other_role";

interface Props {
  lead: Lead;
  otherRoles: number;
  decisions: ReturnType<typeof useDecisions>;
  onNext: () => void;
  onPrevious: () => void;
}

export function LeadView({ lead, otherRoles, decisions, onNext, onPrevious }: Props) {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const overlay = useOverlays();
  const [details, setDetails] = useState<ReadonlySet<Detail>>(new Set());
  // The timing experiment's no-pack arm works the lead without its pack.
  const showPack = useArm(lead.postingId, !!lead.pack) !== "no_pack";
  const unclear = lead.verdict === "needs_check" && !lead.eligibilityConfirmedAt;

  // Seeing a lead starts its triage clock (packages/core/src/queue/timing.ts).
  useEffect(() => track("details_opened", lead.postingId), [lead.postingId]);

  const toggle = (d: Detail) => {
    if (d === "pack" && !details.has("pack")) track("pack_opened", lead.postingId);
    setDetails((open) => {
      const next = new Set(open);
      if (!next.delete(d)) next.add(d);
      return next;
    });
  };
  const yes = () => (unclear ? setSheet("gate") : decisions.shortlist(lead));
  const close = (open: boolean) => !open && setSheet(null);

  useHotkeys(
    {
      y: yes,
      n: () => setSheet("skip"),
      l: () => setSheet("later"),
      j: onNext,
      k: onPrevious,
      p: () => showPack && toggle("pack"),
      e: () => toggle("evidence"),
      o: () => toggle("text"),
      Escape: () => navigate({ to: "/" }),
    },
    // Off under the app's posting sheet too (⌘K), or Y would shortlist the lead hidden behind it.
    sheet === null && overlay.postingId === null,
  );

  return (
    <>
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5 px-4 pt-5 pb-32 md:gap-7 md:px-8 md:pt-11 md:pb-12">
        <LeadHeader lead={lead} otherRoles={otherRoles} />
        <FitPanel lead={lead} />
        <Reasons lead={lead} showPack={showPack} />
        <Details lead={lead} showPack={showPack} open={details} onToggle={toggle} />

        <div className="hidden items-center gap-2.5 pt-1 md:flex">
          <Button variant="ghost" asChild>
            <a href={lead.url} target="_blank" rel="noreferrer" onClick={() => track("posting_opened", lead.postingId)}>
              <ArrowUpRight />
              Open posting
            </a>
          </Button>
          <div className="grow" />
          <Button variant="outline" size="lg" onClick={() => setSheet("later")}>
            Later
            <KeyHint>L</KeyHint>
          </Button>
          <Button variant="outline" size="lg" onClick={() => setSheet("skip")}>
            Skip
            <KeyHint>N</KeyHint>
          </Button>
          <Button size="lg" className="px-[22px]" onClick={yes}>
            Yes · shortlist
            <KeyHint>Y</KeyHint>
          </Button>
        </div>
      </div>

      {/* Phone: the three decisions stay under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-[1fr_1fr_1.7fr] gap-2 border-t bg-background px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] md:hidden">
        <Button variant="outline" size="lg" onClick={() => setSheet("skip")}>
          Skip
        </Button>
        <Button variant="outline" size="lg" onClick={() => setSheet("later")}>
          Later
        </Button>
        <Button size="lg" onClick={yes}>
          Yes · shortlist
        </Button>
      </div>

      <SkipSheet
        posting={lead}
        open={sheet === "skip"}
        onOpenChange={close}
        onSkip={(reason) => decisions.skip(lead, reason)}
        onAlreadyApplied={() => setSheet("already_applied")}
        onOtherRole={() => setSheet("other_role")}
      />
      <LaterSheet posting={lead} open={sheet === "later"} onOpenChange={close} onSnooze={(until) => decisions.later(lead, until)} />
      <EligibilityGate
        lead={lead}
        open={sheet === "gate"}
        onOpenChange={close}
        onEligible={(note) => decisions.shortlistEligible(lead, note)}
        onNotEligible={() => decisions.skip(lead, "not_eligible")}
        onLater={() => {
          setSheet(null);
          onNext();
        }}
      />
      <AlreadyAppliedSheet
        posting={lead}
        open={sheet === "already_applied"}
        onOpenChange={close}
        onDone={(message) => decisions.recorded(lead, message)}
      />
      <OtherRoleSheet posting={lead} open={sheet === "other_role"} onOpenChange={close} onDone={(message) => decisions.recorded(lead, message)} />
    </>
  );
}
