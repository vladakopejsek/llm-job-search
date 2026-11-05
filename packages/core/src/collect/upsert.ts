import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { NormalizedPosting } from "../ats/types.ts";
import type { Db } from "../db/client.ts";
import { postings } from "../db/schema.ts";
import { contentHash } from "../lib/text.ts";

export interface UpsertStats {
  new: number;
  changed: number;
  reopened: number;
  closed: number;
}

const CHUNK = 200;

/**
 * Save one company's current postings after a *successful* fetch, in one
 * transaction:
 *  1. insert new postings, update known ones that changed (and reopen any that
 *     had closed);
 *  2. close the company's open postings that are no longer on the board.
 *
 * An unchanged posting is not written at all. Postgres never updates a row in
 * place: every UPDATE writes a new copy, including the `search` vector it
 * regenerates, so rewriting ~11k postings per run made the table mostly dead
 * space. Snapshots are not taken here either; see ensureSnapshots().
 *
 * Step 2 is only safe because the caller got a complete, successful response.
 * A failed fetch must never reach this function, or every posting of that
 * company would be marked closed.
 */
export async function savePostings(
  db: Db,
  companyId: number,
  kept: NormalizedPosting[],
  /** Every external id on the board, including roles the title filter dropped. */
  listedIds: string[],
): Promise<UpsertStats> {
  // An ATS occasionally lists a job twice; one insert can't update the same row twice.
  const unique = [...new Map(kept.map((p) => [p.externalId, p])).values()];

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ externalId: postings.externalId, contentHash: postings.contentHash, closedAt: postings.closedAt })
      .from(postings)
      .where(eq(postings.companyId, companyId));
    const known = new Map(existing.map((p) => [p.externalId, p]));

    const stats: UpsertStats = { new: 0, changed: 0, reopened: 0, closed: 0 };
    const rows = unique.map((p) => {
      const hash = contentHash(p.descriptionText);
      const before = known.get(p.externalId);
      if (!before) stats.new++;
      else {
        if (before.contentHash !== hash) stats.changed++;
        if (before.closedAt) stats.reopened++;
      }
      return {
        companyId,
        externalId: p.externalId,
        url: p.url,
        title: p.title,
        locationRaw: p.locationRaw,
        workplaceRaw: p.workplaceRaw,
        department: p.department,
        descriptionText: p.descriptionText,
        compensationRaw: p.compensationRaw,
        raw: p.raw,
        contentHash: hash,
        postedAt: p.postedAt,
      };
    });

    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx
        .insert(postings)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [postings.companyId, postings.externalId],
          set: {
            url: sql`excluded.url`,
            title: sql`excluded.title`,
            locationRaw: sql`excluded.location_raw`,
            workplaceRaw: sql`excluded.workplace_raw`,
            department: sql`excluded.department`,
            descriptionText: sql`excluded.description_text`,
            compensationRaw: sql`excluded.compensation_raw`,
            raw: sql`excluded.raw`,
            contentHash: sql`excluded.content_hash`,
            postedAt: sql`excluded.posted_at`,
            lastSeenAt: sql`now()`,
            closedAt: null,
          },
          // `raw` is left out of the comparison: ATS objects carry timestamps
          // that change without the posting changing. It's refreshed whenever
          // anything below changes.
          setWhere: sql`${postings.closedAt} is not null or (
            ${postings.contentHash}, ${postings.url}, ${postings.title}, ${postings.locationRaw},
            ${postings.workplaceRaw}, ${postings.department}, ${postings.compensationRaw}, ${postings.postedAt}
          ) is distinct from (
            excluded.content_hash, excluded.url, excluded.title, excluded.location_raw,
            excluded.workplace_raw, excluded.department, excluded.compensation_raw, excluded.posted_at
          )`,
        });
    }

    const closed = await tx
      .update(postings)
      .set({ closedAt: sql`now()` })
      .where(
        and(eq(postings.companyId, companyId), isNull(postings.closedAt), listedIds.length ? notInArray(postings.externalId, listedIds) : undefined),
      )
      .returning({ id: postings.id });
    stats.closed = closed.length;

    return stats;
  });
}
