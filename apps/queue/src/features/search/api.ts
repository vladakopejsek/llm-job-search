/** ⌘K's search, and the posting sheet's data and actions. */
import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, call } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/format";
import { skipText } from "@/lib/labels";
import { useAction } from "@/lib/use-action";

/** Applications, postings, companies and past answers matching `q` (2+ characters). */
export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ["search", q],
    queryFn: () => call(api.search.$get({ query: { q } })),
    enabled: q.trim().length >= 2,
  });

export const postingQuery = (id: number) =>
  queryOptions({ queryKey: ["posting", id], queryFn: () => call(api.postings[":id"].$get({ param: { id: String(id) } })) });
export type PostingDetail = InferResponseType<(typeof api.postings)[":id"]["$get"], 200>;

const byId = (id: number) => ({ param: { id: String(id) } });

/** "Wrong verdict?": the next run evaluates it again. The note is only for you. */
export const useReevaluate = () =>
  useAction((id: number, note: string) => call(api.postings[":id"].reevaluate.$post({ ...byId(id), json: { note: note.trim() || undefined } })));
export const useCancelReevaluation = () => useAction((id: number) => call(api.postings[":id"].reevaluate.$delete(byId(id))));

/** Where your decision on a posting stands, in words; null while it's undecided (or its snooze has run out). */
export function decisionText(app: PostingDetail["application"]) {
  if (!app) return null;
  if (app.stage === "lead") return app.snoozedUntil && app.snoozedUntil > todayIso() ? `Snoozed until ${formatDate(app.snoozedUntil)}` : null;
  if (app.stage === "skipped") return `Skipped · ${skipText(app.skipReason)}`;
  if (app.stage === "shortlisted") return "Shortlisted";
  if (app.stage === "applied") return app.appliedOn ? `Applied ${formatDate(app.appliedOn)}` : "Applied";
  return app.stage.replace("_", " ");
}
