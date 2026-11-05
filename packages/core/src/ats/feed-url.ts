import type { Ats, Board } from "./types.ts";

interface Pattern {
  ats: Board["ats"];
  host: RegExp;
  /** Where the board token is: a path segment, or a subdomain. */
  token: (url: URL) => string | undefined;
  apiHost: (url: URL) => string;
}

const pathToken = (path: RegExp) => (url: URL) => path.exec(url.pathname)?.[1];
const subdomainToken = (url: URL) => url.hostname.split(".")[0];

const WORKDAY_HOST = /^([a-z0-9-]+\.wd\d+\.myworkdayjobs|wd\d+\.myworkdaysite)\.com$/;
const LOCALE = /^[a-z]{2}-[a-z]{2}$/i;

/**
 * The tenant and site of a Workday career-site URL, and the path after the
 * site (where a job URL names its posting). Every form we've seen:
 *   redhat.wd5.myworkdayjobs.com/jobs, …/en-US/Procore_External_Careers
 *   abb.wd3.myworkdayjobs.com/external_career_page/job/Lisbon-Portugal/R-D-Engineer_JR00044029
 *   wd3.myworkdaysite.com/en-US/recruiting/<tenant>/<site>/…, Workday's second domain
 *   <either host>/wday/cxs/<tenant>/<site>/jobs, the JSON API the site itself calls
 */
export function workdaySite(url: URL): { tenant: string; site: string; rest: string[] } | null {
  const host = url.hostname.toLowerCase();
  if (!WORKDAY_HOST.test(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  let parts: string[];
  if (segments[0] === "wday" && segments[1] === "cxs") parts = segments.slice(2);
  else {
    const path = segments.slice(LOCALE.test(segments[0] ?? "") ? 1 : 0);
    if (host.endsWith(".myworkdaysite.com")) parts = path[0] === "recruiting" ? path.slice(1) : [];
    else parts = [host.slice(0, host.indexOf(".")), ...path];
  }
  const [tenant, site, ...rest] = parts;
  return tenant && site ? { tenant, site, rest } : null;
}

// Both the API URL and the human board URL are accepted, since the Watchlist has a mix.
const PATTERNS: Pattern[] = [
  {
    ats: "ashby",
    host: /^(api|jobs)\.ashbyhq\.com$/,
    token: pathToken(/^\/(?:posting-api\/job-board\/)?([^/?#]+)/),
    apiHost: () => "api.ashbyhq.com",
  },
  {
    ats: "greenhouse",
    host: /^(boards-api|boards|job-boards)(\.eu)?\.greenhouse\.io$/,
    // An embedded board names its company in ?for= (boards.greenhouse.io/embed/job_app?for=acme).
    token: (url) =>
      url.pathname.startsWith("/embed/") ? (url.searchParams.get("for") ?? undefined) : pathToken(/^\/(?:v1\/boards\/)?([^/?#]+)/)(url),
    // EU boards (job-boards.eu.greenhouse.io) are served by the same API; there is no boards-api.eu host.
    apiHost: () => "boards-api.greenhouse.io",
  },
  {
    ats: "lever",
    host: /^(api|jobs)(\.eu)?\.lever\.co$/,
    token: pathToken(/^\/(?:v0\/postings\/)?([^/?#]+)/),
    apiHost: (url) => (url.hostname.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co"),
  },
  {
    ats: "workable",
    host: /^apply\.workable\.com$/,
    // /api/v1/widget/accounts/<token> or /<token>/ — but not /j/<shortcode> (a single job).
    token: (url) => /^\/(?:api\/v1\/widget\/accounts\/)?(?!j\/|api\/)([^/?#]+)/.exec(url.pathname)?.[1],
    apiHost: () => "apply.workable.com",
  },
  {
    ats: "teamtailor",
    host: /^[a-z0-9-]+\.teamtailor\.com$/,
    token: subdomainToken,
    apiHost: (url) => url.hostname,
  },
  {
    ats: "personio",
    host: /^[a-z0-9-]+\.jobs\.personio\.(de|com)$/,
    token: subdomainToken,
    apiHost: (url) => url.hostname,
  },
  {
    ats: "recruitee",
    host: /^[a-z0-9-]+\.recruitee\.com$/,
    token: subdomainToken,
    apiHost: (url) => url.hostname,
  },
  {
    ats: "bamboohr",
    // <company>.bamboohr.com/careers, /careers/list, or one of its jobs; www and api are BambooHR's own hosts.
    host: /^(?!www\.|api\.)[a-z0-9-]+\.bamboohr\.com$/,
    token: subdomainToken,
    apiHost: (url) => url.hostname,
  },
  {
    ats: "startupjobs",
    // The company page, www.startupjobs.cz/startup/<slug>; startupjobs.com is the same site in English.
    host: /^(www\.)?startupjobs\.(cz|com)$/,
    token: pathToken(/^\/startup\/([^/?#]+)/),
    apiHost: () => "www.startupjobs.cz",
  },
  {
    ats: "workday",
    host: WORKDAY_HOST,
    // A tenant often has several sites, and many tenants name theirs "External"
    // or "jobs", so the board is the pair: "redhat/jobs", "abb/external_career_page".
    token: (url) => {
      const site = workdaySite(url);
      return site ? `${site.tenant}/${site.site}` : undefined;
    },
    apiHost: (url) => url.hostname,
  },
];

/**
 * Feed or board URL → the board to fetch, or null if it isn't a supported ATS.
 *
 * `atsHint` covers boards on a company's own domain: Teamtailor serves
 * careers.swappie.com/jobs.rss, which the URL alone can't identify.
 */
export function parseFeedUrl(input: string | null | undefined, atsHint?: Ats): Board | null {
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  for (const pattern of PATTERNS) {
    if (!pattern.host.test(host)) continue;
    const token = pattern.token(url);
    if (!token) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(token);
    } catch {
      return null; // a malformed escape ("acme%"): not a board, and not worth failing a whole scan over
    }
    return { ats: pattern.ats, token: decoded, host: pattern.apiHost(url) };
  }

  if (atsHint === "teamtailor" && url.pathname.replace(/\/+$/, "").endsWith("/jobs.rss")) {
    return { ats: "teamtailor", token: host, host };
  }
  return null;
}
