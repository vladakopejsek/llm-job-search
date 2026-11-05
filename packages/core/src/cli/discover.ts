/**
 * Find companies worth watching in the job-board-aggregator daily snapshot.
 *
 *   pnpm discover                       # download the snapshot, store discoveries, print the top
 *   pnpm discover --list [--top 50]     # print from the database, no download
 *   pnpm discover --promote vercel posthog   # move companies to the watchlist (status active)
 *   pnpm discover --auto-promote             # download, then promote the strongest matches; at most once a week (used by /daily-run)
 *   pnpm discover --boards [--auto-promote] [--daily]  # scan whole job boards instead (before each collect;
 *                                                      # --daily adds boards that change once a day)
 */
import { parseArgs } from "node:util";
import { createDb } from "../db/client.ts";
import { discoverOnBoard } from "../discover/boards/run.ts";
import { BOARD_SOURCES } from "../discover/boards/sources.ts";
import { rankDiscovered } from "../discover/rank.ts";
import { autoPromote, type DiscoverSummary, discoveredIds, runDiscover } from "../discover/run.ts";
import { searchConfig } from "../search-config.ts";
import { promote } from "../watchlist/actions.ts";

const { values, positionals } = parseArgs({
  options: {
    list: { type: "boolean" },
    promote: { type: "boolean" },
    "auto-promote": { type: "boolean" },
    boards: { type: "boolean" },
    daily: { type: "boolean" },
    top: { type: "string", default: "30" },
  },
  allowPositionals: true,
});

const BOARD_AUTO_PROMOTE_MAX = 25;

const { db, close } = createDb();

function printSummary(s: DiscoverSummary) {
  console.log(`Snapshot: ${s.snapshotJobs.toLocaleString()} jobs (${s.invalid} unreadable)`);
  console.log(
    `Kept: ${s.kept} software roles on Ashby/Greenhouse/Lever/BambooHR (Workday: in the search config's countries) with a European or remote location`,
  );
  console.log(`  at companies you already watch: ${s.atWatchedCompanies}`);
  console.log(`  at companies that rejected you: ${s.atRejectingCompanies}`);
  console.log(`Stored: ${s.roles} roles at ${s.companies} discovered companies (${s.staleRemoved} stale roles removed)\n`);
}

try {
  if (values.promote) {
    if (!positionals.length) throw new Error("Name the companies to promote, e.g. --promote vercel posthog");
    const promoted = await promote(db, await discoveredIds(db, positionals));
    console.log(`Promoted ${promoted.length}: ${promoted.map((p) => p.name).join(", ") || "none"}`);
    const missing = positionals.filter((n) => !promoted.some((p) => p.name === n));
    if (missing.length) console.log(`Not found among discovered companies: ${missing.join(", ")}`);
    if (promoted.length) console.log("They'll be collected and screened on the next `pnpm collect`.");
  } else if (values.boards) {
    const strong = new Map<number, { name: string; title: string }>();
    const { codes } = searchConfig().home;
    for (const source of BOARD_SOURCES.filter((s) => (values.daily || !s.daily) && (!s.country || codes.includes(s.country)))) {
      try {
        const s = await discoverOnBoard(db, source);
        console.log(`${s.source}: ${s.listed} listed, ${s.read} read, ${s.matched} software roles that pass the screen`);
        console.log(`  at companies already on the list: ${s.atKnownCompanies} · at companies that rejected you: ${s.atRejectingCompanies}`);
        if (s.uncollectable) console.log(`  apply link not on an ATS we collect: ${s.uncollectable}`);
        if (s.lookedUp) {
          const none = s.noBoard.length ? `; none for ${s.noBoard.join(", ")} (saved as no feed)` : "";
          const byName = s.byNameOnly.length ? `; by name only, to promote by hand: ${s.byNameOnly.join(", ")}` : "";
          console.log(`  looked up on our ATSs: ${s.lookedUp}${none}${byName}`);
        }
        console.log(`  stored: ${s.roles} roles at ${s.companies} discovered companies (${s.staleRemoved} no longer listed)`);
        for (const e of s.errors.slice(0, 5)) console.log(`  error: ${e}`);
        for (const c of s.strong) strong.set(c.id, c);
      } catch (error) {
        console.log(`${source.label}: failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
    const named = [...strong.entries()].map(([id, c]) => ({ id, ...c }));
    if (values["auto-promote"]) {
      // A board gives the description, so naming the stack is evidence enough; the cap keeps one run from flooding the list.
      const promoted = await promote(
        db,
        named.slice(0, BOARD_AUTO_PROMOTE_MAX).map((c) => c.id),
      );
      console.log(`\nAuto-promoted ${promoted.length}: ${promoted.map((p) => `${p.name} (${strong.get(p.id)?.title})`).join(", ") || "none"}`);
    } else if (named.length) {
      console.log(`\nName your stack: ${named.map((c) => `${c.name} (${c.title})`).join(", ")}`);
      console.log("Promote with: pnpm discover --promote <name> [<name>…], or run with --auto-promote");
    }
  } else {
    if (values["auto-promote"]) {
      const result = await autoPromote(db);
      if (!result) console.log("Auto-promoted within the last 6 days: nothing downloaded.\n");
      else {
        printSummary(result.summary);
        console.log(`Auto-promoted ${result.promoted.length}: ${result.promoted.join(", ") || "none"}\n`);
      }
    } else if (!values.list) printSummary(await runDiscover(db));

    const ranked = await rankDiscovered(db);
    const top = ranked.slice(0, Number(values.top));
    console.log(`Top ${top.length} of ${ranked.length} discovered companies:\n`);
    for (const c of top) {
      const flags = [
        c.namesHome ? `names ${searchConfig().home.country}` : "",
        c.trackerStages.length ? `tracker: ${c.trackerStages.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const age = c.newestRole ? `${Math.round((Date.now() - c.newestRole.getTime()) / 864e5)}d` : "?";
      console.log(`${c.name} [${c.ats}] — ${c.titles.length} roles, newest ${age}${flags ? ` — ${flags}` : ""}`);
      for (const t of c.titles.slice(0, 3)) {
        const locations = [...new Set(t.locations)];
        const where = locations.slice(0, 3).join(" | ") + (locations.length > 3 ? ` +${locations.length - 3}` : "");
        console.log(`    ${t.title} (${where})`);
      }
    }
    console.log(`\nPromote with: pnpm discover --promote <name> [<name>…]`);
  }
} finally {
  await close();
}
