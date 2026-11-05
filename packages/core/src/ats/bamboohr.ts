import { z } from "zod";
import { isEngineeringTitle } from "../collect/filter.ts";
import { fetchJson } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseResponse } from "./parse.ts";
import { type Board, type Collector, CollectorError, type NormalizedPosting } from "./types.ts";

/**
 * BambooHR's careers pages (<company>.bamboohr.com/careers) read two public
 * JSON endpoints: /careers/list (every open job, without its text) and
 * /careers/<id>/detail (one job's description, date and compensation, plus its
 * application form). robots.txt disallows only the old /jobs/embed*.php.
 *
 * The list and the detail are merged into one job object; the detail is the
 * fuller of the two, and the list adds the id.
 */

const Office = z.object({ city: z.string().nullish(), state: z.string().nullish(), addressCountry: z.string().nullish() });
const RemoteLocation = z.object({
  city: z.string().nullish(),
  state: z.string().nullish(),
  province: z.string().nullish(),
  country: z.string().nullish(),
});

const BambooHRJob = z.object({
  /** Counts up per company ("362"), so it's only unique together with the subdomain. */
  id: z.union([z.string(), z.number()]),
  jobOpeningName: z.string(),
  departmentLabel: z.string().nullish(),
  location: Office.nullish(),
  /** Where a remote job can be done from; empty for office and hybrid jobs. */
  atsLocation: RemoteLocation.nullish(),
  locationType: z.string().nullish(),
  /** Only in the detail. */
  description: z.string().nullish(),
  /** "2026-10-08". */
  datePosted: z.string().nullish(),
  /** Free text when set: "Gross (B2B) 3000€ ~ 4000€ / month". */
  compensation: z.unknown().optional(),
});

const BambooHRList = z.object({ result: z.array(z.unknown()) });
const BambooHRDetail = z.object({ result: z.object({ jobOpening: z.record(z.string(), z.unknown()) }) });

/**
 * locationType, read from real boards on 2026-10-26: "1" is remote (the job
 * then names a remote location instead of an office: Draslovka's "Senior
 * Back-End Engineer (South Africa - Remote)"), "2" is hybrid (signageOS:
 * "minimum 3 days per week in the office"). "0" is the office default, but
 * fully remote roles carry it too (AfterNow's "Europe, Remote", PeopleVisor's
 * "Any (Remote)"), so it means unknown, not on-site. `isRemote` was null on all
 * 155 jobs of 13 boards, so it isn't read.
 */
const WORKPLACE: Record<string, string> = { "1": "remote", "2": "hybrid" };

/** "Lisbon, Lisbon, Portugal" → "Lisbon, Portugal"; "-" is a placeholder some companies type. */
const place = (parts: (string | null | undefined)[]) => {
  const named = parts.map((p) => p?.trim()).filter((p): p is string => !!p && p !== "-");
  return [...new Map(named.map((p) => [p.toLowerCase(), p])).values()].join(", ");
};

/** One job: its /careers/list entry, merged with its /careers/<id>/detail when that was read. */
function normalizeBambooHRJob(listed: unknown, detail: unknown, board: Pick<Board, "token" | "host">): NormalizedPosting {
  const opening = detail === null ? {} : parseResponse(BambooHRDetail, detail, "BambooHR job detail").result.jobOpening;
  const raw = { ...(listed as object), ...opening };
  const job = parseResponse(BambooHRJob, raw, "BambooHR job");
  const office = place([job.location?.city, job.location?.state, job.location?.addressCountry]);
  const remote = place([job.atsLocation?.city, job.atsLocation?.province, job.atsLocation?.state, job.atsLocation?.country]);

  return {
    externalId: `${board.token}/${job.id}`,
    url: `https://${board.host}/careers/${job.id}`,
    title: job.jobOpeningName.trim(),
    locationRaw: [office, remote].filter(Boolean).join("; ") || null,
    workplaceRaw: WORKPLACE[job.locationType ?? ""] ?? null,
    department: job.departmentLabel || null,
    descriptionText: job.description ? htmlToText(job.description) : "",
    compensationRaw: job.compensation ?? null,
    postedAt: job.datePosted ? new Date(job.datePosted) : null,
    raw,
  };
}

/**
 * The text costs one request per job, and a BambooHR board is the whole
 * company's: on 2026-10-26, 65 of 155 jobs on 13 boards had an engineering
 * title (Piano: 2 of 21). So only those get their detail read. The rest come
 * back without a description, which the collect step drops by the same title
 * check; they're still returned so that the run knows they're listed.
 */
export const bamboohr: Collector = {
  ats: "bamboohr",
  async fetchPostings(board: Board) {
    const base = `https://${board.host}/careers`;
    let list: unknown;
    try {
      // A subdomain that isn't a BambooHR company redirects to www.bamboohr.com.
      list = await fetchJson(`${base}/list`, { followRedirects: false });
    } catch (error) {
      if (error instanceof CollectorError && error.httpStatus && error.httpStatus >= 300 && error.httpStatus < 400) {
        throw new CollectorError(`BambooHR board not found (${error.message})`, 404);
      }
      throw error;
    }

    const postings: NormalizedPosting[] = [];
    let details = 0;
    let gone = 0;
    // One at a time: a board needs a handful of details, not enough to hurry.
    for (const listed of parseResponse(BambooHRList, list, "BambooHR board").result) {
      const job = parseResponse(BambooHRJob, listed, "BambooHR job");
      let detail: unknown = null;
      if (isEngineeringTitle(job.jobOpeningName)) {
        details++;
        detail = await fetchJson(`${base}/${job.id}/detail`).catch((error: unknown) => {
          // Closed since the list was read: leave it out, and collect closes it.
          if (error instanceof CollectorError && error.httpStatus === 404) return undefined;
          throw error;
        });
        if (detail === undefined) {
          gone++;
          continue;
        }
      }
      postings.push(normalizeBambooHRJob(listed, detail, board));
    }
    // All of them closing since the list is unlikely; more likely the detail URL moved, and collect must not close them all.
    if (gone && gone === details) throw new CollectorError(`BambooHR refused all ${details} job details`, 404);
    return postings;
  },
};
