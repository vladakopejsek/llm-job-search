/** The apply session's data. Logging and skipping are in lib/decisions.ts. */
import { queryOptions } from "@tanstack/react-query";
import { api, call } from "@/lib/api";

/**
 * The form's questions with the pack's drafts, and anything logged before.
 * `drafts: false` is the timing experiment's no-pack arm: the questions only.
 * Fetched fresh each time, so a pack drafted since shows up.
 */
export const applyDraftQuery = (postingId: number, drafts: boolean) =>
  queryOptions({
    queryKey: ["apply-draft", postingId, drafts],
    queryFn: () => call(api.postings[":id"]["apply-draft"].$get({ param: { id: String(postingId) }, query: drafts ? {} : { drafts: "0" } })),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

/** Answers given in earlier applications: questions repeat across forms, so the last good answer is usually the start. */
export const pastAnswersQuery = (q: string) =>
  queryOptions({
    queryKey: ["sent-answers", q],
    queryFn: () => call(api.answers.search.$get({ query: { q } })),
    enabled: q.trim().length > 1,
  });
