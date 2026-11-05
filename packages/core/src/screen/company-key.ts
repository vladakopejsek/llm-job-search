/**
 * Normalised keys for a company name, so one company matches across sources:
 * names as people write them ("Hoolí Group", "INITECH'S LAB", "Acme.com",
 * "Globex s.r.o.", "Umbrella GmbH") and ATS slugs ("hooli", "initechslab",
 * "acme", "globex", "umbrella").
 *
 * Two keys, because no single normalisation works for both kinds: a strict
 * key keeps every word ("initechslab" matches the slug), a loose key also drops
 * generic words ("hooli" matches the slug). Two names match if any key does.
 */
// Only at the end of a name: "AG Grid" and "SE Ranking" keep their first word.
const LEGAL_FORM = /\b(inc|ltd|llc|gmbh|ag|sa|sas|bv|oy|ab|a\.?s\.?|s\.?r\.?o\.?|plc|se)\b\.?\s*$/;
const GENERIC_WORD = /\b(group|labs?|technologies|technology|tech|hq|software|app|ai|io|global)\b/g;

function base(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Hoolí → Hooli
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\.(com|io|ai|co|dev|app|so|org|net|de|cz)\b/g, " ")
    .replace(LEGAL_FORM, " ");
}

const squash = (s: string) => s.replace(/[^a-z0-9]/g, "");

export function companyKeys(name: string): string[] {
  const b = base(name);
  const strict = squash(b);
  const loose = squash(b.replace(GENERIC_WORD, " "));
  return [...new Set([strict, loose].filter((k) => k.length >= 2))];
}
