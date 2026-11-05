/**
 * Fetch every active company's job board, save the engineering postings, then
 * screen all open postings with the current rules.
 *
 *   pnpm collect
 *   pnpm collect --only posthog     # one company, by name (case-insensitive)
 */
import { parseArgs } from "node:util";
import { runCollect } from "../collect/run.ts";
import { createDb } from "../db/client.ts";
import { funnel } from "../screen/funnel.ts";
import { screenOpenPostings } from "../screen/run.ts";

const { values } = parseArgs({ options: { only: { type: "string" } } });

const { db, close } = createDb();
try {
  const summary = await runCollect(db, values.only ? { only: values.only } : {});
  const { companies: c, postings: p } = summary;

  console.log(`Run #${summary.runId} finished in ${(summary.durationMs / 1000).toFixed(1)} s\n`);
  console.log(`Companies  ok ${c.ok} · error ${c.error} · unsupported ATS ${c.unsupported}`);
  console.log(`Postings   seen ${p.seen} · engineering kept ${p.kept}`);
  console.log(`Changes    new ${p.new} · text changed ${p.changed} · reopened ${p.reopened} · closed ${p.closed}`);

  const errors = summary.results.filter((r) => r.status === "error");
  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ${e.company}: ${e.error?.split("\n")[0]}`);
  }
  if (values.only && summary.results.length === 0) console.log(`\nNo company matches "${values.only}".`);

  await screenOpenPostings(db);
  const f = await funnel(db);
  console.log(`\nScreened  open ${f.open} → passed ${f.passed} → new ${f.byCategory.new} (details: pnpm screen --list)`);
} finally {
  await close();
}
