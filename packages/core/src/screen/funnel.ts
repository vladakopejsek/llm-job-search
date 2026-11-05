import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { applications, companies, postings, priorVerdicts } from "../db/schema.ts";
import { buildTriageContext, type Triage, triage } from "./triage.ts";

/** The posting's key as SQL, matching postingKey() in posting-key.ts. */
const postingKeySql = sql<string>`${companies.ats}::text || ':' || lower(${postings.externalId})`;

type TriagedPosting = Awaited<ReturnType<typeof loadPassed>>[number] & { triage: Triage };

export interface Funnel {
  open: number;
  screenedOut: number;
  passed: number;
  byCategory: Record<Triage["category"], number>;
  postings: TriagedPosting[];
}

function loadPassed(db: Db) {
  return db
    .select({
      id: postings.id,
      postingKey: postingKeySql,
      companyName: companies.name,
      boardToken: companies.boardToken,
      priority: companies.priority,
      title: postings.title,
      location: postings.locationRaw,
      url: postings.url,
      postedAt: postings.postedAt,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(and(isNull(postings.closedAt), eq(companies.status, "active"), eq(postings.screenStatus, "pass")));
}

/**
 * Where the open postings of active companies end up:
 * open → screened out | passed → tracked / company rejected / company in process / judged / new.
 */
export async function funnel(db: Db): Promise<Funnel> {
  const [counts] = await db
    .select({
      open: sql<number>`count(*)::int`,
      screenedOut: sql<number>`count(*) filter (where ${postings.screenStatus} = 'reject')::int`,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(and(isNull(postings.closedAt), eq(companies.status, "active")));

  const [passed, apps, verdicts] = await Promise.all([
    loadPassed(db),
    db.select({ company: applications.company, stage: applications.stage, postingKey: applications.postingKey }).from(applications),
    db.select({ postingKey: priorVerdicts.postingKey, verdict: priorVerdicts.verdict }).from(priorVerdicts),
  ]);

  const ctx = buildTriageContext(apps, verdicts);
  const triaged = passed.map((p) => ({ ...p, triage: triage(p, ctx) }));
  const byCategory = { tracked: 0, company_rejected: 0, company_in_process: 0, judged: 0, new: 0 };
  for (const p of triaged) byCategory[p.triage.category]++;

  return {
    open: counts?.open ?? 0,
    screenedOut: counts?.screenedOut ?? 0,
    passed: passed.length,
    byCategory,
    postings: triaged,
  };
}

/**
 * Open postings the old pipeline judged, next to what the screen did with them.
 * The interesting rows: old verdict Lead/Follow-up but screened out now.
 */
export async function priorVerdictMatches(db: Db) {
  return db
    .select({
      company: companies.name,
      title: postings.title,
      location: postings.locationRaw,
      screenStatus: postings.screenStatus,
      screenReason: postings.screenReason,
      priorVerdict: priorVerdicts.verdict,
      priorReason: priorVerdicts.reason,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .innerJoin(priorVerdicts, eq(priorVerdicts.postingKey, postingKeySql))
    .where(isNull(postings.closedAt));
}
