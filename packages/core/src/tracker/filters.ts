/** The ranges the Pipeline's numbers can cover. Shared by the page and the API. */
export const STATS_RANGES = ["30d", "90d", "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
