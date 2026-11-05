/**
 * How much the drafts are rewritten before they're sent (docs/metrics.md, 6):
 * for each sent answer and cover letter that started from a draft, the
 * normalised edit distance between the two. Pure (the browser shows
 * LIGHT_EDIT), so the rule is tested without a database; lab/queries.ts
 * gathers the pairs.
 */
import { median } from "../tracker/stats.ts";

/** Levenshtein distance: the fewest single-character insertions, deletions and substitutions from `a` to `b`. */
export function editDistance(a: string, b: string) {
  if (a.length < b.length) [a, b] = [b, a];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Share of the text changed: edit distance ÷ the longer text's length (0 = sent as drafted, 1 = nothing kept). */
export function rewriteShare(draft: string, sent: string) {
  const d = draft.trim();
  const s = sent.trim();
  const longer = Math.max(d.length, s.length);
  return longer ? editDistance(d, s) / longer : 0;
}

/** Below this share, a draft counts as sent (almost) as written. */
export const LIGHT_EDIT = 0.1;

export function rewriteSummary(pairs: readonly { draft: string; sent: string }[]) {
  const shares = pairs.map((p) => rewriteShare(p.draft, p.sent));
  return {
    n: shares.length,
    median: median(shares),
    /** Share of drafts sent with less than LIGHT_EDIT changed. */
    lightlyEdited: shares.length ? shares.filter((s) => s < LIGHT_EDIT).length / shares.length : null,
  };
}
