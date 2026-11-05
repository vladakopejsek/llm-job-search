import type { NormalizedPosting } from "../../ats/types.ts";
import { isEngineeringTitle } from "../../collect/filter.ts";
import { namesStack } from "../../postings/signals.ts";
import { localTitleWord, screenLocation, screenTitle } from "../../screen/rules.ts";
import { searchConfig } from "../../search-config.ts";
import { SOFTWARE_TITLE } from "../filter.ts";

/**
 * A board role worth recording: a software title, or the candidate's stack in
 * its text, that the screen lets through. Unlike the snapshot, a board gives the
 * whole description, so the location rules can read it too. The title must pass
 * collect's own filter first, or a company watched for this role wouldn't get it.
 */
export function isBoardMatch(p: NormalizedPosting): boolean {
  if (!isEngineeringTitle(p.title) || !screenTitle(p.title).pass) return false;
  if (!SOFTWARE_TITLE.test(p.title) && !localTitleWord(p.title) && !namesStack(p.title, p.descriptionText)) return false;
  return screenLocation(p.locationRaw, p.workplaceRaw, p.descriptionText).pass;
}

/** "Programátor" → "programator": how a URL slug writes a title word. */
const slugOf = (word: string) =>
  word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

let softwareSlug: RegExp | undefined;

/** A job URL's title slug worth reading in full, in English or the local title words (slugs drop diacritics). */
export function isSoftwareSlug(slug: string): boolean {
  softwareSlug ??= new RegExp(
    `(^|-)(software|developer|engineer|front-?end|back-?end|full-?stack|web|react|typescript|javascript|node-?js|tech-lead|cto${searchConfig()
      .titleWords.map((w) => `|${slugOf(w)}\\w*`)
      .join("")})(-|$)`,
  );
  return softwareSlug.test(slug);
}

/** Strong enough to watch the company right away: the role names the candidate's stack. */
export function isStrongMatch(p: NormalizedPosting): boolean {
  return namesStack(p.title, p.descriptionText);
}
