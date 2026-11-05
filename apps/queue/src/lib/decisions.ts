/**
 * Decisions about a posting, from any screen. Each is timed (timing/track.ts)
 * once the server has accepted it, so a failed request never counts.
 */
import type { ApplyInput, SkipExtra, SkipReason } from "@llm-job-search/core/queue/actions.ts";
import { track } from "@/timing/track";
import { api, call } from "./api.ts";
import { useAction } from "./use-action.ts";

const byId = (id: number) => ({ param: { id: String(id) } });

export const useShortlist = () =>
  useAction(async (id: number) => {
    const posting = await call(api.postings[":id"].shortlist.$post(byId(id)));
    track("shortlisted", id);
    return posting;
  });

/** `extra`: when you applied and how (Already applied), or the application for the other role (Applied to another role). */
export const useSkip = () =>
  useAction(async (id: number, reason: SkipReason, extra: SkipExtra = {}) => {
    const posting = await call(api.postings[":id"].skip.$post({ ...byId(id), json: { reason, ...extra } }));
    track("skipped", id, { reason });
    return posting;
  });

export const useSnooze = () =>
  useAction(async (id: number, until: string) => {
    const posting = await call(api.postings[":id"].snooze.$post({ ...byId(id), json: { until } }));
    track("snoozed", id);
    return posting;
  });

export const useUndo = () =>
  useAction(async (id: number) => {
    await call(api.postings[":id"].reopen.$post(byId(id)));
    track("undone", id);
  });

/** Applied, with what was sent: the answers, the letter, the salary named. */
export const useLogApplied = () =>
  useAction(async (id: number, input: ApplyInput) => {
    const result = await call(api.postings[":id"].applied.$post({ ...byId(id), json: input }));
    track("apply_saved", id);
    return result;
  });
