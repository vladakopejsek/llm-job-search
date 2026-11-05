import { z } from "zod";
import { fetchText } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseXml } from "../lib/xml.ts";
import { parseResponse } from "./parse.ts";
import { type Board, type Collector, CollectorError, type NormalizedPosting } from "./types.ts";

const TeamtailorItem = z.object({
  title: z.string(),
  link: z.string(),
  /** HTML; the XML parser has already undone the escaping. */
  description: z.string().optional(),
  pubDate: z.string().optional(),
  /** none | hybrid | temporary | fully */
  remoteStatus: z.string().optional(),
  "tt:locations": z
    .object({
      "tt:location": z.array(z.object({ "tt:name": z.string().optional(), "tt:city": z.string().optional(), "tt:country": z.string().optional() })),
    })
    .or(z.literal(""))
    .optional(),
  "tt:department": z.string().optional(),
});

const TeamtailorRss = z.object({
  rss: z.object({ channel: z.object({ item: z.array(z.unknown()).optional() }) }),
});

/**
 * Teamtailor's "none" means the company didn't mark the role remote, which is
 * not the same as "on-site", so it maps to unknown and the text decides.
 */
const WORKPLACE: Record<string, string | null> = { fully: "remote", temporary: "remote", hybrid: "hybrid", none: null };

export function normalizeTeamtailor(rss: string): NormalizedPosting[] {
  const parsed = parseResponse(TeamtailorRss, parseXml(rss, ["item", "tt:location"], "Teamtailor feed"), "Teamtailor feed");

  return (parsed.rss.channel.item ?? []).map((raw) => {
    const item = parseResponse(TeamtailorItem, raw, "Teamtailor job");
    // The numeric id in the link ("/jobs/7979084-warehouse-associate") is stable; the slug after it isn't.
    const id = /\/jobs\/(\d+)/.exec(item.link)?.[1];
    if (!id) throw new CollectorError(`Teamtailor job without an id in its link: ${item.link}`);
    const locations = item["tt:locations"] ? item["tt:locations"]["tt:location"] : [];

    return {
      externalId: id,
      url: item.link,
      title: item.title,
      locationRaw: [...new Set(locations.map((l) => [l["tt:city"] ?? l["tt:name"], l["tt:country"]].filter(Boolean).join(", ")))].join("; ") || null,
      workplaceRaw: WORKPLACE[item.remoteStatus ?? "none"] ?? null,
      department: item["tt:department"] || null,
      descriptionText: item.description ? htmlToText(item.description) : "",
      compensationRaw: null,
      postedAt: item.pubDate ? new Date(item.pubDate) : null,
      raw,
    };
  });
}

export const teamtailor: Collector = {
  ats: "teamtailor",
  async fetchPostings(board: Board) {
    const { body } = await fetchText(`https://${board.host}/jobs.rss`, "application/rss+xml, application/xml");
    return normalizeTeamtailor(body);
  },
};
