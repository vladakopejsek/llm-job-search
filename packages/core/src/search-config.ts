/**
 * Where the candidate lives, and what that makes relevant: which places count as home, where
 * they'd go to an office, which languages they speak, which local job boards to read. Read from
 * data/search.json (gitignored; start from seeds/search.example.json), or SEARCH_CONFIG_PATH.
 * Read once: the screen runs on every posting.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const Names = z.array(z.string().min(1));

const SearchConfig = z.strictObject({
  home: z.strictObject({
    /** How labels and reasons name it: "Portugal excluded". */
    country: z.string().min(1),
    /** Whole words, with or without diacritics: the country's names, its regions and towns, inflected forms. */
    places: Names.min(1),
    /** Names that must keep their diacritics, e.g. a short form that is something else without them. */
    exact: Names.default([]),
    /** ISO codes as ATSes write them ("Lisbon, PT", "PRT - Porto"), upper case. The first is sent to board APIs. */
    codes: z.array(z.string().regex(/^[A-Z]{2,3}$/)).min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  /** Where the candidate would go to an office. An office role anywhere else must be fully remote. */
  officeCities: Names,
  /** Spoken languages besides English. A role that requires any other is rejected. */
  languages: Names,
  /** Local words for "developer" in job titles, matched as word starts. */
  titleWords: Names.default([]),
  /** Workday boards are searched by country facet; these places also count as within reach in discovery. */
  workday: z.strictObject({ countries: Names.min(1), places: Names.default([]) }),
  /**
   * The candidate's prep folder (PROFILE_DIR), the richer source for prep packs next to the Answer bank. Only
   * `include`d files are citable (a path ending in "/" takes every .md in that folder), so notes that record
   * claims which didn't survive checking stay out. `alwaysRead` files go to every pack; `styleFile` holds voice samples.
   */
  profile: z.strictObject({ include: Names.default([]), alwaysRead: Names.default([]), styleFile: z.string().nullable().default(null) }).optional(),
});
export type SearchConfig = z.infer<typeof SearchConfig>;

let cached: SearchConfig | undefined;

export function searchConfig(): SearchConfig {
  if (cached) return cached;
  const file = path.resolve(REPO_ROOT, process.env.SEARCH_CONFIG_PATH ?? "data/search.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`No search config at ${file}: copy seeds/search.example.json to data/search.json and edit it.`);
  }
  const result = SearchConfig.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error(`Invalid search config ${file}:\n${z.prettifyError(result.error)}`);
  cached = result.data;
  return cached;
}
