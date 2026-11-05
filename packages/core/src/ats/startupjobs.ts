import { z } from "zod";
import { fetchText } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseResponse } from "./parse.ts";
import { type Board, type Collector, CollectorError, type NormalizedPosting } from "./types.ts";

/**
 * StartupJobs.cz has no public API. Its pages are open to crawlers (robots.txt
 * on www allows everything; the backend API host disallows everything, so it
 * isn't used). The board is the company's page, /startup/<slug>, which links
 * its open offers; each offer page carries a schema.org JobPosting in JSON-LD,
 * the markup sites publish for Google Jobs.
 */

const Place = z.object({
  address: z.object({ addressLocality: z.string().optional(), addressCountry: z.string().optional() }).optional(),
});

const JobPosting = z.object({
  "@type": z.literal("JobPosting"),
  title: z.string(),
  url: z.string(),
  description: z.string(),
  datePosted: z.string().optional(),
  identifier: z.object({ value: z.union([z.string(), z.number()]) }),
  hiringOrganization: z.object({ url: z.string(), name: z.string().optional() }),
  jobLocation: z.union([Place, z.array(Place)]).optional(),
  /** "TELECOMMUTE" marks a remote role; absent otherwise. */
  jobLocationType: z.string().optional(),
  applicantLocationRequirements: z.union([z.object({ name: z.string() }), z.array(z.object({ name: z.string() }))]).optional(),
  baseSalary: z.unknown().optional(),
});

const LD_JSON = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

/** Offer ids linked from a company page, once each (the page links every offer twice: desktop and mobile layouts). */
export function offerIds(companyPage: string): string[] {
  return [...new Set([...companyPage.matchAll(/href="\/nabidka\/(\d+)\//g)].map((m) => m[1]!))];
}

/** The offer page's JobPosting, or null if the page has none (e.g. the offer closed between the two fetches). */
function jobPostingIn(page: string): unknown {
  for (const [, json] of page.matchAll(LD_JSON)) {
    const data = JSON.parse(json!) as { "@graph"?: unknown[] };
    const posting = (data["@graph"] ?? [data]).find((node) => (node as { "@type"?: string })["@type"] === "JobPosting");
    if (posting) return posting;
  }
  return null;
}

/** Who posted an offer page: the slug of its /startup/<slug> page and its name, or null without a JobPosting. */
export function offerCompany(page: string): { slug: string; name: string } | null {
  const raw = jobPostingIn(page);
  if (!raw) return null;
  const org = parseResponse(JobPosting, raw, "StartupJobs offer").hiringOrganization;
  const slug = /\/startup\/([^/?#]+)/.exec(org.url)?.[1];
  return slug ? { slug, name: org.name?.trim() || slug } : null;
}

const asList = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** One offer page → a posting, or null when it isn't this company's (a page can link a related company's offer). */
export function normalizeStartupJobsOffer(page: string, slug: string): NormalizedPosting | null {
  const raw = jobPostingIn(page);
  if (!raw) return null;
  const job = parseResponse(JobPosting, raw, "StartupJobs offer");
  if (!job.hiringOrganization.url.endsWith(`/startup/${slug}`)) return null;

  const places = asList(job.jobLocation).map((p) => [p.address?.addressLocality, p.address?.addressCountry].filter(Boolean).join(", "));
  const remote = job.jobLocationType === "TELECOMMUTE";
  // A remote offer names the countries it's open to instead of an office.
  const regions = asList(job.applicantLocationRequirements).map((r) => r.name);

  return {
    externalId: String(job.identifier.value),
    url: job.url,
    title: job.title,
    locationRaw: [...new Set([...places, ...regions])].filter(Boolean).join("; ") || null,
    // Not marked remote means unknown, not on-site: reading it as on-site would let the screen's
    // office rule reject roles whose text says they're remote.
    workplaceRaw: remote ? "remote" : null,
    department: null,
    descriptionText: htmlToText(job.description),
    compensationRaw: job.baseSalary ?? null,
    postedAt: job.datePosted ? new Date(job.datePosted) : null,
    raw,
  };
}

export const startupjobs: Collector = {
  ats: "startupjobs",
  async fetchPostings(board: Board) {
    const { body } = await fetchText(`https://${board.host}/startup/${encodeURIComponent(board.token)}`, "text/html");
    const postings: NormalizedPosting[] = [];
    const ids = offerIds(body);
    let gone = 0;
    // One at a time: these are full web pages, not an API built for polling.
    for (const id of ids) {
      const page = await fetchText(`https://${board.host}/nabidka/${id}`, "text/html").catch((error: unknown) => {
        // Closed since the company page was read: leave it out, and collect closes it.
        if (error instanceof CollectorError && error.httpStatus === 404) return null;
        throw error;
      });
      if (!page) {
        gone++;
        continue;
      }
      try {
        const posting = normalizeStartupJobsOffer(page.body, board.token);
        if (posting) postings.push(posting);
      } catch (error) {
        if (error instanceof CollectorError) throw error;
        throw new CollectorError(`StartupJobs offer ${id}: invalid JSON-LD`, null, { cause: error });
      }
    }
    // Every offer gone at once is more likely a moved URL than a closed company: collect must not close them all.
    if (gone && gone === ids.length) throw new CollectorError(`StartupJobs refused all ${ids.length} offers`, 404);
    return postings;
  },
};
