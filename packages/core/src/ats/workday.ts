import { z } from "zod";
import { isEngineeringTitle } from "../collect/filter.ts";
import { fetchJson } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { placeNames } from "../screen/rules.ts";
import { type SearchConfig, searchConfig } from "../search-config.ts";
import { parseResponse } from "./parse.ts";
import { type Board, type Collector, CollectorError, type NormalizedPosting } from "./types.ts";

/**
 * Workday career sites read their jobs from a JSON API on the same host:
 * POST /wday/cxs/<tenant>/<site>/jobs searches (20 jobs a page, with facets),
 * and GET /wday/cxs/<tenant>/<site>/job/<location>/<posting> is one job with
 * its description. robots.txt on the career-site hosts disallows /refreshFacet/
 * and, for some tenants, the site's own pages (ABB, ESET), but not /wday/.
 *
 * Unlike the other collectors, this one filters, for scale: Workday tenants are
 * big employers (Thermo Fisher lists about 3,000 jobs, ABB and Thales 2,000
 * each), and a job's description is one request. So it reads only the jobs in
 * the search config's Workday countries, by the location facet the site's own search
 * offers, and fetches descriptions only for titles collect keeps (isEngineeringTitle).
 * The other jobs in those countries still come back, from the search
 * alone, so collect sees them as listed and doesn't close them. A remote role
 * filed under another country isn't seen.
 */

const PAGE = 20; // the most the search returns; it answers 400 to more

interface FacetGroup {
  facetParameter: string;
  descriptor?: string;
  values: (FacetGroup | FacetValue)[];
}
const FacetValue = z.object({ descriptor: z.string(), id: z.string(), count: z.number().optional() });
type FacetValue = z.infer<typeof FacetValue>;
// Location facets come nested: { facetParameter: "locationMainGroup", values: [<Country facet>, <Locations facet>] }.
const FacetGroup: z.ZodType<FacetGroup> = z.object({
  facetParameter: z.string(),
  descriptor: z.string().optional(),
  get values() {
    return z.array(z.union([FacetGroup, FacetValue]));
  },
});

const WorkdaySearch = z.object({
  /** Set on the first page only; later pages say 0. */
  total: z.number(),
  jobPostings: z.array(z.unknown()),
  /** Also first page only. */
  facets: z.array(FacetGroup).optional(),
});

const WorkdayListing = z.object({
  title: z.string(),
  /** "/job/Lisbon/AI-Enablement-Software-Engineer_JR-06088"; the last part is the posting's id. */
  externalPath: z.string(),
  /** "Lisbon", or "2 Locations" when there are more. */
  locationsText: z.string().optional(),
  remoteType: z.string().optional(),
});

const WorkdayJob = z.object({
  jobPostingInfo: z.object({
    title: z.string(),
    jobDescription: z.string().optional(),
    location: z.string().optional(),
    additionalLocations: z.array(z.string()).optional(),
    country: z.object({ descriptor: z.string() }).optional(),
    remoteType: z.string().optional(),
    /** "2026-10-23", the day the posting went up. (postedOn is "Posted 3 Days Ago".) */
    startDate: z.string().optional(),
    externalUrl: z.string().optional(),
  }),
});

// Facet values are each tenant's own names. A country facet says "Portugal"; a
// locations facet says "Porto, Portugal", "PRT - Lisbon (Campus)" or only the city
// ("Building A, Lisbon"), so it's matched by the configured country names and the
// places software jobs are in (search config `workday`).
type WorkdayPlaces = SearchConfig["workday"];

let configuredPlaces: RegExp | undefined;

/** Does a location name one of the configured Workday places? Discovery keeps Workday roles only there. */
export function namesWorkdayPlace(location: string | null): boolean {
  const { countries, places } = searchConfig().workday;
  configuredPlaces ??= placeNames([...countries, ...places]);
  return !!location && configuredPlaces.test(location);
}

function* leafFacets(facets: FacetGroup[]): Generator<{ facetParameter: string; values: FacetValue[] }> {
  for (const facet of facets) {
    const groups = facet.values.filter((v): v is FacetGroup => "facetParameter" in v);
    if (groups.length) yield* leafFacets(groups);
    else yield { facetParameter: facet.facetParameter, values: facet.values.filter((v): v is FacetValue => !("facetParameter" in v)) };
  }
}

const sumOf = (values: FacetValue[]) => values.reduce((sum, v) => sum + (v.count ?? 0), 0);

/**
 * The search filter for jobs in the configured countries: the tenant's country
 * facet when it has one (11 of 20 measured), else the matching values of its
 * locations facet. Null when no facet names any of them: the board has no jobs there.
 */
export function workdayFilter(
  facets: FacetGroup[],
  workday: WorkdayPlaces = searchConfig().workday,
): { parameter: string; ids: string[]; count: number } | null {
  const country = new RegExp(`^(${placeNames(workday.countries).source})$`, "iu");
  const place = placeNames([...workday.countries, ...workday.places]);
  const matches = [...leafFacets(facets)]
    .map((facet) => ({ parameter: facet.facetParameter, values: facet.values.filter((v) => place.test(v.descriptor)) }))
    .filter((m) => m.values.length);
  // The country facet covers every town; a locations facet is only as good as the configured places.
  const best =
    matches.find((m) => m.values.some((v) => country.test(v.descriptor.trim()))) ??
    matches.reduce<(typeof matches)[number] | undefined>((a, b) => (a && sumOf(a.values) >= sumOf(b.values) ? a : b), undefined);
  return best ? { parameter: best.parameter, ids: best.values.map((v) => v.id), count: sumOf(best.values) } : null;
}

/** The posting's id within its tenant: the last part of its path, "AI-Enablement-Software-Engineer_JR-06088". */
const postingId = (externalPath: string) => externalPath.split("/").filter(Boolean).at(-1) ?? externalPath;

const WORKPLACE: Record<string, string> = {
  remote: "remote",
  "fully remote": "remote",
  hybrid: "hybrid",
  "partially remote": "hybrid",
  onsite: "onsite",
  "on-site": "onsite",
  "on site": "onsite",
  "in person": "onsite",
};

/**
 * remoteType is a label each tenant names itself, and is absent when the
 * tenant doesn't use it (unknown, not on-site). Labels we can't read, like
 * Valeo's "Open to remote work", are kept as they are.
 */
const workplace = (remoteType: string | undefined) => (remoteType ? (WORKPLACE[remoteType.trim().toLowerCase()] ?? remoteType.trim()) : null);

/** One API call relative to /wday/cxs/<tenant>/<site>: a GET, or a POST of `json`. Passed in so tests can answer from fixtures. */
export type WorkdayApi = (path: string, json?: unknown) => Promise<unknown>;

/** The board token is "<tenant>/<site>". */
const siteOf = (board: Board) => {
  const [tenant, site] = board.token.split("/");
  return { tenant, site };
};

/** A job from the search alone, without its description: a title collect drops anyway. */
function listedOnly(board: Board, job: z.infer<typeof WorkdayListing>, raw: unknown): NormalizedPosting {
  return {
    // Posting ids are unique per tenant only, so the key includes the tenant.
    externalId: `${siteOf(board).tenant}/${postingId(job.externalPath)}`,
    url: jobUrl(board, job.externalPath),
    title: job.title,
    locationRaw: job.locationsText || null,
    workplaceRaw: workplace(job.remoteType),
    department: null,
    descriptionText: "",
    compensationRaw: null,
    postedAt: null,
    raw,
  };
}

/** The job's page on the career site, for when the API doesn't give its externalUrl. */
function jobUrl(board: Board, externalPath: string): string {
  const { tenant, site } = siteOf(board);
  return board.host.endsWith(".myworkdaysite.com")
    ? `https://${board.host}/recruiting/${tenant}/${site}${externalPath}`
    : `https://${board.host}/${site}${externalPath}`;
}

export function normalizeWorkdayJob(board: Board, listing: z.infer<typeof WorkdayListing>, response: unknown): NormalizedPosting {
  const job = parseResponse(WorkdayJob, response, "Workday job").jobPostingInfo;
  const raw = (response as { jobPostingInfo: unknown }).jobPostingInfo;
  // "Porto" says nothing about the country; "Porto, Norte, Portugal" already does.
  const country = job.country?.descriptor;
  const primary = job.location && country && !job.location.includes(country) ? `${job.location}, ${country}` : job.location;

  return {
    ...listedOnly(board, listing, raw),
    url: job.externalUrl ?? jobUrl(board, listing.externalPath),
    title: job.title,
    locationRaw: [...new Set([primary, ...(job.additionalLocations ?? [])].filter(Boolean))].join("; ") || listing.locationsText || null,
    workplaceRaw: workplace(job.remoteType ?? listing.remoteType),
    descriptionText: job.jobDescription ? htmlToText(job.jobDescription) : "",
    postedAt: job.startDate ? new Date(job.startDate) : null,
  };
}

/** Every job of the board in the configured countries, with descriptions for the engineering titles. */
export async function collectWorkday(board: Board, api: WorkdayApi, workday?: WorkdayPlaces): Promise<NormalizedPosting[]> {
  const search = async (appliedFacets: Record<string, string[]>, offset: number) =>
    parseResponse(WorkdaySearch, await api("/jobs", { appliedFacets, limit: PAGE, offset, searchText: "" }), "Workday search");

  const first = await search({}, 0);
  if (first.total === 0) return [];
  if (!first.facets?.length) throw new CollectorError("Workday search returned no facets to find the configured countries by");
  const filter = workdayFilter(first.facets, workday);
  if (!filter) return [];

  const facets = { [filter.parameter]: filter.ids };
  const page = await search(facets, 0);
  // The counts are per value, and a job in two places counts twice, so they bound the total.
  // More than that means the facet wasn't applied, and paging on would read the whole board.
  if (filter.count && page.total > filter.count) {
    throw new CollectorError(`Workday search ignored the ${filter.parameter} facet: ${page.total} jobs, expected at most ${filter.count}`);
  }
  const listed = [...page.jobPostings];
  for (let offset = PAGE; offset < page.total; offset += PAGE) {
    const next = await search(facets, offset);
    if (!next.jobPostings.length) break;
    listed.push(...next.jobPostings);
  }

  const postings: NormalizedPosting[] = [];
  let details = 0;
  let gone = 0;
  // One at a time: a board has a few dozen engineering jobs here at most.
  for (const raw of listed) {
    const job = parseResponse(WorkdayListing, raw, "Workday search result");
    if (!isEngineeringTitle(job.title)) {
      postings.push(listedOnly(board, job, raw));
      continue;
    }
    details++;
    const detail = await api(job.externalPath).catch((error: unknown) => {
      // A closed job answers 403 "permission denied". Closed since the search:
      // leave it out, and collect closes it.
      if (error instanceof CollectorError && (error.httpStatus === 403 || error.httpStatus === 404)) return null;
      throw error;
    });
    if (detail) postings.push(normalizeWorkdayJob(board, job, detail));
    else gone++;
  }
  // All of them closing in the seconds since the search is unlikely; more likely
  // Workday is refusing us, and collect must not close them all.
  if (gone && gone === details) throw new CollectorError(`Workday refused all ${details} job details`, 403);
  return postings;
}

export const workday: Collector = {
  ats: "workday",
  async fetchPostings(board: Board) {
    return collectWorkday(board, (path, json) => fetchJson(`https://${board.host}/wday/cxs/${board.token}${path}`, { json }));
  },
};
