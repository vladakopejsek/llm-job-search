/**
 * Maintain a watched company's feed, now that the database is the source of truth.
 *
 *   pnpm company feed "PostHog" https://jobs.ashbyhq.com/posthog
 *   pnpm company feed "everstox" https://jobs.career-everstox.com/jobs.rss --ats teamtailor   # custom domain
 *   pnpm company no-feed "Unleash" https://www.getunleash.io/careers                            # jobs only on its own site
 */
import { parseArgs } from "node:util";
import { ilike } from "drizzle-orm";
import { ATS_TYPES, type Ats } from "../ats/index.ts";
import { createDb } from "../db/client.ts";
import { companies } from "../db/schema.ts";
import { checkAndSetFeed, FeedCheckError, setNoFeed } from "../watchlist/feed.ts";

const { values, positionals } = parseArgs({ options: { ats: { type: "string" } }, allowPositionals: true });
const [command, name, url] = positionals;

async function main(): Promise<number> {
  if (!command || !name || !url || !["feed", "no-feed"].includes(command)) {
    console.log('Usage: pnpm company feed "<name>" <feed or board URL> [--ats teamtailor]\n       pnpm company no-feed "<name>" <careers page URL>');
    return 1;
  }
  const hint = values.ats as Ats | undefined;
  if (hint && !(ATS_TYPES as readonly string[]).includes(hint)) {
    console.log(`Unknown ATS "${hint}". Known: ${ATS_TYPES.join(", ")}`);
    return 1;
  }

  const { db, close } = createDb();
  try {
    const matches = await db.select().from(companies).where(ilike(companies.name, name));
    if (matches.length !== 1) {
      console.log(matches.length ? `"${name}" matches ${matches.length} companies; use the exact name.` : `No company named "${name}".`);
      return 1;
    }
    const company = matches[0]!;

    if (command === "no-feed") {
      await setNoFeed(db, company.id, url);
      console.log(`${company.name}: no feed; careers page ${url}. It won't be collected.`);
      return 0;
    }

    const board = await checkAndSetFeed(db, company.id, url, hint);
    console.log(`${company.name}: now ${board.ats} "${board.token}" (${board.postingsOnBoard} postings on the board). Collected from the next run.`);
    return 0;
  } catch (error) {
    if (error instanceof FeedCheckError) {
      console.log(error.reason === "unreadable" ? `${error.message} For a board on a company's own domain, pass --ats.` : error.message);
      return 1;
    }
    console.log(`Board check failed, nothing saved: ${error instanceof Error ? error.message : error}`);
    return 1;
  } finally {
    await close();
  }
}

process.exitCode = await main();
