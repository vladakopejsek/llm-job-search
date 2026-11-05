import { isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { evaluations, postings } from "../db/schema.ts";
import { screenPosting } from "./rules.ts";

const CHUNK = 500;

export interface ScreenSummary {
  screened: number;
  passed: number;
  rejectedByRule: Record<string, number>;
}

/**
 * Re-apply the rules to every open posting. The rules are pure functions and
 * cheap, so rather than tracking which rule version screened what, we simply
 * screen everything again whenever this runs: change a rule, rerun, done.
 */
export async function screenOpenPostings(db: Db): Promise<ScreenSummary> {
  const open = await db
    .select({
      id: postings.id,
      title: postings.title,
      locationRaw: postings.locationRaw,
      workplaceRaw: postings.workplaceRaw,
      descriptionText: postings.descriptionText,
    })
    .from(postings)
    .where(isNull(postings.closedAt));

  const summary: ScreenSummary = { screened: open.length, passed: 0, rejectedByRule: {} };
  const results = open.map((p) => {
    const result = screenPosting(p);
    if (result.pass) summary.passed++;
    else summary.rejectedByRule[result.rule] = (summary.rejectedByRule[result.rule] ?? 0) + 1;
    return {
      id: p.id,
      status: result.pass ? "pass" : "reject",
      rule: result.pass ? null : result.rule,
      reason: result.pass ? null : result.reason,
    };
  });

  // One UPDATE per chunk: the values travel as four array parameters and
  // unnest() turns them back into rows to join against. (sql.param keeps each
  // array a single parameter; a bare array would expand into a value list.)
  // Only rows whose result changed are written, so `screened_at` is when the
  // result last changed: rewriting every open posting each run bloats the table.
  for (let i = 0; i < results.length; i += CHUNK) {
    const chunk = results.slice(i, i + CHUNK);
    await db.execute(sql`
      update ${postings} set
        screen_status = v.status::screen_status,
        screen_rule = v.rule,
        screen_reason = v.reason,
        screened_at = now()
      from unnest(
        ${sql.param(chunk.map((r) => r.id))}::int[],
        ${sql.param(chunk.map((r) => r.status))}::text[],
        ${sql.param(chunk.map((r) => r.rule))}::text[],
        ${sql.param(chunk.map((r) => r.reason))}::text[]
      ) as v(id, status, rule, reason)
      where ${postings.id} = v.id
        and (${postings.screenStatus}, ${postings.screenRule}, ${postings.screenReason})
          is distinct from (v.status::screen_status, v.rule, v.reason)
    `);
  }

  // An audit evaluation read a posting the screen rejected. Once the screen passes it (a rule was
  // relaxed), the evaluation is a queue one: otherwise the posting never shows and is never read again.
  await db.execute(sql`
    update ${evaluations} set purpose = 'queue'
    from ${postings}
    where ${postings.id} = ${evaluations.postingId} and ${evaluations.purpose} = 'audit' and ${postings.screenStatus} = 'pass'
  `);

  return summary;
}
