/** Changing what's on the watchlist. Watched = `companies.status = 'active'`: collected daily and shown in the queue. */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { companies } from "../db/schema.ts";

/**
 * Watch or stop watching a company. Only active ⇄ paused: a no-feed company
 * needs a feed first, a discovered one a promotion.
 */
export async function setWatched(db: Db, id: number, watched: boolean) {
  const [company] = await db.select({ name: companies.name, status: companies.status }).from(companies).where(eq(companies.id, id));
  if (!company) throw new Error(`No company with id ${id}`);
  if (company.status !== "active" && company.status !== "paused") {
    const how = company.status === "no_feed" ? "add its job-board URL" : "promote it";
    throw new Error(`${company.name} is ${company.status.replace("_", " ")}, not watched or paused; ${how} instead.`);
  }
  const status = watched ? "active" : "paused";
  await db.update(companies).set({ status }).where(eq(companies.id, id));
  return { status };
}

/** How much a company's roles matter: A first in every list, C last. */
export async function setPriority(db: Db, id: number, priority: "A" | "B" | "C") {
  const updated = await db.update(companies).set({ priority }).where(eq(companies.id, id)).returning({ id: companies.id });
  if (!updated.length) throw new Error(`No company with id ${id}`);
}

/** Move discovered companies onto the watchlist. Companies with another status are left alone. */
export async function promote(db: Db, ids: number[], opts: { notes?: string } = {}) {
  if (!ids.length) return [];
  return db
    .update(companies)
    .set({
      status: "active",
      priority: sql`coalesce(${companies.priority}, 'C')`,
      promotedAt: sql`now()`,
      ...(opts.notes ? { notes: opts.notes } : {}),
    })
    .where(and(eq(companies.status, "discovered"), inArray(companies.id, ids)))
    .returning({ id: companies.id, name: companies.name });
}
