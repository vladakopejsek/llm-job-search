/** The next call or interview: when, what, with whom. Powers Today's "Up next" and the call card. */
import { NEXT_STEP_KINDS } from "@llm-job-search/core/applications/constants.ts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatWhen } from "@/lib/format";
import { useSetNextStep } from "./api.ts";

interface Step {
  at: string | null;
  kind: string | null;
  with: string | null;
}

/** An ISO time as a datetime-local input's value, in local time. */
const toLocalInput = (iso: string) => new Date(iso).toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

const nextStepText = (step: Step) =>
  step.at ? [formatWhen(step.at), [step.kind, step.with && `with ${step.with}`].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : null;

export function NextStep({ applicationId, step }: { applicationId: number; step: Step }) {
  const save = useSetNextStep();
  const [editing, setEditing] = useState(false);
  const [at, setAt] = useState(step.at ? toLocalInput(step.at) : "");
  const [kind, setKind] = useState<(typeof NEXT_STEP_KINDS)[number]>((step.kind as (typeof NEXT_STEP_KINDS)[number] | null) ?? "screening");
  const [who, setWho] = useState(step.with ?? "");
  const upcoming = step.at && new Date(step.at) > new Date();

  if (!editing)
    return (
      <div className="flex items-center gap-3.5 rounded-xl bg-muted px-4 py-3.5">
        <div className="flex grow flex-col gap-0.5">
          <span className="eyebrow">Next step</span>
          <span className={upcoming ? undefined : "text-muted-foreground"}>{nextStepText(step) ?? "None set"}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {step.at ? "Edit" : "Set"}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/call/$applicationId" params={{ applicationId: String(applicationId) }}>
            Call card
          </Link>
        </Button>
      </div>
    );

  const submit = (clear = false) =>
    save.mutate([applicationId, clear || !at ? null : { at: new Date(at).toISOString(), kind, with: who.trim() || undefined }], {
      onSuccess: () => setEditing(false),
    });
  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-muted px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="eyebrow">Next step</span>
      <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
        <Input type="datetime-local" aria-label="When" required value={at} onChange={(e) => setAt(e.target.value)} className="font-mono" />
        <select
          aria-label="What"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
        >
          {NEXT_STEP_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <Input aria-label="With whom" placeholder="With whom (e.g. Jane Doe, hiring manager)" value={who} onChange={(e) => setWho(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save
        </Button>
        {step.at && (
          <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => submit(true)}>
            Clear
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {save.error && <span className="text-sm text-destructive">{save.error.message}</span>}
      </div>
    </form>
  );
}
