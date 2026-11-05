/**
 * Does a quote really appear in the posting? This is the hallucination guard:
 * a model can paraphrase or invent a sentence, and code catches it with a
 * substring check.
 *
 * Normalisation forgives what copying legitimately changes (case, whitespace,
 * curly quotes, dashes, bullet markers, emoji) but nothing else. A quote may join
 * separate passages with "..." or "…"; each passage must appear, in order.
 */
export function normalizeForQuote(text: string): string {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‘’´`]/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/[‐-―−]/g, "-")
      .replace(/[•·*]/g, " ")
      // "🌐 Webová aplikace": a copy that drops the decoration is still the same words.
      .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function quoteFound(quote: string, text: string): boolean {
  const haystack = normalizeForQuote(text);
  const parts = quote
    .split(/\.\.\.|…/)
    .map((p) => normalizeForQuote(p).replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, ""))
    .filter((p) => p.length > 0);
  if (!parts.length) return false;

  let from = 0;
  for (const part of parts) {
    const at = haystack.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}
