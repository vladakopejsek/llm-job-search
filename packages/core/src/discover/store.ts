import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { discoveredRoles } from "../db/schema.ts";

/** Store discovered roles, once per posting key; a role seen again moves to its latest company, title and sighting. */
export async function upsertDiscoveredRoles(db: Db, rows: (typeof discoveredRoles.$inferInsert)[]): Promise<number> {
  const unique = [...new Map(rows.map((r) => [r.postingKey, r])).values()];
  if (!unique.length) return 0;
  await db
    .insert(discoveredRoles)
    .values(unique)
    .onConflictDoUpdate({
      target: discoveredRoles.postingKey,
      set: {
        companyId: sql`excluded.company_id`,
        title: sql`excluded.title`,
        location: sql`excluded.location`,
        url: sql`excluded.url`,
        lastSeenInSnapshot: sql`excluded.last_seen_in_snapshot`,
      },
    });
  return unique.length;
}
