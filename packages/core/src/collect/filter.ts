import { localTitleWord } from "../screen/rules.ts";

/**
 * Coarse first cut, applied before anything is stored: is this an engineering
 * role at all? Deliberately broad. The precise title rules (seniority,
 * management, mobile, data…) are a later step.
 *
 * Local boards title roles in the local language ("programador", "desenvolvedora"):
 * the search config's title words count too. A title that names the stack counts
 * as well: "Node.js & JavaScript Builder". So do titles with no engineering word: "Tech
 * Lead", "Member of Technical Staff", "Dev Team Lead", "Product Builder" (a bare "Team
 * Lead" or "Builder" could be sales).
 */
const ENGINEERING_TITLE =
  /\b(engineer(ing)?|developer|programmer|software|swe|full[\s-]?stack|front[\s-]?end|back[\s-]?end|typescript|javascript|node\.?js|react|next\.?js|tech(nical)?[\s-]?lead(er)?s?|technical staff|dev|product builder)\b/i;

export function isEngineeringTitle(title: string): boolean {
  return ENGINEERING_TITLE.test(title) || localTitleWord(title);
}
