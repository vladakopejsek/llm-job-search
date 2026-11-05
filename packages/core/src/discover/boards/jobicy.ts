import { z } from "zod";
import { parseResponse } from "../../ats/parse.ts";
import { fetchJson } from "../../lib/http.ts";
import { htmlToText } from "../../lib/text.ts";
import { namesHome } from "../../screen/rules.ts";
import type { BoardRole, BoardSource } from "./types.ts";

/**
 * Jobicy's public jobs API: remote engineering roles posted in the last 7 days
 * that are open to Europe. Polling at most once an hour is its rule; the scan
 * runs 3× a day. Like Himalayas it names the company but links only to itself.
 */
const API = "https://jobicy.com/api/jobs?count=100&geo=europe&industry=engineering";
const MAX_PAGES = 3;

const Job = z.object({
  id: z.number(),
  url: z.string(),
  jobTitle: z.string(),
  companyName: z.string(),
  jobGeo: z.string(),
  jobDescription: z.string(),
  pubDate: z.string(),
});
const Page = z.object({ jobs: z.array(Job), nextCursor: z.string().nullish(), hasMore: z.boolean().optional() });

/** Jobicy's region is one label; "Spain" or "UK" alone leaves anyone at home out (unless home is Spain or the UK). */
const OPEN_REGION = /europe|emea|\beu\b|anywhere|worldwide/i;

export function jobicyRole(job: z.infer<typeof Job>): BoardRole | null {
  if (!OPEN_REGION.test(job.jobGeo) && !namesHome(job.jobGeo)) return null;
  return {
    company: job.companyName.trim(),
    board: null,
    companyUrl: job.url,
    postingKey: `jobicy:${job.id}`,
    posting: {
      externalId: String(job.id),
      url: job.url,
      title: job.jobTitle,
      locationRaw: job.jobGeo,
      workplaceRaw: "remote",
      department: null,
      descriptionText: htmlToText(job.jobDescription),
      compensationRaw: null,
      postedAt: new Date(job.pubDate),
      raw: null,
    },
  };
}

export const jobicyBoard: BoardSource = {
  name: "jobicy",
  label: "Jobicy",
  async scan() {
    const roles: BoardRole[] = [];
    const listed = new Set<string>();
    let cursor: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = parseResponse(Page, await fetchJson(cursor ? `${API}&cursor=${encodeURIComponent(cursor)}` : API), "Jobicy jobs");
      for (const job of data.jobs) {
        listed.add(`jobicy:${job.id}`);
        const role = jobicyRole(job);
        if (role) roles.push(role);
      }
      cursor = data.nextCursor;
      if (!data.hasMore || !cursor) break;
    }
    return { listed, roles, uncollectable: 0, errors: [] };
  },
};
