import { createHash } from "node:crypto";
import { compile } from "html-to-text";

// Compiled once: convert() compiles its options on every call, and this runs for every posting of every board.
const toText = compile({
  wordwrap: false,
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
    { selector: "h1", options: { uppercase: false } },
    { selector: "h2", options: { uppercase: false } },
    { selector: "h3", options: { uppercase: false } },
    { selector: "h4", options: { uppercase: false } },
    // Cells render inline by default: "Eligible locations | EU, UK" would become "Eligible locationsEU, UK".
    ...["td", "th", "dt", "dd"].map((selector) => ({ selector, format: "block", options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } })),
  ],
});

/** HTML description → readable plain text (lists, headings and links kept as text). */
export function htmlToText(html: string): string {
  return toText(html).trim();
}

/**
 * Undo one level of HTML escaping. Greenhouse returns its HTML escaped
 * ("&lt;p&gt;"), so it has to be unescaped before it can be converted.
 * Anything still escaped after this (e.g. "&#39;") is real text and
 * htmlToText decodes it.
 */
export function unescapeHtml(escaped: string): string {
  return escaped.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}

/** Stable hash of a description; whitespace differences don't count as a change. */
export function contentHash(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/** Notion returns rich text as markdown: "[acme.com](http://acme.com)", "a \\| b". */
export function notionPlainText(value: string): string {
  return value
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([|~$*_[\]()#>`-])/g, "$1")
    .trim();
}
