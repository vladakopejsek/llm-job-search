/**
 * Ask's tools: read-only views of the search, over the queries the app already uses, plus
 * `sql` for anything they don't cover. Both runtimes run them through `runTool`: the API loop
 * (ask/api.ts) and the MCP server that `claude -p` talks to (ask/mcp-server.ts). The `db`
 * passed in is always the read-only connection.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { localDate } from "../lib/dates.ts";
import { strictSchema } from "../llm/client.ts";
import { postingDetail, searchPostings } from "../postings/queries.ts";
import { STATS_RANGES } from "../tracker/filters.ts";
import { applicationDetail, pipeline, statsInput } from "../tracker/queries.ts";
import { computeTrackerStats } from "../tracker/stats.ts";
import { runSql } from "./sql.ts";

const MAX_ROWS = 50;
const MAX_CHARS = 20_000;

interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: S;
  run: (db: Db, input: z.infer<S>) => Promise<unknown>;
}
const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;

/** Every table and its columns, enum columns with their values: what the model needs to write SQL. */
export function schemaSummary(): string {
  return Object.values(schema as Record<string, unknown>)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => {
      const { name, columns } = getTableConfig(t);
      const cols = columns.map((c) => `${c.name} ${c.enumValues?.length ? c.enumValues.join("|") : c.getSQLType()}`);
      return `${name}(${cols.join(", ")})`;
    })
    .join("\n");
}

/** Fixed, and in a fixed order: on the API they sit at the start of the cached prefix. */
export const TOOLS: Tool[] = [
  tool({
    name: "search_postings",
    description:
      "Search every collected job posting by words in its title, company or text; a company-name match ranks first. Returns up to 20: id, title, company, whether it's closed, the latest verdict and a snippet.",
    input: z.object({ q: z.string().describe("Words to search for: a company, a technology, a role.") }),
    run: (db, { q }) => searchPostings(db, q, 20),
  }),
  tool({
    name: "posting",
    description:
      "One posting in full: its text, the latest evaluation (verdict, reasons, fit score, the facts extracted with quotes), the prep pack, the application if there is one, and a pending re-evaluation.",
    input: z.object({ id: z.number().int().describe("The posting id.") }),
    // The long text last, so the cap cuts it rather than the application or the evaluation.
    run: async (db, { id }) => {
      const {
        posting: { text, ...posting },
        application,
        reevaluation,
        evaluation,
      } = await postingDetail(db, id);
      return { posting, application, reevaluation, evaluation, text };
    },
  }),
  tool({
    name: "applications",
    description:
      "Every application sent (leads, shortlisted and skipped postings aside), next step first: stage, channel, applied date, first response date, days waiting for a reply, next step, how far it got and whether the company replied. The optional search matches company and role, and the answers, cover letters and notes logged.",
    input: z.object({ q: z.string().optional().describe("Words to search for; leave out for all.") }),
    run: (db, { q }) => pipeline(db, q),
  }),
  tool({
    name: "application",
    description:
      "One application in full: its row, the company, the posting as it was when applied, the evaluation, the talking points from the prep pack, the timeline of events (stage changes, replies, notes) and what was sent.",
    input: z.object({ id: z.number().int().describe("The application id.") }),
    run: async (db, { id }) => {
      const detail = await applicationDetail(db, id);
      if (!detail) throw new Error(`application ${id} not found`);
      // The posting text last, so the cap cuts it rather than what was sent.
      const { postingText, ...rest } = detail;
      return { ...rest, postingText };
    },
  }),
  tool({
    name: "tracker_stats",
    description:
      "The Pipeline page's numbers for applications applied in a range (the last 30 or 90 days, or all): totals, the response rate, median days to the first reply, the funnel (applied, replied, screening, interviewing, offer), rejections by stage, weekly counts, and response rates broken down by channel, ATS, company source, fit score, remote scope, eligibility and cover letter. A reply is an email reply or a stage only the company can move to. Numbers only: the applications themselves come from `applications` or `sql`.",
    input: z.object({ range: z.enum(STATS_RANGES).describe("30d, 90d or all, by applied date.") }),
    run: async (db, { range }) => computeTrackerStats({ ...(await statsInput(db)), today: localDate(), range }),
  }),
  tool({
    name: "sql",
    description: `Run one read-only PostgreSQL SELECT, for anything the other tools don't answer. At most ${MAX_ROWS} rows come back: aggregate in SQL rather than fetching rows to count. The tables (enum columns list their values):\n\n${schemaSummary()}`,
    input: z.object({ query: z.string().describe("One SELECT statement, without a trailing semicolon.") }),
    run: (db, { query }) => runSql(db, query, { maxRows: MAX_ROWS }),
  }),
];

/** The tools as the Messages API takes them. The MCP server lists the same schemas. */
export const apiTools = (): Anthropic.Tool[] =>
  TOOLS.map((t) => ({ name: t.name, description: t.description, strict: true, input_schema: strictSchema(t.input) as Anthropic.Tool.InputSchema }));

export interface ToolResult {
  ok: boolean;
  /** What the model reads: the result as JSON, or the error. */
  content: string;
  rows?: number;
  truncated?: boolean;
  error?: string;
}

/** The one way a tool runs, on both runtimes: input checked by Zod, errors returned (not thrown) for the model to read. */
export async function runTool(db: Db, name: string, rawInput: unknown): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return failed(`Unknown tool ${name}.`);
  const input = t.input.safeParse(rawInput);
  if (!input.success) return failed(z.prettifyError(input.error));
  try {
    return capped(await t.run(db, input.data));
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

const failed = (error: string): ToolResult => ({ ok: false, content: error, error });

/**
 * A list keeps its first MAX_ROWS rows; anything longer than MAX_CHARS is cut there.
 * ponytail: the cut lands mid-JSON; trim long string fields instead if the model trips on it.
 */
export function capped(value: unknown): ToolResult {
  const list: unknown = Array.isArray(value) ? { rows: value.slice(0, MAX_ROWS), truncated: value.length > MAX_ROWS } : value;
  const rows = isList(list) ? list.rows.length : undefined;
  let truncated = isList(list) && list.truncated;
  let content = JSON.stringify(list);
  if (content.length > MAX_CHARS) {
    // toWellFormed: a cut through an emoji leaves half of it, which the API refuses.
    content = `${content.slice(0, MAX_CHARS).toWellFormed()}… [cut at ${MAX_CHARS} characters]`;
    truncated = true;
  }
  return { ok: true, content, rows, truncated };
}

const isList = (v: unknown): v is { rows: unknown[]; truncated: boolean } =>
  !!v && typeof v === "object" && Array.isArray((v as { rows?: unknown }).rows);
