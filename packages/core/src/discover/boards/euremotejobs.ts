import { z } from "zod";
import { collectorFor, parseFeedUrl } from "../../ats/index.ts";
import { CollectorError } from "../../ats/types.ts";
import { fetchText } from "../../lib/http.ts";
import { htmlToText, unescapeHtml } from "../../lib/text.ts";
import { namesHome } from "../../screen/rules.ts";
import { isSoftwareSlug } from "./match.ts";
import type { BoardRole, BoardSource } from "./types.ts";

/**
 * EU Remote Jobs lists remote roles open to Europe, and its apply buttons
 * mostly lead to the company's own ATS, so a company found here can be watched
 * right away. No API; robots.txt allows the job pages and the sitemap.
 */
const SITEMAP = "https://euremotejobs.com/job_listing-sitemap.xml";
/** Roles posted or changed this recently; the scan runs 3× a day, so this overlaps. */
const WINDOW_MS = 2 * 864e5;
const PAUSE_MS = 2000;

/** Job URLs with their last change, newest first as the sitemap lists them. */
export function sitemapJobs(xml: string): { url: string; slug: string; lastmod: Date | null }[] {
  return [
    ...xml.matchAll(
      /<url>\s*<loc>(?:<!\[CDATA\[)?([^<\]]*\/job\/([^/<\]]+)\/?)(?:\]\]>)?<\/loc>\s*(?:<lastmod>(?:<!\[CDATA\[)?([^<\]]*)(?:\]\]>)?<\/lastmod>)?/g,
    ),
  ].map(([, url, slug, lastmod]) => ({ url: url!, slug: slug!, lastmod: lastmod ? new Date(lastmod) : null }));
}

const JobPosting = z.object({
  "@type": z.literal("JobPosting"),
  title: z.string(),
  description: z.string(),
  datePosted: z.string().optional(),
  hiringOrganization: z.object({ name: z.string() }),
  jobLocation: z.object({ address: z.union([z.string(), z.object({ addressCountry: z.string().optional() })]) }).optional(),
  jobLocationType: z.string().optional(),
  applicantLocationRequirements: z.union([z.object({ name: z.string() }), z.array(z.object({ name: z.string() }))]).optional(),
});

const LD_JSON = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

/** The apply button's link, without the board's tracking parameters. */
export function applyLink(page: string): string | null {
  const href = /<a[^>]*href="([^"]+)"[^>]*class="application_button_link/.exec(page)?.[1];
  if (!href) return null;
  try {
    // WordPress writes "&" in attributes as "&#038;".
    const url = new URL(unescapeHtml(href).replace(/&#0*38;/g, "&"));
    for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return null;
  }
}

/** A job page as a role: its JobPosting, and the company's ATS board from the apply link. Null when either is missing. */
export function euRemoteJobsRole(page: string, url: string, slug: string): BoardRole | "uncollectable" | null {
  let job: z.infer<typeof JobPosting> | null = null;
  for (const [, json] of page.matchAll(LD_JSON)) {
    try {
      const data = JSON.parse(json!) as { "@graph"?: unknown[] };
      const found = (data["@graph"] ?? [data]).find((n) => (n as { "@type"?: string })["@type"] === "JobPosting");
      if (found) job = JobPosting.parse(found);
    } catch {
      // Another script block, or one we can't read.
    }
  }
  if (!job) return null;
  const countries = [job.applicantLocationRequirements ?? []].flat().map((c) => c.name);
  // A country list without the home country rules it out; no list means the board says only "Europe" or "Worldwide".
  if (countries.length && !countries.some(namesHome)) return null;

  const apply = applyLink(page);
  const board = parseFeedUrl(apply);
  if (!apply || !board || !collectorFor(board.ats)) return "uncollectable";

  const address = job.jobLocation?.address;
  const where = typeof address === "string" ? address : (address?.addressCountry ?? null);
  return {
    company: job.hiringOrganization.name.trim(),
    board,
    companyUrl: apply,
    postingKey: `euremotejobs:${slug}`,
    posting: {
      externalId: slug,
      url,
      title: job.title,
      locationRaw: where,
      workplaceRaw: job.jobLocationType === "TELECOMMUTE" ? "remote" : null,
      department: null,
      descriptionText: htmlToText(job.description),
      compensationRaw: null,
      postedAt: job.datePosted ? new Date(job.datePosted) : null,
      raw: null,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const euRemoteJobsBoard: BoardSource = {
  name: "euremotejobs",
  label: "EU Remote Jobs",
  async scan() {
    const jobs = sitemapJobs((await fetchText(SITEMAP, "application/xml")).body);
    const listed = new Set(jobs.map((j) => `euremotejobs:${j.slug}`));
    const since = Date.now() - WINDOW_MS;
    const roles: BoardRole[] = [];
    let uncollectable = 0;
    const errors: string[] = [];
    for (const job of jobs) {
      if (!isSoftwareSlug(job.slug) || (job.lastmod && job.lastmod.getTime() < since)) continue;
      await sleep(PAUSE_MS);
      try {
        const role = euRemoteJobsRole((await fetchText(job.url, "text/html")).body, job.url, job.slug);
        if (role === "uncollectable") uncollectable++;
        else if (role) roles.push(role);
      } catch (error) {
        if (error instanceof CollectorError && error.httpStatus === 404) continue;
        errors.push(`${job.slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { listed, roles, uncollectable, errors };
  },
};
