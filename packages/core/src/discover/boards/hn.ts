import { z } from "zod";
import { collectorFor, parseFeedUrl } from "../../ats/index.ts";
import { parseResponse } from "../../ats/parse.ts";
import type { Board } from "../../ats/types.ts";
import { isEngineeringTitle } from "../../collect/filter.ts";
import { fetchJson, fetchText } from "../../lib/http.ts";
import { htmlToText } from "../../lib/text.ts";
import { namesStack, withinReach } from "../../postings/signals.ts";
import type { BoardRole, BoardSource } from "./types.ts";

/**
 * Hacker News' monthly "Ask HN: Who is hiring?" thread, through the Algolia HN
 * API. One top-level comment is one company's post, headed
 * "Company | Role | Location | …". About a fifth link the company's ATS; the
 * rest go through the ATS lookup. Posts keep coming all month, so the morning
 * run reads the newest thread again (`--daily`): two requests.
 */
const STORIES = "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10";
const item = (id: string) => `https://hn.algolia.com/api/v1/items/${id}`;

const Stories = z.object({ hits: z.array(z.object({ objectID: z.string(), title: z.string() })) });
const Post = z.object({ id: z.number(), text: z.string().nullish(), created_at: z.string() });
const Thread = z.object({ id: z.number(), children: z.array(Post) });

/** Greenhouse's short links: the board token is only in the URL they redirect to. */
const SHORT_LINK = /^https?:\/\/grnh\.se\//;

export interface HnPost {
  company: string;
  title: string;
  /** The header line: where the role is, in the poster's words. */
  header: string;
  text: string;
  links: string[];
}

/** A post's header split into company, role and the rest; null when no part of it is an engineering role. */
export function parseHnPost(html: string): HnPost | null {
  const [head = ""] = html.split(/<p>/i);
  const header = htmlToText(head).replace(/\s+/g, " ").trim();
  const parts = header.split(/\s+[|—–]\s+|\s+-\s+/).map((p) => p.trim());
  const company = (parts[0] ?? "")
    .replace(/\(.*?\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = parts.slice(1).find((p) => isEngineeringTitle(p));
  if (!company || !title) return null;
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => htmlToText(href!));
  return { company, title, header, text: htmlToText(html), links };
}

/** The company's website name, a likely ATS token: "https://www.prairielearn.com" → "prairielearn". */
export function siteToken(links: string[]): string | undefined {
  for (const link of links) {
    try {
      const host = new URL(link).hostname.replace(/^(www|careers|jobs|apply)\./, "");
      // Forms and job sites the post applies through aren't the company's own site.
      if (
        parseFeedUrl(link) ||
        SHORT_LINK.test(link) ||
        /ycombinator|github|linkedin|google|notion|airtable|wellfound|workatastartup|typeform|tally|calendly/.test(host)
      )
        continue;
      return host.split(".")[0];
    } catch {
      // Not a URL.
    }
  }
  return undefined;
}

async function atsBoardIn(links: string[]): Promise<{ board: Board; url: string } | null> {
  for (const link of links) {
    let url = link;
    if (SHORT_LINK.test(link)) url = (await fetchText(link, "text/html").catch(() => null))?.finalUrl ?? link;
    const board = parseFeedUrl(url);
    if (board && collectorFor(board.ats)) return { board, url };
  }
  return null;
}

export const hnBoard: BoardSource = {
  name: "hn",
  label: "HN Who is hiring",
  daily: true,
  async scan() {
    const { hits } = parseResponse(Stories, await fetchJson(STORIES), "HN stories");
    const story = hits.find((h) => /who is hiring/i.test(h.title));
    if (!story) return { listed: new Set(), roles: [], uncollectable: 0, errors: ["no Who is hiring thread found"] };
    const thread = parseResponse(Thread, await fetchJson(item(story.objectID)), "HN thread");

    const listed = new Set(thread.children.map((c) => `hn:${c.id}`));
    const roles: BoardRole[] = [];
    for (const c of thread.children) {
      const post = c.text ? parseHnPost(c.text) : null;
      // US-heavy: only posts that say they're open to Europe (or worldwide, or name the home country) are worth more.
      if (!post || !withinReach(post.header, post.text)) continue;
      const found = namesStack(post.title, post.text) ? await atsBoardIn(post.links) : null;
      roles.push({
        company: post.company,
        companySlug: siteToken(post.links),
        board: found?.board ?? null,
        companyUrl: found?.url ?? `https://news.ycombinator.com/item?id=${c.id}`,
        postingKey: `hn:${c.id}`,
        posting: {
          externalId: String(c.id),
          url: `https://news.ycombinator.com/item?id=${c.id}`,
          title: post.title,
          locationRaw: post.header,
          workplaceRaw: /\bremote\b/i.test(post.header) ? "remote" : null,
          department: null,
          descriptionText: post.text,
          compensationRaw: null,
          postedAt: new Date(c.created_at),
          raw: null,
        },
      });
    }
    return { listed, roles, uncollectable: 0, errors: [] };
  },
};
