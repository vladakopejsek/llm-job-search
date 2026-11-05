import { workdaySite } from "../ats/feed-url.ts";
import type { Ats } from "../ats/types.ts";

/**
 * A stable identity for a job posting, independent of which URL form was used.
 *
 * Ashby and Lever job ids are UUIDs and Greenhouse ids are global numbers, so
 * "<ats>:<id>" identifies a posting across every URL variant: the API URL,
 * the hosted board, an EU host, an "/application" suffix, or a company careers
 * page embedding the board with ?gh_jid=. Other URLs fall back to a
 * normalised form of the URL itself.
 */
export function postingKeyFromUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid)) return postingKey("greenhouse", ghJid);

  if (host.endsWith("ashbyhq.com")) {
    const id = segments.find((s) => UUID.test(s));
    if (id) return postingKey("ashby", id);
  }
  if (host.endsWith("greenhouse.io")) {
    const i = segments.indexOf("jobs");
    const id = i >= 0 ? segments[i + 1] : undefined;
    if (id && /^\d+$/.test(id)) return postingKey("greenhouse", id);
  }
  if (host.endsWith("lever.co")) {
    const id = segments.find((s) => UUID.test(s));
    if (id) return postingKey("lever", id);
  }
  if (host === "apply.workable.com") {
    // apply.workable.com/j/<shortcode> or /<account>/j/<shortcode>; shortcodes are global.
    const i = segments.indexOf("j");
    const id = i >= 0 ? segments[i + 1] : undefined;
    if (id) return postingKey("workable", id);
  }
  if (host.endsWith(".teamtailor.com")) {
    const id = /\/jobs\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return postingKey("teamtailor", id);
  }
  if (/\.jobs\.personio\.(de|com)$/.test(host)) {
    const id = /\/job\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return postingKey("personio", id);
  }
  if (host.endsWith(".recruitee.com")) {
    // Recruitee slugs are unique per company only, so the key includes the subdomain.
    const i = segments.indexOf("o");
    const slug = i >= 0 ? segments[i + 1] : undefined;
    if (slug) return postingKey("recruitee", `${host.split(".")[0]}/${slug}`);
  }
  if (host.endsWith(".bamboohr.com")) {
    // /careers/<id>, /careers/<id>/detail, or the old /jobs/view.php?id=<id>, which redirects there.
    // Ids count up per company, so the key includes the subdomain.
    const id = /^\/careers\/(\d+)/.exec(url.pathname)?.[1] ?? (url.pathname === "/jobs/view.php" ? url.searchParams.get("id") : null);
    if (id && /^\d+$/.test(id)) return postingKey("bamboohr", `${host.split(".")[0]}/${id}`);
  }
  if (/^startupjobs\.(cz|com)$/.test(host)) {
    // /nabidka/<id>/<slug>; the slug follows the title and can change.
    const id = /\/nabidka\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return postingKey("startupjobs", id);
  }
  const workday = workdaySite(url);
  if (workday) {
    // …/<site>/job/<location>/<posting>[/apply]. The posting ("R-D-Engineer_JR00044029") is unique
    // per tenant, so the key is tenant + posting, whatever site, locale or domain the URL uses.
    const at = workday.rest.findIndex((s) => s === "job" || s === "details");
    const job = at < 0 ? [] : workday.rest.slice(at + 1);
    const posting = (job.includes("apply") ? job.slice(0, job.indexOf("apply")) : job).at(-1);
    if (posting) return postingKey("workday", `${workday.tenant}/${posting}`);
  }

  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  return `url:${host}${path}`;
}

export function postingKey(ats: Ats, externalId: string): string {
  return `${ats}:${externalId.toLowerCase()}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
