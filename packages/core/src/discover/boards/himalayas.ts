import { z } from "zod";
import { parseResponse } from "../../ats/parse.ts";
import { fetchJson } from "../../lib/http.ts";
import { htmlToText } from "../../lib/text.ts";
import { searchConfig } from "../../search-config.ts";
import type { BoardRole, BoardSource } from "./types.ts";

/**
 * Himalayas' public search API (no key; data refreshed once a day, so read
 * once a day). Its jobs name the company but link only back to Himalayas, so
 * discovery looks for the company's ATS board itself; the role we act on comes
 * from there, never from this listing.
 */
const QUERIES = ["typescript", "react", "node.js", "full stack", "frontend"];
const PAGES = 2;
const PAUSE_MS = 1000;
/** `country=PT` returns jobs open to Portugal, worldwide ones included: the home country's first code. */
const search = () => `https://himalayas.app/jobs/api/search?country=${searchConfig().home.codes[0]}&sort=recent`;

const Job = z.object({
  title: z.string(),
  companyName: z.string(),
  companySlug: z.string(),
  description: z.string(),
  locationRestrictions: z.array(z.string()),
  guid: z.string(),
  pubDate: z.number(),
});
const Page = z.object({ jobs: z.array(Job) });

/** "43 countries incl. Portugal", "Portugal, Spain", or "Worldwide": what the screen and the push read. */
export function himalayasLocation(countries: string[]): string {
  if (!countries.length) return "Worldwide";
  return countries.length > 5 ? `${countries.length} countries incl. ${searchConfig().home.country}` : countries.join(", ");
}

function himalayasRole(job: z.infer<typeof Job>): BoardRole {
  const path = new URL(job.guid).pathname;
  return {
    company: job.companyName.trim(),
    companySlug: job.companySlug,
    board: null,
    companyUrl: `https://himalayas.app/companies/${job.companySlug}`,
    postingKey: `himalayas:${path.replace(/^\/companies\//, "")}`,
    posting: {
      externalId: path,
      url: job.guid,
      title: job.title,
      locationRaw: himalayasLocation(job.locationRestrictions),
      workplaceRaw: "remote",
      department: null,
      descriptionText: htmlToText(job.description),
      compensationRaw: null,
      postedAt: new Date(job.pubDate * 1000),
      raw: null,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const himalayasBoard: BoardSource = {
  name: "himalayas",
  label: "Himalayas",
  daily: true,
  async scan() {
    const roles = new Map<string, BoardRole>();
    const errors: string[] = [];
    for (const q of QUERIES) {
      for (let page = 1; page <= PAGES; page++) {
        await sleep(PAUSE_MS);
        try {
          const { jobs } = parseResponse(Page, await fetchJson(`${search()}&q=${encodeURIComponent(q)}&page=${page}`), "Himalayas search");
          for (const job of jobs) {
            const role = himalayasRole(job);
            roles.set(role.postingKey, role);
          }
          if (jobs.length < 20) break;
        } catch (error) {
          errors.push(`${q} page ${page}: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    }
    // A search shows only the newest jobs, so it can't say a role is gone: an empty list removes nothing (boards/run.ts).
    return { listed: new Set(), roles: [...roles.values()], uncollectable: 0, errors };
  },
};
