/**
 * Search snippets from Postgres (ts_headline) mark matches with these two
 * characters instead of HTML tags. Posting text is scraped from other sites, so
 * the page must never render a snippet as HTML; it splits on the markers and
 * renders each hit as a <mark> element instead.
 */
export const HL_START = "⟦";
export const HL_END = "⟧";

export interface Segment {
  text: string;
  hit: boolean;
}

export function splitHighlights(snippet: string): Segment[] {
  const segments: Segment[] = [];
  let rest = snippet;
  while (rest) {
    const start = rest.indexOf(HL_START);
    const end = start === -1 ? -1 : rest.indexOf(HL_END, start + 1);
    if (start === -1 || end === -1) {
      segments.push({ text: rest.replaceAll(HL_START, "").replaceAll(HL_END, ""), hit: false });
      break;
    }
    if (start > 0) segments.push({ text: rest.slice(0, start), hit: false });
    segments.push({ text: rest.slice(start + 1, end), hit: true });
    rest = rest.slice(end + 1);
  }
  return segments.filter((s) => s.text);
}
