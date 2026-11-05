/**
 * Moving an application by hand: Change stage (a call booked by phone, an
 * offer, a rejection seen elsewhere) and Add a past step (a screening that
 * happened but no email showed, logged on its date without moving the stage).
 */
import type { Stage } from "@llm-job-search/core/applications/constants.ts";
import { useState } from "react";
import { AdaptiveSheet } from "@/components/jr/AdaptiveSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { todayIso } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/labels";
import { usePastStep, useSetStage } from "./api.ts";

const MOVES: Stage[] = ["applied", "screening", "interviewing", "offer", "rejected", "no_response"];
const PAST: Stage[] = ["screening", "interviewing", "offer"];

interface Props {
  applicationId: number;
  current: Stage;
  kind: "move" | "past" | null;
  onClose: () => void;
}

export function StageDialog({ applicationId, current, kind, onClose }: Props) {
  const move = useSetStage();
  const past = usePastStep();
  const choices = kind === "past" ? PAST : MOVES.filter((s) => s !== current);
  const [stage, setStage] = useState<Stage>(choices[0]!);
  const [on, setOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const action = kind === "past" ? past : move;

  return (
    <AdaptiveSheet
      open={kind !== null}
      onOpenChange={(open) => !open && onClose()}
      title={kind === "past" ? "Add a past step" : "Change stage"}
      description={kind === "past" ? "A step that happened but no email showed. It's logged on its date; the current stage stays." : undefined}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate([applicationId, stage, on, note], { onSuccess: onClose });
        }}
      >
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Stage">
          {choices.map((s) => (
            <Button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === stage}
              variant={s === stage ? "secondary" : "outline"}
              size="sm"
              onClick={() => setStage(s)}
            >
              {STAGE_LABELS[s]}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          On
          <Input type="date" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value)} className="w-44 font-mono" />
        </label>
        <Textarea
          aria-label="Note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={stage === "rejected" && kind === "move" ? "Why they said no (kept as the rejection reason)" : "Note (optional)"}
        />
        {action.error && <p className="text-sm text-destructive">{action.error.message}</p>}
        <Button type="submit" disabled={action.isPending} className="self-start">
          {kind === "past" ? "Add step" : `Move to ${STAGE_LABELS[stage]}`}
        </Button>
      </form>
    </AdaptiveSheet>
  );
}
