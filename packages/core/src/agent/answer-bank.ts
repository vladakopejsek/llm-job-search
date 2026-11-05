import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The Answer bank: the only facts a prep pack may use. A markdown file the
 * candidate edits by hand (data/answer-bank.md, gitignored; override with
 * ANSWER_BANK_PATH). Sections:
 *
 *   ## Profile            free text, used for fit scoring
 *   ## Facts              - [fact.some.id] One verified fact.
 *   ## Stories            ### [story.some.id] Title, then paragraphs
 *   ## Gaps               - [gap.some.id] Something never to claim.
 *   ## Banned phrasings   - "exact phrase" — note   or   - /regex/flags — note
 */
export interface AnswerBank {
  profile: string;
  facts: Map<string, string>;
  stories: Map<string, { title: string; body: string }>;
  gaps: Map<string, string>;
  banned: { pattern: RegExp; label: string; note: string }[];
}

export class AnswerBankError extends Error {
  constructor(readonly problems: string[]) {
    super(`Answer bank has ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join("\n")}`);
  }
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const answerBankPath = () => path.resolve(REPO_ROOT, process.env.ANSWER_BANK_PATH ?? "data/answer-bank.md");

export async function loadAnswerBank(file = answerBankPath()): Promise<AnswerBank> {
  return parseAnswerBank(await readFile(file, "utf8"));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The `## Profile` section alone: the candidate fit is scored for. Evaluation reads
 * only this, so a bad line elsewhere in the bank can't stop it.
 */
export function readProfile(markdown: string): string {
  const lines = markdown.split("\n").map((l) => l.trimEnd());
  const start = lines.findIndex((l) => /^##\s+profile$/i.test(l));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

export function parseAnswerBank(markdown: string): AnswerBank {
  const bank: AnswerBank = { profile: "", facts: new Map(), stories: new Map(), gaps: new Map(), banned: [] };
  const problems: string[] = [];
  const seen = new Set<string>();
  const addId = (id: string, line: number) => {
    if (seen.has(id)) problems.push(`line ${line}: duplicate id ${id}`);
    seen.add(id);
  };

  let section = "";
  let story: { id: string; title: string; body: string[] } | null = null;
  const closeStory = () => {
    if (story) bank.stories.set(story.id, { title: story.title, body: story.body.join("\n").trim() });
    story = null;
  };

  markdown.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const n = i + 1;
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      closeStory();
      section = h2[1]!.trim().toLowerCase();
      return;
    }

    if (section === "facts") {
      const m = /^-\s+\[(fact\.[a-z0-9_.-]+)\]\s+(.+)$/.exec(line);
      if (m) {
        addId(m[1]!, n);
        bank.facts.set(m[1]!, m[2]!.trim());
      } else if (/^-\s/.test(line)) problems.push(`line ${n}: fact without an id like [fact.area.name]`);
    } else if (section === "stories") {
      const h3 = /^###\s+\[(story\.[a-z0-9_.-]+)\]\s+(.+)$/.exec(line);
      if (h3) {
        closeStory();
        addId(h3[1]!, n);
        story = { id: h3[1]!, title: h3[2]!.trim(), body: [] };
      } else if (/^###\s/.test(line)) problems.push(`line ${n}: story heading without an id like [story.area.name]`);
      else if (story) (story as { body: string[] }).body.push(line);
    } else if (section === "gaps") {
      const m = /^-\s+\[(gap\.[a-z0-9_.-]+)\]\s+(.+)$/.exec(line);
      if (m) {
        addId(m[1]!, n);
        bank.gaps.set(m[1]!, m[2]!.trim());
      }
    } else if (section === "banned phrasings") {
      const phrase = /^-\s+"([^"]+)"(?:\s+[—-]\s+(.+))?$/.exec(line);
      const regex = /^-\s+\/(.+)\/([a-z]*)(?:\s+[—-]\s+(.+))?$/.exec(line);
      if (phrase) {
        bank.banned.push({ pattern: new RegExp(escapeRegExp(phrase[1]!), "i"), label: `"${phrase[1]}"`, note: phrase[2] ?? "" });
      } else if (regex) {
        try {
          // No g/y flags: they make RegExp.test() stateful and skip matches.
          const flags = (regex[2] ?? "").replace(/[gy]/g, "");
          bank.banned.push({ pattern: new RegExp(regex[1]!, flags), label: `/${regex[1]}/${regex[2]}`, note: regex[3] ?? "" });
        } catch (error) {
          problems.push(`line ${n}: invalid regex (${error instanceof Error ? error.message : error})`);
        }
      } else if (/^-\s/.test(line)) problems.push(`line ${n}: banned phrasing must be "a phrase" or /a regex/`);
    }
  });
  closeStory();

  bank.profile = readProfile(markdown);
  if (!bank.profile) problems.push("missing ## Profile section");
  if (!bank.facts.size) problems.push("no facts found under ## Facts");
  if (problems.length) throw new AnswerBankError(problems);
  return bank;
}

/** All of the bank's approved wording, for checks that need to know what's allowed. */
export function approvedText(bank: AnswerBank): string {
  return [bank.profile, ...bank.facts.values(), ...[...bank.stories.values()].map((s) => `${s.title}\n${s.body}`)].join("\n");
}

/** Ids a prep pack may cite: facts and stories. */
export function citableIds(bank: AnswerBank): Set<string> {
  return new Set([...bank.facts.keys(), ...bank.stories.keys()]);
}
