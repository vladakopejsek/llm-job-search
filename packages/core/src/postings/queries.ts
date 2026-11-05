/**
 * Postings outside the queue: search across everything collected (⌘K), and
 * one posting as the posting sheet shows it, whatever the screen, the agent or
 * the candidate made of it.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Facts } from "../agent/facts.ts";
import type { PrepPack } from "../agent/prep.ts";
import type { Db } from "../db/client.ts";
import { applications, companies, evaluations, postingSnapshots, postings, prepPacks, reevaluationRequests } from "../db/schema.ts";
import { headline, trigramMatch, trigramRank, tsMatch, tsRank } from "../lib/search.ts";

/**
 * Postings matching `q`, best first: a company-name match ranks above any text
 * match (searching "acme" means Acme's roles). The snippet (ts_headline
 * re-parses the whole text) is computed for the returned rows only.
 */
export async function searchPostings(db: Db, q: string, limit = 8) {
  const byName = sql`case when ${trigramMatch(companies.name, q)} then 1 + ${trigramRank(companies.name, q)} else 0 end`;
  const hits = db
    .select({ id: postings.id, rank: sql<number>`${byName} + ${tsRank(postings.search, q)}`.as("rank") })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    // The company match as a list of ids: an OR across the two tables lets neither index drive the scan.
    .where(
      or(tsMatch(postings.search, q), sql`${postings.companyId} = any(array(select id from ${companies} where ${trigramMatch(companies.name, q)}))`),
    )
    .orderBy(desc(sql`rank`), desc(postings.firstSeenAt))
    .limit(limit)
    .as("hits");
  return db
    .select({
      id: postings.id,
      title: postings.title,
      company: companies.name,
      closed: sql<boolean>`${postings.closedAt} is not null`,
      verdict: sql<
        "lead" | "needs_check" | "rejected" | null
      >`(select e.verdict from ${evaluations} e where e.posting_id = ${postings.id} order by e.created_at desc limit 1)`,
      snippet: headline(postings.descriptionText, q, { maxFragments: 1, maxWords: 18 }),
    })
    .from(hits)
    .innerJoin(postings, eq(postings.id, hits.id))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .orderBy(desc(hits.rank));
}

/** One posting for the posting sheet: its evaluation of the text on the board now, the pack, your decision, a pending re-evaluation. */
export async function postingDetail(db: Db, postingId: number) {
  const [posting] = await db
    .select({
      id: postings.id,
      title: postings.title,
      url: postings.url,
      location: postings.locationRaw,
      text: postings.descriptionText,
      postedAt: postings.postedAt,
      firstSeenAt: postings.firstSeenAt,
      closedAt: postings.closedAt,
      screenStatus: postings.screenStatus,
      screenReason: postings.screenReason,
      eligibilityConfirmedAt: postings.eligibilityConfirmedAt,
      company: { id: companies.id, name: companies.name, ats: companies.ats, priority: companies.priority },
      contentHash: postings.contentHash,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(eq(postings.id, postingId));
  if (!posting) throw new Error(`posting ${postingId} not found`);

  const [[evaluation], [application], [reevaluation]] = await Promise.all([
    db
      .select({
        id: evaluations.id,
        verdict: evaluations.verdict,
        reasons: evaluations.reasons,
        fitScore: evaluations.fitScore,
        facts: evaluations.facts,
        pack: prepPacks.content,
      })
      .from(evaluations)
      .innerJoin(postingSnapshots, and(eq(postingSnapshots.id, evaluations.snapshotId), eq(postingSnapshots.contentHash, posting.contentHash)))
      .leftJoin(prepPacks, eq(prepPacks.evaluationId, evaluations.id))
      .where(eq(evaluations.postingId, postingId))
      .orderBy(desc(evaluations.createdAt))
      .limit(1),
    db
      .select({
        id: applications.id,
        stage: applications.stage,
        skipReason: applications.skipReason,
        snoozedUntil: applications.snoozedUntil,
        appliedOn: applications.appliedOn,
      })
      .from(applications)
      .where(eq(applications.postingId, postingId)),
    db
      .select({ note: reevaluationRequests.note, requestedAt: reevaluationRequests.requestedAt })
      .from(reevaluationRequests)
      .where(and(eq(reevaluationRequests.postingId, postingId), eq(reevaluationRequests.status, "pending"))),
  ]);

  const { contentHash: _hash, ...rest } = posting;
  return {
    posting: rest,
    evaluation: evaluation ? { ...evaluation, facts: evaluation.facts as Facts, pack: evaluation.pack as PrepPack | null } : null,
    application: application ?? null,
    reevaluation: reevaluation ?? null,
  };
}

/** One stored version of a posting's text; the id must belong to the posting. */
export async function snapshotText(db: Db, postingId: number, snapshotId: number) {
  const [row] = await db
    .select({ id: postingSnapshots.id, capturedAt: postingSnapshots.capturedAt, text: postingSnapshots.descriptionText })
    .from(postingSnapshots)
    .where(and(eq(postingSnapshots.id, snapshotId), eq(postingSnapshots.postingId, postingId)));
  if (!row) throw new Error(`snapshot ${snapshotId} doesn't belong to posting ${postingId}`);
  return row;
}
