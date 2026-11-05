/** What you sent: the salary named, the answers, the letter. Read here before a call; Edit to correct it. */
import { useState } from "react";
import { AdaptiveSheet } from "@/components/jr/AdaptiveSheet";
import { Chip } from "@/components/jr/Chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ApplicationDetail } from "@/lib/applications";
import { initialDraft, isEdited, toSubmissionInput, wordCount } from "@/lib/submission";
import { useSaveSubmission } from "./api.ts";

type Submission = ApplicationDetail["submission"];

function Editor({ applicationId, submission, onClose }: { applicationId: number; submission: Submission; onClose: () => void }) {
  const save = useSaveSubmission();
  const [form, setForm] = useState(() => initialDraft(null, submission));
  const [invalid, setInvalid] = useState<string | null>(null);
  const setAnswer = (key: number, answer: string) => setForm({ ...form, answers: form.answers.map((a) => (a.key === key ? { ...a, answer } : a)) });
  return (
    <form
      className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const r = toSubmissionInput(form);
        setInvalid("error" in r ? r.error : null);
        if ("input" in r) save.mutate([applicationId, r.input], { onSuccess: onClose });
      }}
    >
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Salary stated
        <Input value={form.salaryStated} onChange={(e) => setForm({ ...form, salaryStated: e.target.value })} className="font-mono" />
      </label>
      {form.answers.map((a) => (
        <label key={a.key} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {a.question}
          <Textarea value={a.answer} onChange={(e) => setAnswer(a.key, e.target.value)} className="field-sizing-content min-h-12 text-sm" />
        </label>
      ))}
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Cover letter
        <Textarea
          value={form.noCoverLetter ? "" : form.coverLetter}
          placeholder="None sent"
          onChange={(e) => setForm({ ...form, coverLetter: e.target.value, noCoverLetter: !e.target.value.trim() })}
          className="field-sizing-content min-h-24 text-sm"
        />
      </label>
      {(invalid || save.error) && <p className="text-sm text-destructive">{invalid ?? save.error?.message}</p>}
      <Button type="submit" disabled={save.isPending} className="self-start">
        Save
      </Button>
    </form>
  );
}

export function SentSection({ applicationId, submission }: { applicationId: number; submission: Submission }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center">
        <h3 className="eyebrow grow">What you sent</h3>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          {submission ? "Edit" : "Log it"}
        </Button>
      </div>
      {submission ? (
        <dl className="grid grid-cols-[120px_1fr] gap-x-3.5 gap-y-2.5 text-[13px] md:grid-cols-[140px_1fr]">
          <dt className="text-muted-foreground">Salary stated</dt>
          <dd className="font-mono">{submission.salaryStated ?? "—"}</dd>
          {submission.answers.map((a) => (
            <div key={a.id} className="contents">
              <dt className="text-muted-foreground">{a.question}</dt>
              <dd className="text-foreground-2">
                <span className="line-clamp-3">{a.answer}</span>
                {isEdited(a.draftedAnswer, a.answer) && <Chip className="mt-1 h-5">edited from draft</Chip>}
              </dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Cover letter</dt>
          <dd className="text-foreground-2">{submission.coverLetter ? `Sent · ${wordCount(submission.coverLetter)} words` : "None"}</dd>
        </dl>
      ) : (
        <p className="text-[13px] text-muted-foreground">Nothing logged. Log what you sent, so you can read it before the call.</p>
      )}
      <AdaptiveSheet open={editing} onOpenChange={setEditing} title="What you sent">
        {editing && <Editor applicationId={applicationId} submission={submission} onClose={() => setEditing(false)} />}
      </AdaptiveSheet>
    </section>
  );
}
