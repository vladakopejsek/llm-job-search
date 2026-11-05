import { and, eq, inArray, lt, notLike, sql } from "drizzle-orm";
import { parseFeedUrl } from "../ats/feed-url.ts";
import type { Db } from "../db/client.ts";
import { applications, companies, discoveredRoles } from "../db/schema.ts";
import { companyKeys } from "../screen/company-key.ts";
import { postingKeyFromUrl } from "../screen/posting-key.ts";
import { promote } from "../watchlist/actions.ts";
import { BOARD_SOURCES } from "./boards/sources.ts";
import { isDiscoverable } from "./filter.ts";
import { rankDiscovered } from "./rank.ts";
import { type SnapshotJob, scanSnapshot } from "./snapshot.ts";
import { upsertDiscoveredRoles } from "./store.ts";

export interface DiscoverSummary {
  snapshotJobs: number;
  invalid: number;
  kept: number;
  atWatchedCompanies: number;
  atRejectingCompanies: number;
  companies: number;
  roles: number;
  staleRemoved: number;
}

const boardId = (ats: string, token: string) => `${ats}:${token.toLowerCase()}`;

/**
 * Scan the aggregator snapshot for roles at companies we don't watch yet, and
 * store them as "discovered" companies with their roles. Nothing is collected
 * for them until they're promoted to active.
 */
export async function runDiscover(db: Db): Promise<DiscoverSummary> {
  const runStart = new Date();
  const scan = await scanSnapshot(isDiscoverable);

  const known = await db
    .select({ id: companies.id, name: companies.name, ats: companies.ats, token: companies.boardToken, status: companies.status })
    .from(companies);
  const byBoard = new Map(known.filter((c) => c.token).map((c) => [boardId(c.ats, c.token!), c]));
  const takenNames = new Set(known.map((c) => c.name.toLowerCase()));

  const rejectedKeys = new Set(
    (await db.select({ company: applications.company }).from(applications).where(eq(applications.stage, "rejected"))).flatMap((a) =>
      companyKeys(a.company),
    ),
  );

  const summary: DiscoverSummary = {
    snapshotJobs: scan.total,
    invalid: scan.invalid,
    kept: scan.kept.length,
    atWatchedCompanies: 0,
    atRejectingCompanies: 0,
    companies: 0,
    roles: 0,
    staleRemoved: 0,
  };

  // Group the kept roles by board.
  const groups = new Map<string, { board: NonNullable<ReturnType<typeof parseFeedUrl>>; slug: string; jobs: SnapshotJob[] }>();
  for (const job of scan.kept) {
    const board = parseFeedUrl(job.url);
    if (!board) continue;
    const id = boardId(board.ats, board.token);
    const existing = byBoard.get(id);
    if (existing && existing.status !== "discovered") {
      summary.atWatchedCompanies++;
      continue;
    }
    if ([...companyKeys(job.company), ...companyKeys(board.token)].some((k) => rejectedKeys.has(k))) {
      summary.atRejectingCompanies++;
      continue;
    }
    const group = groups.get(id) ?? { board, slug: job.company, jobs: [] };
    group.jobs.push(job);
    groups.set(id, group);
  }

  for (const [id, group] of groups) {
    let company = byBoard.get(id);
    if (!company) {
      // The snapshot names companies by slug; avoid clashing with an existing name.
      let name = group.slug;
      if (takenNames.has(name.toLowerCase())) name = `${group.slug} (${group.board.ats})`;
      const [inserted] = await db
        .insert(companies)
        .values({
          name,
          ats: group.board.ats,
          boardToken: group.board.token,
          boardHost: group.board.host,
          feedUrl: group.jobs[0]?.url ?? null,
          status: "discovered",
          source: "discovery",
          notes: "Found in the job-board-aggregator snapshot",
        })
        .onConflictDoNothing()
        .returning({ id: companies.id, name: companies.name, ats: companies.ats, token: companies.boardToken, status: companies.status });
      if (!inserted) continue;
      company = inserted;
      takenNames.add(name.toLowerCase());
    }
    summary.companies++;

    const rows = group.jobs.flatMap((job) => {
      const postingKey = postingKeyFromUrl(job.url);
      if (!postingKey) return [];
      return [
        {
          companyId: company!.id,
          postingKey,
          title: job.title.trim(),
          location: job.location ?? null,
          url: job.url,
          firstSeen: job.first_seen ? new Date(job.first_seen) : null,
          lastSeenInSnapshot: runStart,
        },
      ];
    });
    summary.roles += await upsertDiscoveredRoles(db, rows);
  }

  // Roles no longer in the snapshot are gone; keep the table a picture of today.
  // Roles found on job boards are theirs to clean up (discover/boards/run.ts).
  // An empty read is a failed snapshot, not an empty market, so it removes nothing.
  const discoveredIds = (await db.select({ id: companies.id }).from(companies).where(eq(companies.status, "discovered"))).map((c) => c.id);
  if (discoveredIds.length && summary.roles) {
    const stale = await db
      .delete(discoveredRoles)
      .where(
        and(
          inArray(discoveredRoles.companyId, discoveredIds),
          lt(discoveredRoles.lastSeenInSnapshot, runStart),
          ...BOARD_SOURCES.map((s) => notLike(discoveredRoles.postingKey, `${s.name}:%`)),
        ),
      )
      .returning({ id: discoveredRoles.id });
    summary.staleRemoved = stale.length;
  }

  return summary;
}

const AUTO_PROMOTE_NOTE = "Auto-promoted from the aggregator snapshot";
const AUTO_PROMOTE_MAX = 15;

/**
 * Discover, then move the strongest new companies onto the watchlist: those with a role
 * that names the home country, or with several matching roles. At most 15, and at most once a
 * week: null (nothing downloaded) when an auto-promotion happened in the last 6 days,
 * so reruns and backfills can't flood the watchlist. Skipping a role as "company" in
 * the queue pauses a company again.
 */
export async function autoPromote(db: Db): Promise<{ summary: DiscoverSummary; promoted: string[] } | null> {
  const [recent] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.notes, AUTO_PROMOTE_NOTE), sql`${companies.promotedAt} > now() - interval '6 days'`))
    .limit(1);
  if (recent) return null;
  const summary = await runDiscover(db);
  const picks = (await rankDiscovered(db))
    .filter((c) => c.namesHome || c.titles.length >= 2)
    .slice(0, AUTO_PROMOTE_MAX)
    .map((c) => c.name);
  const promoted = await promote(db, await discoveredIds(db, picks), { notes: AUTO_PROMOTE_NOTE });
  return { summary, promoted: promoted.map((p) => p.name) };
}

/** Ids of the discovered (not yet watched) companies with these names. */
export async function discoveredIds(db: Db, names: string[]): Promise<number[]> {
  if (!names.length) return [];
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.status, "discovered"), inArray(companies.name, names)));
  return rows.map((c) => c.id);
}
