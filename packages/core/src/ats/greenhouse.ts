import { z } from "zod";
import { fetchJson } from "../lib/http.ts";
import { htmlToText, unescapeHtml } from "../lib/text.ts";
import { parseResponse } from "./parse.ts";
import type { Board, Collector, NormalizedPosting } from "./types.ts";

const GreenhouseJob = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  /** HTML, but escaped: "&lt;p&gt;…". */
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string() })).nullish(),
});

const GreenhouseResponse = z.object({ jobs: z.array(z.unknown()) });

export function normalizeGreenhouse(response: unknown): NormalizedPosting[] {
  const { jobs } = parseResponse(GreenhouseResponse, response, "Greenhouse board");

  return jobs.map((raw) => {
    const job = parseResponse(GreenhouseJob, raw, "Greenhouse job");
    const published = job.first_published ?? job.updated_at;

    return {
      externalId: String(job.id),
      url: job.absolute_url,
      title: job.title,
      locationRaw: job.location?.name || null,
      workplaceRaw: null, // Greenhouse has no structured remote flag; it's in the location text.
      department: job.departments?.map((d) => d.name).join(", ") || null,
      descriptionText: job.content ? htmlToText(unescapeHtml(job.content)) : "",
      compensationRaw: null,
      postedAt: published ? new Date(published) : null,
      raw,
    };
  });
}

export const greenhouse: Collector = {
  ats: "greenhouse",
  async fetchPostings(board: Board) {
    const url = `https://${board.host}/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`;
    return normalizeGreenhouse(await fetchJson(url));
  },
};
