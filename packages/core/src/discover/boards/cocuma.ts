import { CollectorError } from "../../ats/types.ts";
import { fetchText } from "../../lib/http.ts";
import { htmlToText } from "../../lib/text.ts";
import { isSoftwareSlug } from "./match.ts";
import type { BoardRole, BoardSource } from "./types.ts";

/**
 * Cocuma.cz, a Czech board of company profiles. robots.txt allows the job
 * pages and the jobs sitemap (not the search and city filters, which aren't
 * used). Jobs apply through the board and name the company, so discovery looks
 * up its ATS board. Read once a day: software slugs changed in the last two weeks.
 */
const SITEMAP = "https://www.cocuma.cz/sitemap-jobs.xml";
const WINDOW_MS = 14 * 864e5;
const PAUSE_MS = 1000;

export function cocumaJobs(xml: string): { url: string; slug: string; id: string; lastmod: Date | null }[] {
  return [...xml.matchAll(/<loc>([^<]*\/job\/([^/<]+)\/(\d+)\/)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?/g)].map(([, url, slug, id, lastmod]) => ({
    url: url!,
    slug: slug!,
    id: id!,
    lastmod: lastmod ? new Date(lastmod) : null,
  }));
}

const text = (html: string | undefined) => (html ? htmlToText(html).replace(/\s+/g, " ").trim() : "");

/** A job page as a role, or null without a title or company. */
export function cocumaRole(page: string, id: string, url: string): BoardRole | null {
  const title = text(/<h1[^>]*job-title[^>]*>([\s\S]*?)<\/h1>/.exec(page)?.[1]);
  // "<Role> – Práce v <Company> | Cocuma"
  const name = text(/<title>[\s\S]*?Práce v ([\s\S]*?) \| Cocuma<\/title>/.exec(page)?.[1]);
  const slug = /class="company-thumbnail-header"\s+href="[^"]*\/company\/([^/"]+)\/"/.exec(page)?.[1];
  if (!title || !name) return null;
  const address = text(/<dt>Adresa<\/dt>\s*<dd>([\s\S]*?)<\/dd>/.exec(page)?.[1]);
  // From the end of the job's opening tag to the company sidebar.
  const marker = page.indexOf('id="jobDetail"');
  const start = marker >= 0 ? page.indexOf(">", marker) + 1 : -1;
  const end = page.indexOf("job-sidebar");
  return {
    company: name,
    companySlug: slug,
    board: null,
    companyUrl: slug ? `https://www.cocuma.cz/company/${slug}/` : url,
    postingKey: `cocuma:${id}`,
    posting: {
      externalId: id,
      url,
      title,
      // The board lists Czech jobs only; its address names the street, not always the city.
      locationRaw: address ? `${address}, Česko` : "Česko",
      workplaceRaw: null,
      department: null,
      descriptionText: htmlToText(start > 0 ? page.slice(start, end > start ? end : undefined) : ""),
      compensationRaw: null,
      postedAt: null,
      raw: null,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const cocumaBoard: BoardSource = {
  country: "CZ",
  name: "cocuma",
  label: "Cocuma.cz",
  daily: true,
  async scan() {
    const jobs = cocumaJobs((await fetchText(SITEMAP, "application/xml")).body);
    const listed = new Set(jobs.map((j) => `cocuma:${j.id}`));
    const since = Date.now() - WINDOW_MS;
    const roles: BoardRole[] = [];
    const errors: string[] = [];
    for (const job of jobs) {
      if (!isSoftwareSlug(job.slug) || (job.lastmod && job.lastmod.getTime() < since)) continue;
      await sleep(PAUSE_MS);
      try {
        const role = cocumaRole((await fetchText(job.url, "text/html")).body, job.id, job.url);
        if (role) roles.push(role);
      } catch (error) {
        if (error instanceof CollectorError && error.httpStatus === 404) continue;
        errors.push(`${job.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { listed, roles, uncollectable: 0, errors };
  },
};
