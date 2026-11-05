import { z } from "zod";
import { fetchJson } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseResponse } from "./parse.ts";
import type { Board, Collector, NormalizedPosting } from "./types.ts";

// Only the fields we read are listed; everything else is kept in `raw`.
const AshbyJob = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string().nullish(),
  team: z.string().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  jobUrl: z.string(),
  descriptionHtml: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  compensation: z.unknown().optional(),
});

const AshbyResponse = z.object({ jobs: z.array(z.unknown()) });

export function normalizeAshby(response: unknown): NormalizedPosting[] {
  const { jobs } = parseResponse(AshbyResponse, response, "Ashby board");

  return jobs.flatMap((raw) => {
    const job = parseResponse(AshbyJob, raw, "Ashby job");
    if (job.isListed === false) return [];

    const locations = [job.location, ...(job.secondaryLocations ?? []).map((l) => l.location)].filter((l): l is string => !!l);

    return [
      {
        externalId: job.id,
        url: job.jobUrl,
        title: job.title,
        locationRaw: locations.length ? [...new Set(locations)].join("; ") : null,
        workplaceRaw: job.workplaceType ?? null,
        department: job.team ?? job.department ?? null,
        descriptionText: job.descriptionHtml ? htmlToText(job.descriptionHtml) : (job.descriptionPlain ?? ""),
        compensationRaw: job.compensation ?? null,
        postedAt: job.publishedAt ? new Date(job.publishedAt) : null,
        raw,
      },
    ];
  });
}

export const ashby: Collector = {
  ats: "ashby",
  async fetchPostings(board: Board) {
    const url = `https://${board.host}/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`;
    return normalizeAshby(await fetchJson(url));
  },
};
