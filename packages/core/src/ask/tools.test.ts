import { describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { apiTools, capped, runTool, schemaSummary } from "./tools.ts";

describe("Ask tools", () => {
  it("cap a list at 50 rows and say so", () => {
    const result = capped(Array.from({ length: 60 }, (_, i) => ({ i })));
    expect(result).toMatchObject({ ok: true, rows: 50, truncated: true });
    expect(JSON.parse(result.content).rows).toHaveLength(50);
    expect(capped([{ i: 1 }])).toMatchObject({ rows: 1, truncated: false });
  });

  it("cut a long result at 20k characters", () => {
    const result = capped({ text: "x".repeat(30_000) });
    expect(result.truncated).toBe(true);
    expect(result.content).toMatch(/cut at 20000 characters\]$/);
  });

  it("return a bad call as an error for the model, without touching the database", async () => {
    const db = {} as Db;
    expect(await runTool(db, "drop_tables", {})).toMatchObject({ ok: false, error: "Unknown tool drop_tables." });
    expect(await runTool(db, "posting", { id: "12" })).toMatchObject({ ok: false });
    expect(await runTool(db, "tracker_stats", { range: "7d" })).toMatchObject({ ok: false });
  });

  it("describe every table to the sql tool, enum values included", () => {
    expect(schemaSummary()).toMatch(/^applications\(.*stage lead\|shortlisted\|applied/m);
    expect(apiTools().map((t) => t.name)).toEqual(["search_postings", "posting", "applications", "application", "tracker_stats", "sql"]);
  });
});
