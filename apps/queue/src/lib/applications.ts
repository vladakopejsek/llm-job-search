/** One application and what several screens do to it (Today, the Pipeline's sheet, the call card). */
import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, call } from "./api.ts";
import { useAction } from "./use-action.ts";

const byId = (id: number) => ({ param: { id: String(id) } });

/** Everything about one application: the posting, what was sent, the pack's talking points, the timeline. */
export const applicationQuery = (id: number) =>
  queryOptions({ queryKey: ["application", id], queryFn: () => call(api.applications[":id"].$get(byId(id))) });
export type ApplicationDetail = InferResponseType<(typeof api.applications)[":id"]["$get"], 200>;

export const useAddNote = () =>
  useAction((id: number, text: string, context: "call" | "general" = "general") =>
    call(api.applications[":id"].notes.$post({ ...byId(id), json: { text, context } })),
  );
export const useFollowedUp = () => useAction((id: number) => call(api.applications[":id"]["followed-up"].$post(byId(id))));
export const useDrop = () => useAction((id: number) => call(api.applications[":id"].drop.$post(byId(id))));
