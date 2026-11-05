/**
 * What was sent with an application, as it's edited: the salary named, the
 * form's questions with the answers given, and the cover letter. Starts from
 * what was logged before, else from the prep pack's drafts. Shared by the
 * apply session and the Tracker's editor.
 */
import type { SubmissionInput } from "@llm-job-search/core/applications/submission.ts";
import { diffWords } from "diff";
import type { InferResponseType } from "hono/client";
import type { api } from "./api.ts";

export type ApplyDraft = InferResponseType<(typeof api.postings)[":id"]["apply-draft"]["$get"], 200>;
/** What was logged before: the fields a draft starts from. */
type Logged = Pick<NonNullable<ApplyDraft["submission"]>, "salaryStated" | "coverLetter"> & {
  answers: Pick<NonNullable<ApplyDraft["submission"]>["answers"][number], "question" | "answer" | "origin" | "draftedAnswer">[];
};
type Origin = "pack" | "added";

export interface AnswerRow {
  key: number;
  question: string;
  answer: string;
  origin: Origin;
  /** The prep pack's draft for this question, to show when it was edited. */
  drafted: string | null;
  /** From the application form: "personal" questions are never drafted; choice ones have options. */
  kind: "text" | "choice" | "personal";
  options: string[] | null;
  /** Why the pack picked this option (choice questions). */
  why: string | null;
}

export interface SubmissionDraft {
  salaryStated: string;
  answers: AnswerRow[];
  coverLetter: string;
  noCoverLetter: boolean;
}

let lastKey = 0;
export const answerRow = (fields: Partial<AnswerRow> & Pick<AnswerRow, "question" | "answer" | "origin">): AnswerRow => ({
  key: ++lastKey,
  drafted: null,
  kind: "text",
  options: null,
  why: null,
  ...fields,
});

export function initialDraft(pack: Pick<ApplyDraft, "answers" | "coverLetter" | "coverLetterField"> | null, logged: Logged | null): SubmissionDraft {
  if (logged)
    return {
      salaryStated: logged.salaryStated ?? "",
      answers: logged.answers.map((a) =>
        answerRow({ question: a.question, answer: a.answer, origin: a.origin === "pack" ? "pack" : "added", drafted: a.draftedAnswer }),
      ),
      coverLetter: logged.coverLetter ?? "",
      noCoverLetter: logged.coverLetter === null,
    };
  return {
    salaryStated: "",
    // Every question of the form, in its order: drafted ones filled in, the rest left for you.
    answers: (pack?.answers ?? []).map((a) =>
      answerRow({
        question: a.question,
        answer: a.answer,
        origin: a.answer ? "pack" : "added",
        drafted: a.answer || null,
        kind: a.kind,
        options: a.options,
        why: a.why,
      }),
    ),
    coverLetter: pack?.coverLetter ?? "",
    noCoverLetter: !pack?.coverLetter && pack?.coverLetterField === "none",
  };
}

/** The form as the server takes it. Unanswered questions are dropped; an answer without its question is refused. */
export function toSubmissionInput(d: SubmissionDraft): { input: SubmissionInput } | { error: string } {
  const rows = d.answers.filter((a) => a.answer.trim());
  if (rows.some((a) => !a.question.trim())) return { error: "Each answer needs the question it answers." };
  return {
    input: {
      salaryStated: d.salaryStated.trim() || null,
      answers: rows.map((a) => ({ question: a.question.trim(), answer: a.answer, origin: a.origin })),
      coverLetter: d.noCoverLetter || !d.coverLetter.trim() ? null : d.coverLetter,
    },
  };
}

/** How many words were changed, the larger of added and removed: a one-word swap counts once. */
export function wordsChanged(before: string, after: string) {
  let added = 0;
  let removed = 0;
  for (const part of diffWords(before, after)) {
    const n = part.value.split(/\s+/).filter(Boolean).length;
    if (part.added) added += n;
    else if (part.removed) removed += n;
  }
  return Math.max(added, removed);
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
export const isEdited = (drafted: string | null, now: string) => drafted !== null && drafted.trim() !== now.trim();
