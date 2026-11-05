/**
 * The Companies page: every company with how its feed is doing. Per-company
 * facts come from lateral subqueries (one pass over companies, no N+1): the
 * latest fetch, open postings and leads, the active application.
 */
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { ACTIVE_STAGES } from "../applications/constants.ts";
import type { Db } from "../db/client.ts";
import { applications, companies, companyFetches, discoveredRoles, evaluations, postingSnapshots, postings } from "../db/schema.ts";
import { trigramMatch, trigramRank } from "../lib/search.ts";
import { COMPANY_LIST_LIMIT, type CompanyTab, healthOf } from "./filters.ts";

/** Everything the list filters, sorts and shows, joined onto companies. */
function companyFacts(db: Db) {
  const lastFetch = db
    .select({ status: companyFetches.status, httpStatus: companyFetches.httpStatus, error: companyFetches.error, at: companyFetches.createdAt })
    .from(companyFetches)
    .where(eq(companyFetches.companyId, companies.id))
    .orderBy(desc(companyFetches.createdAt))
    .limit(1)
    .as("last_fetch");

  // A lead counts only if its evaluation is of the text currently on the board.
  const isLead = sql`exists (
    select 1 from ${evaluations} e
    join ${postingSnapshots} s on s.id = e.snapshot_id and s.content_hash = ${postings.contentHash}
    where e.posting_id = ${postings.id} and e.verdict = 'lead' and e.purpose = 'queue')`;
  const stats = db
    .select({
      open: sql<number>`count(*)::int`.as("open"),
      leads: sql<number>`(count(*) filter (where ${isLead}))::int`.as("leads"),
      newest: sql<Date | null>`max(coalesce(${postings.postedAt}, ${postings.firstSeenAt}))`.mapWith(postings.firstSeenAt).as("newest"),
    })
    .from(postings)
    .where(and(eq(postings.companyId, companies.id), isNull(postings.closedAt)))
    .as("stats");

  const activeApp = db
    .select({ stage: applications.stage, appliedOn: applications.appliedOn })
    .from(applications)
    .where(and(eq(applications.companyId, companies.id), inArray(applications.stage, ACTIVE_STAGES)))
    .orderBy(desc(applications.updatedAt))
    .limit(1)
    .as("active_app");

  return { lastFetch, stats, activeApp };
}

/**
 * A discovered role's title without its own location or anything in
 * parentheses, so one role listed per city counts once (titleKey() in
 * discover/rank.ts, in SQL).
 */
const ROLE_TITLE = sql`btrim(regexp_replace(regexp_replace(
  case when ${discoveredRoles.location} <> '' and right(lower(${discoveredRoles.title}), length(${discoveredRoles.location})) = lower(${discoveredRoles.location})
    then left(${discoveredRoles.title}, length(${discoveredRoles.title}) - length(${discoveredRoles.location})) else ${discoveredRoles.title} end,
  '\\s*[-–—,]\\s*$', ''), '\\s*\\([^)]*\\)', '', 'g'))`;

const PRIORITY_ORDER = sql`case ${companies.priority} when 'A' then 0 when 'B' then 1 when 'C' then 2 else 3 end`;

/**
 * One tab of companies, best first: watched and paused by priority, discovered
 * by how many matching roles they list. A name search is typo-tolerant.
 */
export async function listCompanies(db: Db, f: { status: CompanyTab; q?: string; limit?: number }) {
  const { lastFetch, stats, activeApp } = companyFacts(db);

  const ofCompany = sql`from ${discoveredRoles} where ${discoveredRoles.companyId} = ${companies.id}`;
  const discoveredTitles = sql<number>`(select count(distinct lower(${ROLE_TITLE}))::int ${ofCompany})`;
  const isDiscovered = sql`${companies.status} = 'discovered'`;
  const q = f.q?.trim();

  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      ats: companies.ats,
      priority: companies.priority,
      status: companies.status,
      fetchStatus: lastFetch.status,
      openPostings: stats.open,
      leads: stats.leads,
      newestPostingAt: stats.newest,
      appStage: activeApp.stage,
      discoveredTitles: sql<number | null>`case when ${isDiscovered} then ${discoveredTitles} end`,
      sampleTitles: sql<string[] | null>`case when ${isDiscovered} then array(
        select min(${ROLE_TITLE}) ${ofCompany} group by lower(${ROLE_TITLE}) order by max(${discoveredRoles.firstSeen}) desc nulls last limit 3) end`,
      sampleLocations: sql<string[] | null>`case when ${isDiscovered} then array(
        select ${discoveredRoles.location} ${ofCompany} and ${discoveredRoles.location} is not null
        group by ${discoveredRoles.location} order by count(*) desc, ${discoveredRoles.location} limit 3) end`,
    })
    .from(companies)
    .leftJoinLateral(lastFetch, sql`true`)
    .leftJoinLateral(stats, sql`true`)
    .leftJoinLateral(activeApp, sql`true`)
    .where(and(eq(companies.status, f.status), q ? trigramMatch(companies.name, q) : undefined))
    .orderBy(
      ...(q ? [desc(trigramRank(companies.name, q))] : []),
      f.status === "discovered" ? sql`${discoveredTitles} desc` : PRIORITY_ORDER,
      asc(companies.name),
    )
    .limit(f.limit ?? COMPANY_LIST_LIMIT);

  const now = new Date();
  return rows.map(({ fetchStatus, appStage, ...r }) => {
    const row = {
      ...r,
      openPostings: r.openPostings ?? 0,
      leads: r.leads ?? 0,
      lastFetch: fetchStatus ? { status: fetchStatus } : null,
      inProcess: appStage,
    };
    return { ...row, health: healthOf(row, now) };
  });
}

/** Tab counts (narrowed by the name search, so they say where the matches are) and the watched companies whose feed is failing. */
export async function companiesSummary(db: Db, search: string | undefined) {
  const { lastFetch } = companyFacts(db);
  const q = search?.trim();
  const n = (cond: SQL) => sql<number>`(count(*) filter (where ${cond}))::int`;
  const match = q ? trigramMatch(companies.name, q) : sql`true`;
  const tab = (status: CompanyTab) => n(sql`${companies.status} = ${status} and ${match}`);
  const [[counts], failing] = await Promise.all([
    db.select({ active: tab("active"), paused: tab("paused"), discovered: tab("discovered") }).from(companies),
    db
      .select({ name: companies.name })
      .from(companies)
      .leftJoinLateral(lastFetch, sql`true`)
      .where(and(eq(companies.status, "active"), eq(lastFetch.status, "error")))
      .orderBy(asc(companies.name)),
  ]);
  return { counts: counts!, failing: failing.map((f) => f.name) };
}
