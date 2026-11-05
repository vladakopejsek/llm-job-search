import { normalizeStartupJobsOffer, offerCompany } from "../../ats/startupjobs.ts";
import { CollectorError } from "../../ats/types.ts";
import { fetchText } from "../../lib/http.ts";
import { postingKey } from "../../screen/posting-key.ts";
import { isSoftwareSlug } from "./match.ts";
import type { BoardRole, BoardSource } from "./types.ts";

const HOST = "www.startupjobs.cz";
/** Every open offer, one URL each: /nabidka/<id>/<title-slug>. robots.txt allows everything on www. */
const SITEMAP = `https://${HOST}/sitemap/offers.xml`;
/** Offer pages are full web pages, not an API: one at a time, with a pause. */
const PAUSE_MS = 500;

export function sitemapOffers(xml: string): { id: string; slug: string }[] {
  return [...xml.matchAll(/<loc>[^<]*\/nabidka\/(\d+)\/([^<]*)<\/loc>/g)].map(([, id, slug]) => ({ id: id!, slug: slug! }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startupJobsBoard: BoardSource = {
  country: "CZ",
  name: "startupjobs",
  label: "StartupJobs.cz",
  async scan(known) {
    const offers = sitemapOffers((await fetchText(SITEMAP, "application/xml")).body);
    const listed = new Set(offers.map((o) => postingKey("startupjobs", o.id)));
    const roles: BoardRole[] = [];
    const errors: string[] = [];
    for (const offer of offers) {
      if (!isSoftwareSlug(offer.slug) || known(postingKey("startupjobs", offer.id))) continue;
      await sleep(PAUSE_MS);
      try {
        const { body } = await fetchText(`https://${HOST}/nabidka/${offer.id}`, "text/html");
        const company = offerCompany(body);
        const posting = company && normalizeStartupJobsOffer(body, company.slug);
        if (!company || !posting) continue;
        roles.push({
          company: company.name,
          board: { ats: "startupjobs", token: company.slug, host: HOST },
          companyUrl: `https://${HOST}/startup/${company.slug}`,
          postingKey: postingKey("startupjobs", posting.externalId),
          posting,
        });
      } catch (error) {
        // Closed since the sitemap was built.
        if (error instanceof CollectorError && error.httpStatus === 404) continue;
        errors.push(`offer ${offer.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { listed, roles, uncollectable: 0, errors };
  },
};
