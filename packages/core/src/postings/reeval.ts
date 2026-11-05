/**
 * "Evaluate this posting again." A request freezes what the candidate
 * disagreed with (the latest verdict, reasons, fit and facts, and the screen's
 * result) next to their note, the answer they expect. The next daily run
 * evaluates the posting like any other, without the note; comparing its new
 * verdict with the note makes each request an eval case.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { evaluations, postingSnapshots, postings, reevaluationRequests } from "../db/schema.ts";
import { ensureSnapshots } from "./snapshots.ts";

/**
 * Ask for re-evaluation of open postings. Postings that already have a pending
 * request are left as they are (one pending request per posting, enforced by a
 * unique partial index); closed ones are skipped, since the run never reads them.
 */
export async function requestReevaluation(db: Db, postingIds: number[], note?: string | null) {
  if (!postingIds.length) return { requested: [] as number[], skipped: [] as number[] };
  const text = note?.trim() || null;
  await ensureSnapshots(db, postingIds);
  // One statement for any number of postings: the current snapshot and the
  // latest evaluation are looked up per posting in SQL.
  const rows = await db.execute<{ posting_id: number }>(sql`
    insert into ${reevaluationRequests} (
      posting_id, snapshot_id, note, prior_evaluation_id, prior_verdict, prior_reasons,
      prior_fit_score, prior_facts, prior_screen_status, prior_screen_rule)
    select p.id, s.id, ${text}, e.id, e.verdict, e.reasons, e.fit_score, e.facts, p.screen_status, p.screen_rule
    from ${postings} p
    join ${postingSnapshots} s on s.posting_id = p.id and s.content_hash = p.content_hash
    left join lateral (
      select id, verdict, reasons, fit_score, facts from ${evaluations}
      where posting_id = p.id order by created_at desc, id desc limit 1
    ) e on true
    where p.id in ${postingIds} and p.closed_at is null
    on conflict do nothing
    returning posting_id`);
  const requested = [...rows].map((r) => Number(r.posting_id));
  return { requested, skipped: postingIds.filter((id) => !requested.includes(id)) };
}

export async function cancelReevaluation(db: Db, postingId: number) {
  const rows = await db
    .update(reevaluationRequests)
    .set({ status: "cancelled", resolvedAt: sql`now()` })
    .where(and(eq(reevaluationRequests.postingId, postingId), eq(reevaluationRequests.status, "pending")))
    .returning({ id: reevaluationRequests.id });
  if (!rows.length) throw new Error("no pending re-evaluation for this posting");
}
