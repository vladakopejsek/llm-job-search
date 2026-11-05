import { and, eq, inArray, sql } from "drizzle-orm";
import type { Queryable } from "../applications/events.ts";
import { postingSnapshots, postings } from "../db/schema.ts";

/**
 * Snapshot the current text of these postings, if it isn't already, and return
 * each posting's current snapshot id.
 *
 * Collect keeps only the latest text, on the posting itself. A snapshot is taken
 * when something needs to point at the exact text: an evaluation, a
 * re-evaluation request, a submission. Most postings are screened out and never
 * read, so snapshotting every version at collect time mostly stored copies
 * nothing looked at.
 */
export async function ensureSnapshots(q: Queryable, postingIds: number[]): Promise<Map<number, number>> {
  if (!postingIds.length) return new Map();
  await q.execute(sql`
    insert into ${postingSnapshots} (posting_id, content_hash, description_text)
    select id, content_hash, description_text from ${postings} where id in ${postingIds}
    on conflict do nothing`);
  const rows = await q
    .select({ postingId: postings.id, snapshotId: postingSnapshots.id })
    .from(postings)
    .innerJoin(postingSnapshots, and(eq(postingSnapshots.postingId, postings.id), eq(postingSnapshots.contentHash, postings.contentHash)))
    .where(inArray(postings.id, postingIds));
  return new Map(rows.map((r) => [r.postingId, r.snapshotId]));
}
