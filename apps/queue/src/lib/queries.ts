/** Queries more than one screen reads. A feature's own queries live in its api.ts. */

import type { STATS_RANGES } from "@llm-job-search/core/tracker/filters.ts";
import { queryOptions } from "@tanstack/react-query";
import { api, call } from "./api.ts";

/** What needs deciding, replies to confirm, follow-ups due, and the last run. While packs are drafted, it refetches to show each one. */
export const overviewQuery = queryOptions({
  queryKey: ["overview"],
  queryFn: () => call(api.overview.$get()),
  refetchInterval: (q) => (q.state.data?.drafting ? 5000 : false),
});

export type Overview = Awaited<ReturnType<NonNullable<typeof overviewQuery.queryFn>>>;

/** How the search is going: tiles, funnel and rejections over a range (Today uses the default, 90 days). */
export const statsQuery = (range: (typeof STATS_RANGES)[number] = "90d") =>
  queryOptions({ queryKey: ["tracker-stats", range], queryFn: () => call(api.tracker.stats.$get({ query: { range } })) });
