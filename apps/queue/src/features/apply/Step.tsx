/**
 * One posting in the apply session: its form's questions in order, each ready
 * to copy, what only you answer, the letter, and the brief beside them.
 * Showing a step starts its apply clock (packages/core/src/queue/timing.ts).
 */
import type { Channel } from "@llm-job-search/core/applications/constants.ts";
import type { SubmissionInput } from "@llm-job-search/core/applications/submission.ts";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChannelSelect } from "@/components/ChannelSelect";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayIso } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import { useOverlays } from "@/lib/overlays";
import type { Overview } from "@/lib/queries";
import { type AnswerRow, answerRow, initialDraft, type SubmissionDraft, toSubmissionInput } from "@/lib/submission";
import { useArm } from "@/timing/experiment";
import { track } from "@/timing/track";
import { AnswerCard } from "./AnswerCard.tsx";
import { applyDraftQuery } from "./api.ts";
import { Brief } from "./Brief.tsx";
import { CoverLetter } from "./CoverLetter.tsx";
import { PastAnswers } from "./PastAnswers.tsx";
import { YoursCards } from "./YoursCards.tsx";

type Shortlisted = Overview["shortlist"][number];

export interface Logged {
  appliedOn: string;
  channel: Channel;
  submission: SubmissionInput;
}

interface Props {
  lead: Shortlisted;
  form: SubmissionDraft | undefined;
  setForm: (form: SubmissionDraft) => void;
  copied: ReadonlySet<number>;
  onCopied: (key: number) => void;
  /** Off while a sheet (skip reasons) is open. */
  keys: boolean;
  logging: boolean;
  onLog: (logged: Logged) => void;
  onSkip: () => void;
  onNotNow: () => void;
}

export function Step({ lead, form, setForm, copied, onCopied, keys, logging, onLog, onSkip, onNotNow }: Props) {
  // The timing experiment's no-pack arm starts from the form's questions alone.
  const showPack = useArm(lead.postingId, !!lead.pack) !== "no_pack";
  const { data: draft, error } = useQuery(applyDraftQuery(lead.postingId, showPack));
  const [appliedOn, setAppliedOn] = useState(todayIso());
  const [channel, setChannel] = useState<Channel>("ats_form");
  const [focusedKey, setFocusedKey] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const overlay = useOverlays();

  useEffect(() => track("session_started", lead.postingId), [lead.postingId]);
  // The first copy of the drafts starts the form; a later refetch mustn't reset what's been typed.
  useEffect(() => {
    if (draft && !form) setForm(initialDraft(draft, draft.submission));
  }, [draft, form, setForm]);

  const set = (patch: Partial<SubmissionDraft>) => form && setForm({ ...form, ...patch });
  const setRow = (key: number, patch: Partial<AnswerRow>) =>
    form && set({ answers: form.answers.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  const numbered = (form?.answers ?? []).map((row, i) => ({ row, number: i + 1 }));
  const written = numbered.filter(({ row }) => row.kind !== "personal");
  const personal = numbered.filter(({ row }) => row.kind === "personal");

  const copy = (text: string, key: number) =>
    navigator.clipboard.writeText(text).then(
      () => {
        onCopied(key);
        track("answer_copied", lead.postingId);
      },
      () => toast.error("The browser didn't allow copying. It needs https or localhost."),
    );
  const log = () => {
    if (!form) return;
    const result = toSubmissionInput(form);
    setInvalid("error" in result ? result.error : null);
    // Pin the pack shown here (none in the no-pack arm), not whatever the posting's latest is.
    if ("input" in result) onLog({ appliedOn, channel, submission: { ...result.input, prepPackId: draft?.prepPackId ?? null } });
  };

  useHotkeys(
    {
      c: () => {
        const row = form?.answers.find((a) => a.key === focusedKey) ?? written.find(({ row }) => !copied.has(row.key) && row.answer.trim())?.row;
        if (row) void copy(row.answer, row.key);
      },
      n: onSkip,
      "mod+Enter": log,
    },
    // Not while logging (a second ⌘↵ would log twice), nor under the app's posting sheet.
    keys && !searching && !logging && overlay.postingId === null,
  );

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="grid min-h-0 grow grid-cols-[minmax(0,1fr)_480px]">
        <section className="flex flex-col gap-[18px] overflow-y-auto px-10 py-8">
          <div className="flex items-end gap-4">
            <div className="flex grow flex-col gap-1.5">
              <p className="eyebrow">
                {[lead.company, lead.ats !== "none" && lead.ats !== "other" && `${lead.ats} form`, `${form?.answers.length ?? 0} questions`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <h2 className="text-[30px] leading-[1.08] font-semibold tracking-[-0.035em]">{lead.title}</h2>
            </div>
            <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
              {written.filter(({ row }) => copied.has(row.key)).length} of {written.length} copied
            </span>
            <Button variant="outline" size="sm" onClick={() => setSearching(true)}>
              <Search />
              Past answers
            </Button>
          </div>

          {error && <p className="text-destructive">Couldn't load the drafts: {error.message}</p>}
          {!form && !error && <p className="text-muted-foreground">Loading the drafts…</p>}
          {form && (
            <>
              {!form.answers.length && (
                <p className="text-muted-foreground">
                  The form's questions couldn't be read. Add each one as you answer it; it's what you'll read before the call.
                </p>
              )}
              {written.map(({ row, number }) => (
                <AnswerCard
                  key={row.key}
                  row={row}
                  number={number}
                  copied={copied.has(row.key)}
                  focused={row.key === focusedKey}
                  onFocus={() => setFocusedKey(row.key)}
                  onChange={(patch) => setRow(row.key, patch)}
                  onCopy={() => void copy(row.answer, row.key)}
                  onRemove={() => set({ answers: form.answers.filter((a) => a.key !== row.key) })}
                />
              ))}
              <YoursCards
                form={form}
                personal={personal}
                payTarget={lead.payTarget}
                onSalary={(salaryStated) => set({ salaryStated })}
                onAnswer={(key, answer) => setRow(key, { answer })}
              />
              <CoverLetter
                form={form}
                draftLetter={draft?.submission?.draftedCoverLetter ?? draft?.coverLetter ?? null}
                field={draft?.coverLetterField ?? null}
                onChange={set}
                onCopy={() => void copy(form.coverLetter, -1)}
              />
              <Button
                variant="ghost"
                className="self-start"
                onClick={() => {
                  const row = answerRow({ question: "", answer: "", origin: "added" });
                  set({ answers: [...form.answers, row] });
                  setFocusedKey(row.key);
                }}
              >
                <Plus />
                Add question from the form
              </Button>
            </>
          )}
        </section>
        <Brief lead={lead} showPack={showPack} />
      </div>

      <footer className="flex h-[76px] shrink-0 items-center gap-3.5 border-t px-10">
        <label htmlFor="applied-on" className="text-xs text-muted-foreground">
          Applied on
        </label>
        <Input
          id="applied-on"
          type="date"
          value={appliedOn}
          max={todayIso()}
          onChange={(e) => setAppliedOn(e.target.value)}
          className="w-40 font-mono"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Channel
          <ChannelSelect id="apply-channel" value={channel} onChange={setChannel} />
        </label>
        {invalid && <span className="text-sm text-destructive">{invalid}</span>}
        <div className="grow" />
        <Button variant="ghost" onClick={onSkip}>
          Skip
          <KeyHint>N</KeyHint>
        </Button>
        <Button variant="outline" onClick={onNotNow}>
          Not now
        </Button>
        <Button size="lg" disabled={!form || logging} onClick={log}>
          {logging ? "Logging…" : "Log applied"}
          <KeyHint>⌘↵</KeyHint>
        </Button>
      </footer>

      <PastAnswers
        open={searching}
        onOpenChange={setSearching}
        onInsert={(question, answer) => form && set({ answers: [...form.answers, answerRow({ question, answer, origin: "added" })] })}
      />
    </div>
  );
}
