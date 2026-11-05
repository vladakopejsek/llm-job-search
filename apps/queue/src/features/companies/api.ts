/** Companies' data and what the page changes: watching, priority, promoting a discovered one. */
import type { CompanyTab } from "@llm-job-search/core/watchlist/filters.ts";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, call } from "@/lib/api";
import { useAction } from "@/lib/use-action";

export const companiesQuery = (status: CompanyTab, q: string) =>
  queryOptions({
    queryKey: ["companies", status, q],
    queryFn: () => call(api.companies.$get({ query: q ? { status, q } : { status } })),
    placeholderData: keepPreviousData,
  });
export type CompanyRow = InferResponseType<typeof api.companies.$get, 200>["rows"][number];

const byId = (id: number) => ({ param: { id: String(id) } });

export const useWatch = () => useAction((id: number, watched: boolean) => call(api.companies[":id"].watch.$post({ ...byId(id), json: { watched } })));
export const usePriority = () =>
  useAction((id: number, priority: "A" | "B" | "C") => call(api.companies[":id"].priority.$put({ ...byId(id), json: { priority } })));
export const usePromote = () => useAction((id: number) => call(api.companies[":id"].promote.$post(byId(id))));
