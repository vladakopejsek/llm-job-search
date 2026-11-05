import { CollectorError } from "../../ats/types.ts";
import { fetchText } from "../../lib/http.ts";
import { htmlToText } from "../../lib/text.ts";
import type { BoardRole, BoardSource } from "./types.ts";

/**
 * Jobstack.it, a Czech IT board. robots.txt allows the offer pages; its terms
 * allow use for one's own need. Offers apply through the board's own form and
 * name the company, so discovery looks up the company's ATS board itself. The
 * sitemap keeps old evergreen ads too; categories are coarse ("react-developer"),
 * so only the stack's categories are read, once a day.
 */
const HOST = "www.jobstack.it";
const SITEMAP = `https://${HOST}/sitemap.xml`;
const PAUSE_MS = 1000;
const STACK_CATEGORY = /react|javascript|typescript|node|full-?stack|front-?end|web-developer|ai-native|developer-other/;

/** Offers as /it-job/<category>/<id>. */
export function jobstackOffers(xml: string): { category: string; id: string }[] {
  return [...xml.matchAll(/<loc>[^<]*\/it-job\/([^/<]+)\/([0-9a-f]+)<\/loc>/g)].map(([, category, id]) => ({ category: category!, id: id! }));
}

const text = (html: string | undefined) => (html ? htmlToText(html).replace(/\s+/g, " ").trim() : "");

/** An offer page as a role, or null without a title or company. */
export function jobstackRole(page: string, id: string, url: string): BoardRole | null {
  const title = text(/<h1[^>]*jobpost-h1-2023[^>]*>([\s\S]*?)<\/h1>/.exec(page)?.[1]);
  const company = /<a href="\/company-profile\/([^/"]+)\/[0-9a-f]+">([\s\S]*?)<\/a>/.exec(page);
  if (!title || !company) return null;
  const name = text(company[2]);
  // The "Informace" list: company, address, home office…; the address is what the screen reads.
  const info = text(/Informace<\/h6>\s*<ul class="jobpost-values-2023">([\s\S]*?)<\/ul>/.exec(page)?.[1])
    .replace(name, "")
    .trim();
  // From the end of the offer's opening tag to the list of other offers below it.
  const marker = page.indexOf('class="jobpost-2023"');
  const start = marker >= 0 ? page.indexOf(">", marker) + 1 : -1;
  const end = page.indexOf("jobposts--next");
  const body = start > 0 ? page.slice(start, end > start ? end : undefined) : "";
  return {
    company: name,
    companySlug: company[1],
    board: null,
    companyUrl: `https://${HOST}/company-profile/${company[1]}`,
    postingKey: `jobstack:${id}`,
    posting: {
      externalId: id,
      url,
      title,
      locationRaw: info ? `${info}, Česko` : "Česko",
      workplaceRaw: null,
      department: null,
      descriptionText: htmlToText(body),
      compensationRaw: null,
      // The id's first 8 hex digits are its creation time.
      postedAt: new Date(Number.parseInt(id.slice(0, 8), 16) * 1000),
      raw: null,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const jobstackBoard: BoardSource = {
  country: "CZ",
  name: "jobstack",
  label: "Jobstack.it",
  daily: true,
  async scan() {
    const offers = jobstackOffers((await fetchText(SITEMAP, "application/xml")).body);
    const listed = new Set(offers.map((o) => `jobstack:${o.id}`));
    const roles: BoardRole[] = [];
    const errors: string[] = [];
    for (const offer of offers.filter((o) => STACK_CATEGORY.test(o.category))) {
      await sleep(PAUSE_MS);
      const url = `https://${HOST}/it-job/${offer.category}/${offer.id}`;
      try {
        const role = jobstackRole((await fetchText(url, "text/html")).body, offer.id, url);
        if (role) roles.push(role);
      } catch (error) {
        if (error instanceof CollectorError && error.httpStatus === 404) continue;
        errors.push(`${offer.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { listed, roles, uncollectable: 0, errors };
  },
};
