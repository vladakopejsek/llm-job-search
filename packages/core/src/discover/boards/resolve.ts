import { collectorFor, parseFeedUrl } from "../../ats/index.ts";
import { type Board, CollectorError } from "../../ats/types.ts";
import { companyKeys } from "../../screen/company-key.ts";

/** A board URL on each ATS we collect, for a token. */
const BOARD_URLS: ((token: string) => string)[] = [
  (t) => `https://jobs.ashbyhq.com/${t}`,
  (t) => `https://boards.greenhouse.io/${t}`,
  (t) => `https://jobs.lever.co/${t}`,
  (t) => `https://apply.workable.com/${t}/`,
  (t) => `https://${t}.teamtailor.com/jobs.rss`,
  (t) => `https://${t}.recruitee.com/`,
  (t) => `https://${t}.jobs.personio.de/xml`,
  // Not Workday: its board URL also needs the tenant's server (wd1…wd12) and site name, which a name doesn't give.
  (t) => `https://${t}.bamboohr.com/careers`,
];

const titleWords = (title: string) =>
  title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The same role, give or take a suffix: "Senior Frontend Engineer" vs "Senior Frontend Engineer - Remote EU". */
export function sameRole(a: string, b: string): boolean {
  const [x, y] = [titleWords(a), titleWords(b)];
  // A suffix of whole words only: "Senior Engineer" isn't "Senior Engineering Manager".
  return x === y || (Math.min(x.length, y.length) >= 12 && (x.startsWith(`${y} `) || y.startsWith(`${x} `)));
}

/** Tokens a company is likely to use on an ATS: the board's slug for it, its name squashed, its name dashed. */
export function likelyTokens(company: string, slug?: string): string[] {
  const dashed = company
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return [...new Set([slug?.toLowerCase(), ...companyKeys(company), dashed])].filter((t): t is string => !!t && /^[a-z0-9-]{2,}$/.test(t));
}

/**
 * Find the ATS board of a company a job board names but doesn't link: try its
 * likely tokens on each ATS we collect. A board that lists one of the roles we
 * found is `confirmed`. Without one, the first board found under the company's
 * name is returned unconfirmed: probably theirs (Fastly's Greenhouse board
 * doesn't title its roles as its HN post does), but it could be another
 * company with the same name, so it's never promoted on its own. Throws on a passing failure
 * (network, 429, 5xx) rather than report "no board".
 */
export async function findAtsBoard(
  company: string,
  slug: string | undefined,
  titles: string[],
): Promise<{ board: Board; url: string; confirmed: boolean } | null> {
  let byName: { board: Board; url: string; confirmed: boolean } | null = null;
  for (const token of likelyTokens(company, slug)) {
    for (const boardUrl of BOARD_URLS) {
      const url = boardUrl(token);
      const board = parseFeedUrl(url);
      const collector = board && collectorFor(board.ats);
      if (!board || !collector) continue;
      try {
        const postings = await collector.fetchPostings(board);
        if (postings.some((p) => titles.some((t) => sameRole(p.title, t)))) return { board, url, confirmed: true };
        if (postings.length && !byName) byName = { board, url, confirmed: false };
      } catch (error) {
        // Every ATS answers an unknown token with a 4xx: no board here. A network failure, a rate limit
        // or a server error says nothing, so the lookup fails and the company is looked up again next scan.
        const passing =
          error instanceof CollectorError &&
          (error.message.startsWith("Request failed") || error.httpStatus === 429 || (error.httpStatus ?? 0) >= 500);
        if (passing) throw error;
      }
    }
  }
  return byName;
}
