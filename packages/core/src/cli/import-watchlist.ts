/**
 * Load companies from a watchlist JSON file (exported from Notion) into the database.
 *
 *   pnpm import:watchlist                              # data/watchlist.json
 *   pnpm import:watchlist seeds/demo-companies.json
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ATS_TYPES, type Ats, collectorFor, parseFeedUrl } from "../ats/index.ts";
import { createDb } from "../db/client.ts";
import { companies } from "../db/schema.ts";
import { notionPlainText } from "../lib/text.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

const Row = z.object({
  company: z.string(),
  ats: z.string().nullable(),
  feedUrl: z.string().nullable(),
  boardUrl: z.string().nullable(),
  priority: z.enum(["A", "B", "C"]).nullable(),
  status: z.enum(["Active", "No feed", "Paused"]).nullable(),
  notes: z.string().nullable(),
  notionUrl: z.string().nullable().optional(),
});

const STATUS = { Active: "active", "No feed": "no_feed", Paused: "paused" } as const;

function atsFromLabel(label: string | null): Ats {
  const ats = (label ?? "none").toLowerCase();
  return (ATS_TYPES as readonly string[]).includes(ats) ? (ats as Ats) : "other";
}

async function main() {
  const file = path.resolve(process.env.INIT_CWD ?? REPO_ROOT, process.argv[2] ?? path.join(REPO_ROOT, "data/watchlist.json"));
  const rows = z.array(Row).parse(JSON.parse(await readFile(file, "utf8")));

  const records = rows.map((row) => {
    const labelled = atsFromLabel(row.ats);
    // The feed URL is the source of truth for the ATS; the Notion label can be stale.
    const board = parseFeedUrl(row.feedUrl, labelled) ?? parseFeedUrl(row.boardUrl, labelled);
    return {
      name: notionPlainText(row.company),
      ats: board?.ats ?? labelled,
      boardToken: board?.token ?? null,
      boardHost: board?.host ?? null,
      feedUrl: row.feedUrl,
      boardUrl: row.boardUrl,
      priority: row.priority,
      status: row.status ? STATUS[row.status] : ("paused" as const),
      notes: row.notes ? notionPlainText(row.notes) : null,
      notionUrl: row.notionUrl ?? null,
      // Only on insert: a company that came another way keeps its source.
      source: "import",
      labelMismatch: board !== null && board.ats !== labelled,
      unparsedFeed: board === null && collectorFor(labelled) !== undefined && row.status === "Active",
    };
  });

  const { db, close } = createDb();
  try {
    for (const { labelMismatch: _, unparsedFeed: __, ...record } of records) {
      await db
        .insert(companies)
        .values(record)
        .onConflictDoUpdate({
          target: companies.name,
          set: {
            ats: sql`excluded.ats`,
            boardToken: sql`excluded.board_token`,
            boardHost: sql`excluded.board_host`,
            feedUrl: sql`excluded.feed_url`,
            boardUrl: sql`excluded.board_url`,
            priority: sql`excluded.priority`,
            status: sql`excluded.status`,
            notes: sql`excluded.notes`,
            notionUrl: sql`excluded.notion_url`,
          },
        });
    }
  } finally {
    await close();
  }

  const count = (pick: (r: (typeof records)[number]) => string) =>
    Object.fromEntries(Object.entries(Object.groupBy(records, pick)).map(([key, group]) => [key, group?.length ?? 0]));

  console.log(`Imported ${records.length} companies from ${path.relative(REPO_ROOT, file)}\n`);
  console.log(
    "By status:",
    count((r) => r.status),
  );
  console.log(
    "By ATS:   ",
    count((r) => r.ats),
  );
  console.log("Collectable now (active + supported board):", records.filter((r) => r.status === "active" && r.boardToken).length);
  const mismatches = records.filter((r) => r.labelMismatch);
  if (mismatches.length) console.log(`\nATS label differs from the feed URL (feed URL used): ${mismatches.map((r) => r.name).join(", ")}`);
  const unparsed = records.filter((r) => r.unparsedFeed);
  if (unparsed.length) console.log(`\nActive, on a supported ATS, but no usable feed URL: ${unparsed.map((r) => r.name).join(", ")}`);
}

await main();
