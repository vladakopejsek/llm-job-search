/**
 * Read and store the application forms of current leads, so prep packs answer
 * the questions the form will actually ask. Runs at the start of `prep-next`:
 * a handful of requests a day, one per lead, refreshed every few days.
 */
import { eq, inArray, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { fetchApplicationForm } from "../ats/forms.ts";
import type { Db } from "../db/client.ts";
import { companies, postings } from "../db/schema.ts";

export async function refreshForms(db: Db, postingIds: number[]) {
  if (!postingIds.length) return { read: 0, unsupported: 0, failed: [] as string[] };
  const rows = await db
    .select({
      id: postings.id,
      externalId: postings.externalId,
      company: companies.name,
      ats: companies.ats,
      boardToken: companies.boardToken,
      boardHost: companies.boardHost,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(inArray(postings.id, postingIds));

  let read = 0;
  let unsupported = 0;
  const failed: string[] = [];
  const limit = pLimit(4);
  await Promise.all(
    rows.map((r) =>
      limit(async () => {
        try {
          const form = await fetchApplicationForm(r, r.externalId);
          if (form) read++;
          else unsupported++;
          // null means "this board's form can't be read": the pack then writes a cover letter to be safe.
          await db.update(postings).set({ applicationForm: form, applicationFormFetchedAt: sql`now()` }).where(eq(postings.id, r.id));
        } catch (error) {
          failed.push(`${r.company} (posting ${r.id}): ${(error as Error).message}`);
        }
      }),
    ),
  );
  return { read, unsupported, failed };
}
