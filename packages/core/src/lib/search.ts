/**
 * Full-text search helpers over the generated `search` tsvector columns.
 *
 * websearch_to_tsquery accepts what people type into search boxes: plain words
 * (all must match), "quoted phrases", `or`, and -excluded words. It never throws
 * on odd input, unlike to_tsquery. The 'english' config stems words, so
 * "engineers" matches "engineer".
 */
import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { HL_END, HL_START } from "./highlight.ts";

const tsQuery = (q: string) => sql`websearch_to_tsquery('english', ${q})`;

export const tsMatch = (vector: SQLWrapper, q: string) => sql`${vector} @@ ${tsQuery(q)}`;

export const tsRank = (vector: SQLWrapper, q: string) => sql<number>`ts_rank(${vector}, ${tsQuery(q)})`;

/**
 * A snippet of `text` around the matches, with hits wrapped in HL_START/HL_END.
 * ts_headline re-parses the whole text, so call it only for the rows on the
 * current page, never in a WHERE clause.
 */
export function headline(text: SQLWrapper, q: string, opts: { maxFragments?: number; maxWords?: number; minWords?: number } = {}): SQL<string> {
  const options = [
    `StartSel=${HL_START}`,
    `StopSel=${HL_END}`,
    `MaxFragments=${opts.maxFragments ?? 2}`,
    `MaxWords=${opts.maxWords ?? 18}`,
    `MinWords=${opts.minWords ?? 6}`,
    'FragmentDelimiter=" … "',
  ].join(", ");
  return sql<string>`ts_headline('english', ${text}, ${tsQuery(q)}, ${options})`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * Name search that tolerates partial words and small typos: a substring match
 * ("contentf" → Contentful) or pg_trgm similarity ("contenful" → Contentful).
 * Both use the companies_name_trgm_idx GIN index.
 */
export const trigramMatch = (column: SQLWrapper, q: string) => sql`(${column} ilike ${`%${escapeLike(q)}%`} or ${column} % ${q})`;

export const trigramRank = (column: SQLWrapper, q: string) => sql<number>`similarity(${column}, ${q})`;
