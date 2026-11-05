import { parseFeedUrl } from "../ats/feed-url.ts";
import { namesWorkdayPlace } from "../ats/workday.ts";
import { mentionsEuropeOrRemote, namesHome, screenLocation, screenTitle } from "../screen/rules.ts";
import type { SnapshotJob } from "./snapshot.ts";

/**
 * The snapshot covers every kind of company, so "engineer" alone lets in
 * facade and fire engineers. Discovery requires a positive software signal on
 * top of the normal screen. (Watched companies don't need this: their boards
 * are already software companies.)
 */
export const SOFTWARE_TITLE =
  /\b(software|front[\s-]?end|full[\s-]?stack|fullstack|back[\s-]?end|web|product engineer|design engineer|ui engineer|typescript|javascript|react|node(\.?js)?|developer|ai engineer|applied ai|founding engineer)\b/i;

/** ATS-hosted boards of job aggregators and recruiters; they repost other companies' roles. */
const AGGREGATORS = new Set(["jobgether"]);

/** The snapshot's ATSs we have collectors for (it writes them "Workday", "BambooHR"). */
const ATS_WE_COLLECT = new Set(["ashby", "greenhouse", "lever", "workday", "bamboohr"]);

/**
 * Workday tenants run sites for employees, invitations and confidential
 * searches next to their public one. In the snapshot: PwC's
 * "nonpublic_postings" (4,710 jobs), GE Vernova's
 * "only_confidential_executive_recruiting", J&J's "displacedemployees",
 * Novartis' "internal_careers_for_acquired_entities", NTT's
 * "internal_employees_not_on_workday", "inviteonly", "referrals". Their jobs
 * repeat the public site's or aren't open to outsiders.
 */
const INTERNAL_WORKDAY_SITE = /internal|nonpublic|employee|private|confidential|displaced|redeploy|invite|referral|restricted|hidden/i;

export function isDiscoverable(job: SnapshotJob): boolean {
  if (job.is_recruiter || AGGREGATORS.has(job.company.toLowerCase())) return false;
  const ats = job.ats.toLowerCase();
  if (!ATS_WE_COLLECT.has(ats)) return false;
  if (job.skill_level && ["intern", "entry", "junior"].includes(job.skill_level)) return false;
  if (!SOFTWARE_TITLE.test(job.title)) return false;
  if (!screenTitle(job.title).pass) return false;
  const location = job.location ?? null;
  if (ats === "workday") {
    // The Workday collector reads only jobs in the configured countries: a company
    // found for "Remote, Germany" would never have anything collected.
    if (!namesHome(location) && !namesWorkdayPlace(location)) return false;
    const site = parseFeedUrl(job.url)?.token.split("/")[1];
    if (!site || INTERNAL_WORKDAY_SITE.test(site)) return false;
  }
  // No description here, so the location must itself point at Europe or remote work.
  return mentionsEuropeOrRemote(location) && screenLocation(location, null).pass;
}
