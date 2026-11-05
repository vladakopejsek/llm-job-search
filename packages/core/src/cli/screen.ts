/**
 * Re-screen all open postings with the current rules and print the funnel.
 * Also checks the rules against the earlier pipeline's verdicts.
 *
 *   pnpm screen
 *   pnpm screen --list     # also list the new roles
 */
import { parseArgs } from "node:util";
import { createDb } from "../db/client.ts";
import { funnel, priorVerdictMatches } from "../screen/funnel.ts";
import { screenOpenPostings } from "../screen/run.ts";

const { values } = parseArgs({ options: { list: { type: "boolean" } } });
const { db, close } = createDb();
try {
  const screened = await screenOpenPostings(db);
  console.log(`Screened ${screened.screened} open postings: ${screened.passed} passed\n`);
  console.log("Rejected by rule:");
  for (const [rule, n] of Object.entries(screened.rejectedByRule).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule.padEnd(34)} ${n}`);
  }

  const f = await funnel(db);
  const c = f.byCategory;
  console.log(`\nFunnel (open postings of active companies)`);
  console.log(`  open ${f.open} → screened out ${f.screenedOut} → passed ${f.passed}, of which:`);
  console.log(`    already in your tracker          ${c.tracked}`);
  console.log(`    company rejected you             ${c.company_rejected}`);
  console.log(`    other roles at companies you've contacted  ${c.company_in_process}`);
  console.log(`    judged by the old pipeline       ${c.judged}`);
  console.log(`    NEW                              ${c.new}`);

  if (values.list) {
    const shown = f.postings
      .filter((p) => p.triage.category === "new" || p.triage.category === "company_in_process")
      .sort((a, b) => (a.priority ?? "Z").localeCompare(b.priority ?? "Z") || a.companyName.localeCompare(b.companyName));
    console.log(`\nNew roles and roles at companies you've contacted (${shown.length}):`);
    for (const p of shown) {
      const note = p.triage.detail ? `  [${p.triage.detail}]` : "";
      console.log(`  ${p.priority ?? "-"}  ${p.companyName}: ${p.title} | ${p.location ?? "?"}${note}\n       ${p.url}`);
    }
  }

  // The rules must not throw away roles the old pipeline thought were worth applying to.
  const matches = await priorVerdictMatches(db);
  const positives = matches.filter((m) => m.priorVerdict === "lead" || m.priorVerdict === "follow_up");
  const lost = positives.filter((m) => m.screenStatus === "reject");
  console.log(`\nCheck against old verdicts: ${matches.length} open postings were judged before, ${positives.length} as Lead/Follow-up.`);
  console.log(`  Lead/Follow-up now screened out: ${lost.length}`);
  for (const m of lost) console.log(`    ${m.company}: ${m.title} (${m.location}) — screen: ${m.screenReason}`);
} finally {
  await close();
}
