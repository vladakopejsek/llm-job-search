/**
 * The two skip reasons that need details: "Already applied" (a real
 * application made elsewhere, which enters the tracker) and "Applied to
 * another role" (a skip linked to that application, not a wrong pick).
 */
import { type Channel, FOLLOW_UP_AFTER_DAYS, OUTSIDE_FOLLOW_UP_MAX_DAYS } from "@llm-job-search/core/applications/constants.ts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdaptiveSheet } from "@/components/jr/AdaptiveSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, call } from "@/lib/api";
import { useSkip } from "@/lib/decisions";
import { daysSince, formatDate, todayIso } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { ChannelSelect } from "./ChannelSelect.tsx";

interface Props {
  posting: { postingId: number; company: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the server recorded it, with a message for the toast. */
  onDone: (message: string) => void;
}

export function AlreadyAppliedSheet({ posting, open, onOpenChange, onDone }: Props) {
  const skip = useSkip();
  const [appliedOn, setAppliedOn] = useState(todayIso());
  const [channel, setChannel] = useState<Channel>("linkedin");
  const days = daysSince(appliedOn) ?? 0;
  return (
    <AdaptiveSheet open={open} onOpenChange={onOpenChange} title="Already applied" description={`${posting.company} · ${posting.title}`}>
      <p className="text-sm text-muted-foreground">
        You applied outside the app. This adds it to the Pipeline and holds the company's other roles while it's active.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Applied on
          <Input type="date" value={appliedOn} max={todayIso()} onChange={(e) => setAppliedOn(e.target.value)} className="w-40 font-mono" />
        </label>
        <ChannelSelect id="already-applied-channel" value={channel} onChange={setChannel} />
      </div>
      {days > OUTSIDE_FOLLOW_UP_MAX_DAYS ? (
        <p className="text-sm text-warning">Applied {days} days ago: logged late, so it won't be offered for a follow-up.</p>
      ) : days >= FOLLOW_UP_AFTER_DAYS ? (
        <p className="text-sm text-warning">Applied {FOLLOW_UP_AFTER_DAYS}+ days ago with no reply: it will show in Nudge.</p>
      ) : null}
      {skip.error && <p className="text-sm text-destructive">{skip.error.message}</p>}
      <Button
        className="self-start"
        disabled={skip.isPending || !appliedOn}
        onClick={() =>
          skip.mutate([posting.postingId, "already_applied", { appliedOn, channel }], {
            onSuccess: () => onDone(`Added ${posting.company} to the Pipeline, applied ${formatDate(appliedOn)}`),
          })
        }
      >
        Add to Pipeline
      </Button>
    </AdaptiveSheet>
  );
}

export function OtherRoleSheet({ posting, open, onOpenChange, onDone }: Props) {
  const skip = useSkip();
  const { data: apps, error } = useQuery({
    queryKey: ["company-applications", posting.postingId],
    queryFn: () => call(api.postings[":id"]["company-applications"].$get({ param: { id: String(posting.postingId) } })),
    enabled: open,
  });
  // Preselect the application still in progress, if there is one.
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const selected = picked === undefined ? (apps?.find((a) => a.stage !== "skipped")?.id ?? null) : picked;
  const option = (id: number | null, label: string, detail?: string) => (
    <button
      key={id ?? "none"}
      type="button"
      role="radio"
      aria-checked={selected === id}
      onClick={() => setPicked(id)}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg border px-3 text-left text-sm",
        selected === id ? "border-foreground-2 bg-muted" : "hover:bg-muted",
      )}
    >
      <span className="grow">{label}</span>
      {detail && <span className="font-mono text-xs text-muted-foreground">{detail}</span>}
    </button>
  );
  return (
    <AdaptiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Applied to another role at ${posting.company}`}
      description="This role is skipped. It isn't counted as a wrong pick."
    >
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {apps && (
        <div role="radiogroup" aria-label="Which application?" className="flex flex-col gap-2">
          {apps.map((a) =>
            option(a.id, a.role ?? "Unnamed role", [STAGE_LABELS[a.stage], a.appliedOn && formatDate(a.appliedOn)].filter(Boolean).join(" · ")),
          )}
          {option(null, apps.length ? "None of these" : "Skip without linking one")}
        </div>
      )}
      {skip.error && <p className="text-sm text-destructive">{skip.error.message}</p>}
      <Button
        className="self-start"
        disabled={skip.isPending || !apps}
        onClick={() =>
          skip.mutate([posting.postingId, "applied_other_role", selected === null ? {} : { relatedApplicationId: selected }], {
            onSuccess: () => onDone(`Skipped ${posting.company}: applied to another role`),
          })
        }
      >
        Skip role
      </Button>
    </AdaptiveSheet>
  );
}
