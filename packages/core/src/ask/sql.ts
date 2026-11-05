/**
 * Ask's `sql` tool: a query the model wrote, run so it can only read. Three guards, each
 * enough on its own for the common case, together for the rest:
 *
 * 1. The connection is the read-only role (DATABASE_URL_READONLY, pg_read_all_data).
 * 2. A read-only transaction with a statement timeout, always rolled back.
 * 3. A prepared statement, which Postgres refuses to run with more than one command, and an
 *    outer LIMIT, so `select 1) x; delete …; select (1` can't smuggle a second statement in.
 */
import type { Db } from "../db/client.ts";

/**
 * The query as the one statement that runs: trailing semicolons and whitespace removed, wrapped
 * as `select * from (<query>) as q limit <maxRows + 1>` (one row over the cap tells it was cut).
 * The query goes on lines of its own, so a trailing `-- comment` can't swallow the closing
 * parenthesis. Throws on an empty query.
 */
export function limited(query: string, maxRows: number): string {
  const sanitizedQuery = query.replace(/[\s;]+$/, "");

  if (sanitizedQuery === "") {
    throw new Error("Empty query.");
  }

  return `select * from (\n${sanitizedQuery}\n) as q limit ${maxRows + 1}`;
}

/**
 * Runs `limited(query)` in a read-only transaction with `statement_timeout`, on the raw
 * postgres.js client (`db.$client`) as a prepared statement, and always rolls back. Returns at
 * most `maxRows` rows, and whether there were more.
 */
export async function runSql(
  db: Db,
  query: string,
  { maxRows = 50, timeoutMs = 5000 }: { maxRows?: number; timeoutMs?: number } = {},
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const text = limited(query, maxRows);

  let result: Record<string, unknown>[] = [];
  const ROLLBACK = new Error("rollback");

  try {
    await db.$client.begin("read only", async (tx) => {
      await tx`select set_config('statement_timeout', ${timeoutMs}, true)`;

      result = await tx`${tx.unsafe(text)}`;
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }

  return { rows: result.slice(0, maxRows), truncated: result.length > maxRows };
}
