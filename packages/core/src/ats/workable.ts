import { z } from "zod";
import { fetchJson } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseResponse } from "./parse.ts";
import type { Board, Collector, NormalizedPosting } from "./types.ts";

const WorkableJob = z.object({
  /** Globally unique, and the id in every job URL (apply.workable.com/j/<shortcode>). */
  shortcode: z.string(),
  title: z.string(),
  url: z.string(),
  department: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  locations: z.array(z.object({ city: z.string().nullish(), region: z.string().nullish(), country: z.string().nullish() })).nullish(),
  published_on: z.string().nullish(),
  created_at: z.string().nullish(),
  /** Only present with ?details=true. */
  description: z.string().nullish(),
});

const WorkableResponse = z.object({ jobs: z.array(z.unknown()) });

const place = (l: { city?: string | null; region?: string | null; country?: string | null }) =>
  [l.city, l.region, l.country].filter(Boolean).join(", ");

export function normalizeWorkable(response: unknown): NormalizedPosting[] {
  const { jobs } = parseResponse(WorkableResponse, response, "Workable board");

  return jobs.map((raw) => {
    const job = parseResponse(WorkableJob, raw, "Workable job");
    const locations = job.locations?.length ? job.locations.map(place) : [place({ city: job.city, region: job.state, country: job.country })];
    const published = job.published_on ?? job.created_at;

    return {
      externalId: job.shortcode,
      url: job.url,
      title: job.title,
      locationRaw: locations.filter(Boolean).join("; ") || null,
      // Workable only says whether a job is remote; false doesn't mean on-site.
      workplaceRaw: job.telecommuting ? "remote" : null,
      department: job.department || null,
      descriptionText: job.description ? htmlToText(job.description) : "",
      compensationRaw: null,
      postedAt: published ? new Date(published) : null,
      raw,
    };
  });
}

export const workable: Collector = {
  ats: "workable",
  async fetchPostings(board: Board) {
    const url = `https://${board.host}/api/v1/widget/accounts/${encodeURIComponent(board.token)}?details=true`;
    return normalizeWorkable(await fetchJson(url));
  },
};
