import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { desc } from "drizzle-orm";
import { z } from "zod";
import type { AnswerBank } from "../agent/answer-bank.ts";
import type { Db } from "../db/client.ts";
import { prepPacks } from "../db/schema.ts";
import { strictSchema } from "../llm/client.ts";
import { type ClaimPart, type ClaimProblem, claimParts, evidenceText } from "../llm/judge.ts";
import { type BatchRow, parseJson, productionPrice, readJsonl, readMeta, repoPath, runPath } from "./batch.ts";
import { type Rate, wilson } from "./grade.ts";

/** What gets planted, in turn, so every kind of error is tested about equally often. */
const KINDS = {
  number: "change a number, duration, amount or count about the candidate (or add one)",
  technology: "add a technology, language or tool the candidate supposedly used",
  achievement: "add a result, responsibility or achievement the candidate supposedly had",
  employer: "change an employer, job title, product or domain the candidate worked in",
} as const;
type Kind = keyof typeof KINDS;

/** A pack part twice: as stored, and with one planted error the evidence doesn't back. */
export interface JudgeCase {
  id: string;
  section: ClaimPart["section"];
  question?: string;
  evidence: string;
  clean: string;
  planted: string;
  /** The planted phrase, exactly as it appears in `planted`. */
  plantedPhrase: string;
  kind: Kind;
}

const PLANT_SYSTEM = `You help test a fact checker for job applications. You get a text written about a candidate and the evidence it cites. Make exactly one change that puts in a claim about the candidate the evidence does not support, as a careless writer might: plausible, specific and subtle, in the text's own voice. Keep every other word as it is. Return the whole changed text, and the changed or added phrase exactly as it now appears in it (a few words, at most a sentence).`;
const Plant = z.object({ modified: z.string(), changed: z.string() }).strict();

/** Stable pseudo-random order: the same parts are drawn every time. */
const shuffleKey = (s: string) => createHash("md5").update(s).digest("hex");

/** Up to `quota` parts of each section with checkable evidence, from each posting's latest pack. */
export async function sampleParts(db: Db, bank: AnswerBank, quota: Record<ClaimPart["section"], number>) {
  const rows = await db.select({ postingId: prepPacks.postingId, content: prepPacks.content }).from(prepPacks).orderBy(desc(prepPacks.createdAt));
  const latest = new Map<number, unknown>();
  for (const r of rows) if (!latest.has(r.postingId)) latest.set(r.postingId, r.content);
  const parts = [...latest].flatMap(([postingId, pack]) =>
    claimParts(pack as Parameters<typeof claimParts>[0]).flatMap((part, i) => {
      const evidence = evidenceText(part, bank);
      // A part citing an id the Answer bank no longer has can't be judged fairly.
      return evidence ? [{ id: `pack${postingId}-${i}`, part, evidence }] : [];
    }),
  );
  parts.sort((a, b) => shuffleKey(a.id).localeCompare(shuffleKey(b.id)));
  return (Object.keys(quota) as ClaimPart["section"][]).flatMap((s) => parts.filter((p) => p.part.section === s).slice(0, quota[s]));
}

export function plantParams(model: string, part: ClaimPart, evidence: string, kind: Kind): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16000,
    system: PLANT_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: strictSchema(Plant) } },
    messages: [{ role: "user", content: `The change: ${KINDS[kind]}.\n\n<evidence>\n${evidence}\n</evidence>\n\n<text>\n${part.text}\n</text>` }],
  };
}

export const kindOf = (i: number) => (Object.keys(KINDS) as Kind[])[i % 4]!;

/** A planted error the checks can trust: the text changed, and the phrase is new and in it. Otherwise null. */
export function acceptPlant(clean: string, output: string | null): { planted: string; plantedPhrase: string } | null {
  const parsed = Plant.safeParse(parseJson(output));
  if (!parsed.success) return null;
  const { modified, changed } = parsed.data;
  if (modified === clean || !modified.includes(changed) || clean.includes(changed)) return null;
  // One change, not a rewrite.
  if (Math.abs(modified.length - clean.length) > Math.max(200, clean.length * 0.3)) return null;
  return { planted: modified, plantedPhrase: changed };
}

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}€$%.+#]+/gu) ?? []);

/** A flag catches the plant when it covers at least half of the planted phrase's words. */
export function overlaps(flag: string, planted: string): boolean {
  const p = words(planted);
  const f = words(flag);
  return p.size > 0 && [...p].filter((w) => f.has(w)).length / p.size >= 0.5;
}

type Problem = Pick<ClaimProblem, "phrase" | "evidence"> & { verdict?: string; kind?: string };

/**
 * The flagged claims, or null when the judge gave no answer. Structured output guarantees the
 * shape, so this reads both answer formats: `claims` with a verdict each (judge v3 on), and the
 * older `problems` list (v1, v2), keeping their stored runs comparable.
 */
function problemsOf(row: BatchRow): Problem[] | null {
  if (row.stopReason !== "end_turn") return null;
  const answer = parseJson(row.output) as { claims?: Problem[]; problems?: Problem[] } | null;
  return answer?.claims?.filter((c) => c.verdict !== "backed") ?? answer?.problems ?? null;
}

const pct = (r: Rate) =>
  r.n
    ? `${Math.round((100 * r.k) / r.n)}% (${wilson(r)
        .map((x) => Math.round(100 * x))
        .join("–")}%)`
    : "–";

/**
 * Judges compared on the same parts: planted errors caught, untouched parts flagged, and
 * flags beside the planted one. A flag on an untouched part is either a real problem in a
 * stored pack or a false alarm, so those are listed for a person to read.
 */
export async function judgeReport(names: string[]): Promise<string[]> {
  const metas = await Promise.all(names.map(readMeta));
  const cases = new Map((await readJsonl<JudgeCase>(repoPath(metas[0]!.dataset))).map((c) => [c.id, c]));
  const lines = [
    `Dataset: ${metas[0]!.dataset}, ${cases.size} parts, each judged as stored and with one planted error.`,
    "",
    "| Judge | Planted caught | number | technology | achievement | employer | Untouched parts flagged | Other flags per planted part | No answer | $ per part |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const review: string[] = [];
  for (const meta of metas) {
    const rows = await readJsonl<BatchRow>(runPath(meta.name, ".jsonl"));
    const caught: Rate = { k: 0, n: 0 };
    const byKind = Object.fromEntries(Object.keys(KINDS).map((k) => [k, { k: 0, n: 0 }])) as Record<Kind, Rate>;
    const flaggedClean: Rate = { k: 0, n: 0 };
    let extra = 0;
    let none = 0;
    const missed: string[] = [];
    for (const row of rows) {
      const problems = problemsOf(row);
      const c = cases.get(row.caseId.slice(0, -1))!;
      if (!problems) {
        none++;
        continue;
      }
      if (row.caseId.endsWith("c")) {
        flaggedClean.n++;
        if (problems.length) {
          flaggedClean.k++;
          if (row.rep === 0)
            for (const p of problems)
              review.push(`- ${meta.name} · ${c.id} (${c.section}): "${p.phrase}" (${p.verdict ?? p.kind}; evidence: ${p.evidence})`);
        }
        continue;
      }
      const hit = problems.some((p) => overlaps(p.phrase, c.plantedPhrase));
      caught.n++;
      byKind[c.kind].n++;
      if (hit) {
        caught.k++;
        byKind[c.kind].k++;
      } else if (row.rep === 0) missed.push(`- ${c.id} (${c.kind}): planted "${c.plantedPhrase}"`);
      extra += problems.filter((p) => !overlaps(p.phrase, c.plantedPhrase)).length;
    }
    // Reps of one part are correlated: the interval counts parts.
    const perPart = (r: Rate): Rate => ({ k: r.k / meta.reps, n: r.n / meta.reps });
    const cost = productionPrice(rows) / rows.length;
    lines.push(
      `| ${meta.name} (${meta.model.replace("claude-", "")}) | ${pct(perPart(caught))} | ${(Object.keys(KINDS) as Kind[]).map((k) => pct(perPart(byKind[k]))).join(" | ")} | ${pct(perPart(flaggedClean))} | ${(extra / Math.max(1, caught.n)).toFixed(2)} | ${none} | $${cost.toFixed(4)} |`,
    );
    if (missed.length) lines.push("", `${meta.name} missed (first rep):`, ...missed.slice(0, 12), "");
  }
  if (review.length) lines.push("", "Flags on untouched parts, to read: a real problem in a stored pack, or a false alarm?", ...review.slice(0, 40));
  return lines;
}
