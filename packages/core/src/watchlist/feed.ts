/**
 * Setting where a company's jobs come from. Shared by `pnpm company` and the
 * watchlist page, so both prove a board works before watching it.
 */
import { eq } from "drizzle-orm";
import { type Ats, collectorFor, parseFeedUrl } from "../ats/index.ts";
import type { Db } from "../db/client.ts";
import { companies } from "../db/schema.ts";

/** A URL we can't collect from. Nothing was saved. */
export class FeedCheckError extends Error {
  constructor(
    message: string,
    /** "unreadable": no known board in the URL; "unsupported": a board type without a collector. */
    readonly reason: "unreadable" | "unsupported",
  ) {
    super(message);
  }
}

/**
 * Fetch the board once and, only if that works, save it as the company's feed
 * and watch the company. A board with zero open jobs still counts as working.
 */
export async function checkAndSetFeed(db: Db, companyId: number, url: string, atsHint?: Ats) {
  const board = parseFeedUrl(url, atsHint);
  if (!board) throw new FeedCheckError(`Can't read a supported job board from ${url}.`, "unreadable");
  const collector = collectorFor(board.ats);
  if (!collector) throw new FeedCheckError(`${board.ats} has no collector yet.`, "unsupported");

  const postings = await collector.fetchPostings(board);
  const updated = await db
    .update(companies)
    .set({ ats: board.ats, boardToken: board.token, boardHost: board.host, feedUrl: url, status: "active" })
    .where(eq(companies.id, companyId))
    .returning({ id: companies.id });
  if (!updated.length) throw new Error(`No company with id ${companyId}`);
  return { ats: board.ats, token: board.token, postingsOnBoard: postings.length };
}

/** Jobs only on the company's own careers page: stop collecting it, keep the page to check by hand. */
export async function setNoFeed(db: Db, companyId: number, careersUrl?: string) {
  const updated = await db
    .update(companies)
    .set({ status: "no_feed", ats: "other", boardToken: null, boardHost: null, feedUrl: null, ...(careersUrl ? { boardUrl: careersUrl } : {}) })
    .where(eq(companies.id, companyId))
    .returning({ id: companies.id });
  if (!updated.length) throw new Error(`No company with id ${companyId}`);
}
