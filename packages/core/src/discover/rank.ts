import { and, eq, notLike } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { applications, companies, discoveredRoles } from "../db/schema.ts";
import { companyKeys } from "../screen/company-key.ts";
import { namesHome } from "../screen/rules.ts";
import { BOARD_SOURCES } from "./boards/sources.ts";

export interface RankedCompany {
  name: string;
  ats: string;
  /** Distinct role titles; one role listed in five cities counts once. */
  titles: { title: string; locations: string[] }[];
  namesHome: boolean;
  newestRole: Date | null;
  trackerStages: string[];
}

/**
 * One role posted once per city often repeats the city in the title
 * ("Senior Engineer - Aarhus, Denmark"). Drop a title suffix that is the
 * role's own location, and anything in parentheses, before comparing.
 */
export function titleKey(title: string, location: string | null): string {
  let t = title.toLowerCase().replace(/\s+/g, " ").trim();
  const loc = location?.toLowerCase().trim();
  if (loc) {
    for (const sep of [" - ", " – ", " — ", ", "]) {
      if (t.endsWith(sep + loc)) t = t.slice(0, -(sep + loc).length);
    }
  }
  return t
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Discovered companies, most promising first: a role that names the home country, then
 * the number of distinct matching roles, then how recently one appeared. Only the snapshot's
 * roles count: a job board's are promoted by its own scan, and only when the board is confirmed
 * (discover/boards/run.ts), while one matched by name might be another company's board.
 */
export async function rankDiscovered(db: Db): Promise<RankedCompany[]> {
  const rows = await db
    .select({
      company: companies.name,
      ats: companies.ats,
      title: discoveredRoles.title,
      location: discoveredRoles.location,
      firstSeen: discoveredRoles.firstSeen,
    })
    .from(discoveredRoles)
    .innerJoin(companies, eq(companies.id, discoveredRoles.companyId))
    .where(and(eq(companies.status, "discovered"), ...BOARD_SOURCES.map((s) => notLike(discoveredRoles.postingKey, `${s.name}:%`))));

  const tracker = await db.select({ company: applications.company, stage: applications.stage }).from(applications);
  const stagesByKey = new Map<string, Set<string>>();
  for (const a of tracker) {
    for (const k of companyKeys(a.company)) stagesByKey.set(k, (stagesByKey.get(k) ?? new Set()).add(a.stage));
  }

  const byCompany = new Map<string, RankedCompany & { titleMap: Map<string, { title: string; locations: string[] }> }>();
  for (const r of rows) {
    const entry = byCompany.get(r.company) ?? {
      name: r.company,
      ats: r.ats,
      titles: [],
      titleMap: new Map(),
      namesHome: false,
      newestRole: null,
      trackerStages: [...new Set(companyKeys(r.company).flatMap((k) => [...(stagesByKey.get(k) ?? [])]))],
    };
    const key = titleKey(r.title, r.location);
    const t = entry.titleMap.get(key) ?? { title: r.title, locations: [] };
    if (r.location) t.locations.push(r.location);
    entry.titleMap.set(key, t);
    entry.namesHome ||= namesHome(r.location);
    if (r.firstSeen && (!entry.newestRole || r.firstSeen > entry.newestRole)) entry.newestRole = r.firstSeen;
    byCompany.set(r.company, entry);
  }

  return [...byCompany.values()]
    .map(({ titleMap, ...c }) => ({ ...c, titles: [...titleMap.values()] }))
    .sort(
      (a, b) =>
        Number(b.namesHome) - Number(a.namesHome) ||
        b.titles.length - a.titles.length ||
        (b.newestRole?.getTime() ?? 0) - (a.newestRole?.getTime() ?? 0),
    );
}
