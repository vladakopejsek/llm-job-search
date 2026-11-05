import { z } from "zod";
import { fetchJson } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseResponse } from "./parse.ts";
import type { Board, Collector, NormalizedPosting } from "./types.ts";

const RecruiteeOffer = z.object({
  slug: z.string(),
  title: z.string(),
  careers_url: z.string(),
  location: z.string().nullish(),
  locations: z
    .array(z.object({ name: z.string().nullish(), city: z.string().nullish(), country: z.string().nullish(), note: z.string().nullish() }))
    .nullish(),
  remote: z.boolean().nullish(),
  hybrid: z.boolean().nullish(),
  on_site: z.boolean().nullish(),
  department: z.string().nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  salary: z.unknown().optional(),
  /** "2026-09-14 12:21:25 UTC" — not ISO. */
  published_at: z.string().nullish(),
});

const RecruiteeResponse = z.object({ offers: z.array(z.unknown()) });

const parseUtc = (s: string) => new Date(s.replace(" UTC", "Z").replace(" ", "T"));

export function normalizeRecruitee(response: unknown, board: Pick<Board, "token">): NormalizedPosting[] {
  const { offers } = parseResponse(RecruiteeResponse, response, "Recruitee board");

  return offers.map((raw) => {
    const offer = parseResponse(RecruiteeOffer, raw, "Recruitee offer");
    const locations = [...new Set((offer.locations ?? []).map((l) => [l.name, l.city, l.country].filter(Boolean).join(", ")))];
    // Location notes often carry the eligibility rule ("Candidate should be based in EU").
    const notes = [...new Set((offer.locations ?? []).map((l) => l.note).filter((n): n is string => !!n))];

    return {
      // Recruitee slugs are unique per company only, so the key includes the board.
      externalId: `${board.token}/${offer.slug}`,
      url: offer.careers_url,
      title: offer.title,
      locationRaw: locations.join("; ") || offer.location || null,
      workplaceRaw: offer.remote ? "remote" : offer.hybrid ? "hybrid" : offer.on_site ? "onsite" : null,
      department: offer.department || null,
      descriptionText: [
        offer.description ? htmlToText(offer.description) : "",
        offer.requirements ? htmlToText(offer.requirements) : "",
        notes.length ? `Location notes: ${notes.join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      compensationRaw: offer.salary ?? null,
      postedAt: offer.published_at ? parseUtc(offer.published_at) : null,
      raw,
    };
  });
}

export const recruitee: Collector = {
  ats: "recruitee",
  async fetchPostings(board: Board) {
    return normalizeRecruitee(await fetchJson(`https://${board.host}/api/offers/`), board);
  },
};
