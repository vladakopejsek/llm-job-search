/** The Pipeline's data, and what the application sheet changes. */
import type { SubmissionInput } from "@llm-job-search/core/applications/submission.ts";
import type { NextStepInput } from "@llm-job-search/core/queue/actions.ts";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, call } from "@/lib/api";
import { useAction } from "@/lib/use-action";

/** Every application with its progress; `q` searches what you sent. Keeps the last list on screen while a search runs. */
export const pipelineQuery = (q: string) =>
  queryOptions({ queryKey: ["pipeline", q], queryFn: () => call(api.pipeline.$get({ query: q ? { q } : {} })), placeholderData: keepPreviousData });
export type PipelineRow = InferResponseType<typeof api.pipeline.$get, 200>[number];

const byId = (id: number) => ({ param: { id: String(id) } });

export const useSetStage = () =>
  useAction((id: number, stage: PipelineRow["stage"], on: string, note: string) =>
    call(api.applications[":id"].stage.$post({ ...byId(id), json: { stage, on, note: note || undefined } })),
  );
export const usePastStep = () =>
  useAction((id: number, stage: PipelineRow["stage"], on: string, note: string) =>
    call(api.applications[":id"]["past-step"].$post({ ...byId(id), json: { stage, on, note: note || undefined } })),
  );
export const useSetNextStep = () =>
  useAction((id: number, step: NextStepInput) => call(api.applications[":id"]["next-step"].$put({ ...byId(id), json: { step } })));
export const useRejectionReason = () =>
  useAction((id: number, reason: string) =>
    call(api.applications[":id"]["rejection-reason"].$put({ ...byId(id), json: { reason: reason.trim() || null } })),
  );
export const useSaveSubmission = () =>
  useAction((id: number, input: SubmissionInput) => call(api.applications[":id"].submission.$put({ ...byId(id), json: input })));
