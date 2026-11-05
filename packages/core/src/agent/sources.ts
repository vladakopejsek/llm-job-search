import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { type SearchConfig, searchConfig } from "../search-config.ts";
import type { AnswerBank } from "./answer-bank.ts";
import { normalizeForQuote } from "./quotes.ts";

/**
 * The candidate's prep material (data/interview-prep, or PROFILE_DIR): the richer
 * source of content for prep packs, next to the Answer bank. Only the files the
 * search config's `profile.include` lists are citable, so notes that record claims
 * which did NOT survive checking stay out. `alwaysRead` files go to every pack; the
 * rest are chosen per role from the index.
 */
type Profile = NonNullable<SearchConfig["profile"]>;
const NO_PROFILE: Profile = { include: [], alwaysRead: [], styleFile: null };

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const profileDir = () => path.resolve(REPO_ROOT, process.env.PROFILE_DIR ?? "data/interview-prep");

interface ProfileIndexEntry {
  file: string;
  /** Rough size, so a subagent can budget what it opens (≈ 4 characters per token). */
  approxTokens: number;
  /** Read for every pack; the others only when they match the role. */
  alwaysRead: boolean;
  title: string;
  headings: string[];
}

export interface ProfileSources {
  dir: string;
  /** What each citable file covers, so a pack reads only what it needs. */
  index: ProfileIndexEntry[];
  /** Relative path → the text a quote may come from. */
  files: Map<string, string>;
  /** Voice reference for tone, not a fact source. */
  styleFile: string | null;
  /** "Don't say" phrases from the files' "Say instead" tables. */
  banned: AnswerBank["banned"];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isSayInstead = (heading: string) => /say instead/i.test(heading);

/**
 * The text a quote may come from: the file without its "don't say" material.
 * In "Say instead" tables only the right-hand ("Say") column stays, and any
 * line marked [!] (the old, wrong version of a claim) is dropped.
 */
export function citableText(markdown: string): string {
  let inSayInstead = false;
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) inSayInstead = isSayInstead(h2[1]!);
    if (line.includes("[!]")) continue;
    if (inSayInstead && line.trim().startsWith("|")) {
      const cells = line.split("|").slice(1, -1);
      out.push(cells.slice(1).join(" | "));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Quoted phrases in the "Don't" column of "Say instead" tables. */
export function dontSayPhrases(markdown: string): string[] {
  let inSayInstead = false;
  const phrases: string[] = [];
  for (const line of markdown.split("\n")) {
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) inSayInstead = isSayInstead(h2[1]!);
    if (!inSayInstead || !line.trim().startsWith("|")) continue;
    const first = line.split("|")[1] ?? "";
    for (const m of first.matchAll(/["“]([^"”]{6,})["”]/g)) phrases.push(m[1]!.trim());
  }
  return phrases;
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `approvedText` is other text known to be correct (the Answer bank). A
 * "don't say" phrase that appears in approved wording ("Stripe checkout" inside
 * "Stripe Checkout and webhooks") can't be banned as a substring; the quote
 * checks still tie drafts to the approved version.
 */
export async function loadProfileSources(
  dir = profileDir(),
  approvedText = "",
  profile: Profile = searchConfig().profile ?? NO_PROFILE,
): Promise<ProfileSources> {
  const sources: ProfileSources = { dir, index: [], files: new Map(), styleFile: null, banned: [] };
  if (!(await exists(dir))) return sources;

  // "projects/" takes every .md in that folder.
  const relative: string[] = [];
  for (const entry of profile.include) {
    if (!entry.endsWith("/")) relative.push(entry);
    else if (await exists(path.join(dir, entry))) {
      for (const f of (await readdir(path.join(dir, entry))).sort()) if (f.endsWith(".md")) relative.push(`${entry}${f}`);
    }
  }
  for (const rel of relative) {
    if (!(await exists(path.join(dir, rel)))) continue;
    const markdown = await readFile(path.join(dir, rel), "utf8");
    sources.files.set(rel, citableText(markdown));
    sources.index.push({
      file: rel,
      approxTokens: Math.round(markdown.length / 4),
      alwaysRead: profile.alwaysRead.includes(rel),
      title: /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? rel,
      // Section headings, minus the "don't say" and meta sections that never feed a pack.
      headings: [...markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim()).filter((h) => !isSayInstead(h)),
    });
    for (const phrase of dontSayPhrases(markdown)) {
      sources.banned.push({ pattern: new RegExp(escapeRegExp(phrase), "i"), label: `"${phrase}"`, note: `"Say instead" in ${rel}` });
    }
  }
  const approved = normalizeForQuote([...sources.files.values(), approvedText].join("\n"));
  sources.banned = sources.banned.filter((b) => !approved.includes(normalizeForQuote(b.label.slice(1, -1))));
  if (profile.styleFile && (await exists(path.join(dir, profile.styleFile)))) sources.styleFile = profile.styleFile;
  return sources;
}
