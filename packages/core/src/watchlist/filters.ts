/** What the Companies page lists, and when a watched company's feed looks dead. Shared by the page and the API. */
export const COMPANY_TABS = ["active", "paused", "discovered"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];
/** Rows per tab; past this, search. */
export const COMPANY_LIST_LIMIT = 200;

/** A watched company with no new role for this long is flagged as possibly a dead feed. */
export const STALE_AFTER_DAYS = 60;

export interface HealthInput {
  status: string;
  lastFetch: { status: string } | null;
  openPostings: number;
  /** Newest open posting (posted, else first seen). A string when it came over JSON. */
  newestPostingAt: Date | string | null;
}

/**
 * Is a company's feed worth a look? Stale: watched, its last fetch worked (a
 * failing or unsupported board is flagged as such, and a just-promoted one
 * hasn't been fetched yet), and nothing new for STALE_AFTER_DAYS or nothing
 * open at all.
 */
export function healthOf(row: HealthInput, today: Date = new Date()) {
  const newest = row.newestPostingAt ? new Date(row.newestPostingAt) : null;
  const daysSinceNewest = newest ? Math.max(0, Math.floor((today.getTime() - newest.getTime()) / 864e5)) : null;
  const stale =
    row.status === "active" &&
    row.lastFetch?.status === "ok" &&
    (row.openPostings === 0 || daysSinceNewest === null || daysSinceNewest >= STALE_AFTER_DAYS);
  return { daysSinceNewest, stale, failing: row.lastFetch?.status === "error" };
}
