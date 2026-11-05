import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { limited, runSql } from "./sql.ts";

describe("limited", () => {
  it("wraps the query with a limit one over the cap", () => {
    expect(limited("select id from postings", 50)).toMatch(/^select \* from \(\s*select id from postings\s*\) as q limit 51$/);
  });

  it("drops trailing semicolons and whitespace", () => {
    expect(limited("select 1;  \n", 10)).not.toContain(";");
    expect(limited("select 1 ;;", 10)).not.toContain(";");
  });

  it("keeps a trailing line comment from swallowing the closing parenthesis", () => {
    expect(limited("select 1 -- the answer", 10)).toMatch(/-- the answer\n\) as q limit 11$/);
  });

  it("refuses an empty query", () => {
    expect(() => limited("", 10)).toThrow();
    expect(() => limited(" ;\n", 10)).toThrow();
  });
});

// Postgres itself enforces the rest, so these run against the read-only role: DATABASE_URL_READONLY from
// the environment or .env (CI creates the role in a Postgres service). Without it they're skipped.
const url = process.env.DATABASE_URL_READONLY;

describe.skipIf(!url)("runSql on the read-only role", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(() => ({ db, close } = createDb(url)));
  afterAll(() => close());

  it("returns the rows, capped, and says when it cut them", async () => {
    expect(await runSql(db, "select generate_series(1, 3) as n", { maxRows: 5 })).toEqual({
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
      truncated: false,
    });
    const capped = await runSql(db, "select generate_series(1, 60) as n", { maxRows: 50 });
    expect(capped.rows).toHaveLength(50);
    expect(capped.truncated).toBe(true);
  });

  it("refuses a second statement smuggled past the wrapper", async () => {
    await expect(runSql(db, "select 1) as x; select 2; select * from (select 1")).rejects.toThrow(/multiple commands/);
  });

  it("refuses a write", async () => {
    await expect(runSql(db, "select lo_create(0)")).rejects.toThrow(/read-only transaction/);
  });

  it("stops a slow query", async () => {
    await expect(runSql(db, "select pg_sleep(2)", { timeoutMs: 100 })).rejects.toThrow(/statement timeout/);
  });
});
