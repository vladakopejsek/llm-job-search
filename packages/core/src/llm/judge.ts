import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { type AnswerBank, answerBankPath } from "../agent/answer-bank.ts";
import type { Problem } from "../agent/attempts.ts";
import type { PrepPack } from "../agent/prep.ts";
import { type CallContext, logged, promptVersion } from "./calls.ts";
import { strictSchema } from "./client.ts";

/** The judge's model, chosen by the judge eval (docs/evals.md). */
const JUDGE_MODEL = "claude-haiku-5-5";

const PROMPT = path.join(import.meta.dirname, "../agent/prompts/judge.md");

/**
 * The claim check's answer. Code verifies quotes are in the cited files; this judge checks
 * that the text says what the evidence says (a quote about a team of 3 cited for "led a
 * team of 10" passes the code check).
 */
const JudgeAnswer = z
  .object({
    claims: z.array(
      z
        .object({
          phrase: z.string().describe("The shortest phrase carrying the claim, copied exactly from the text."),
          verdict: z.enum(["backed", "unsupported", "contradicted"]),
          evidence: z.string().describe('The source that backs it, or what the sources say ("nothing").'),
        })
        .strict(),
    ),
  })
  .strict();
type JudgeAnswer = z.infer<typeof JudgeAnswer>;
export type ClaimProblem = JudgeAnswer["claims"][number];

/**
 * The claims the judge found unbacked. It lists every claim with a verdict and code keeps
 * the rest: deciding each claim in turn stops it listing one it has just called backed.
 */
function claimProblems(answer: JudgeAnswer): ClaimProblem[] {
  return answer.claims.filter((c) => c.verdict !== "backed");
}
const SCHEMA = strictSchema(JudgeAnswer);

/** A part of a pack that makes claims about the candidate, with what it cites. */
export interface ClaimPart {
  section: "whyFit" | "answer" | "coverLetter";
  question?: string;
  text: string;
  factIds: string[];
  sources: { file: string; quote: string }[];
}

type Pack = Pick<PrepPack, "whyFit" | "applicationAnswers" | "coverLetter" | "coverLetterFactIds" | "coverLetterSources">;

/**
 * The parts worth checking: why-fit points, every answer, the cover letter. A choice answer is judged
 * with its `why`: "15" to "Years of TypeScript?" is a claim too.
 */
export function claimParts(pack: Pack): ClaimPart[] {
  return [
    ...pack.whyFit.map((w) => ({ section: "whyFit" as const, text: w.text, factIds: w.factIds, sources: w.sources })),
    ...pack.applicationAnswers.map((a) => ({
      section: "answer" as const,
      question: a.question,
      text: a.why ? `${a.answer}. ${a.why}` : a.answer,
      factIds: a.factIds,
      sources: a.sources,
    })),
    ...(pack.coverLetter
      ? [{ section: "coverLetter" as const, text: pack.coverLetter, factIds: pack.coverLetterFactIds, sources: pack.coverLetterSources }]
      : []),
  ];
}

/** The cited evidence as the judge reads it; null when a cited id is no longer in the Answer bank. */
export function evidenceText(part: ClaimPart, bank: AnswerBank): string | null {
  const lines: string[] = [];
  for (const id of part.factIds) {
    const fact = bank.facts.get(id);
    const story = bank.stories.get(id);
    if (fact) lines.push(`${id}: ${fact}`);
    else if (story) lines.push(`${id}: ${story.title}. ${story.body}`);
    else return null;
  }
  for (const s of part.sources) lines.push(`Quote from ${s.file}: "${s.quote}"`);
  return lines.join("\n") || "(nothing cited)";
}

/** The rubric, then the whole Answer bank: a claim can be true without the part citing it. Cached, so each call pays a tenth for it. */
export async function judgePrompt(): Promise<{ system: string; version: string }> {
  const system = `${await readFile(PROMPT, "utf8")}\n\n# Answer bank\n\n${await readFile(answerBankPath(), "utf8")}`;
  return { system, version: promptVersion(system, SCHEMA) };
}

const SECTION = { whyFit: "A why-I-fit point", answer: "An answer to the form question", coverLetter: "A cover letter" };

export function judgeParams(
  model: string,
  system: string,
  part: Pick<ClaimPart, "section" | "question" | "text">,
  evidence: string,
  effort: Anthropic.OutputConfig["effort"] = "medium",
): Anthropic.MessageCreateParamsNonStreaming {
  const what = part.question ? `${SECTION[part.section]} "${part.question}"` : SECTION[part.section];
  return {
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `${what}.\n\n<cited_evidence>\n${evidence}\n</cited_evidence>\n\n<text>\n${part.text}\n</text>` }],
  };
}

/** What the drafting model is told: where the claim is, what's wrong, and the way out. */
export function problemMessage(part: Pick<ClaimPart, "section" | "question">, claim: ClaimProblem): string {
  const where = part.question
    ? `the answer to "${part.question}"`
    : { whyFit: "a why-fit point", answer: "an answer", coverLetter: "the cover letter" }[part.section];
  return `In ${where}, "${claim.phrase}" is ${claim.verdict}: ${claim.evidence}. Say only what the Answer bank or a cited quote backs.`;
}

/**
 * The judge as a submit check: every claim part of the pack, in parallel, each call logged
 * and priced. It never costs a pack: an error, a refusal or the budget means no problems
 * for that part, and the other parts' findings still count.
 */
export async function reviewPack(
  ctx: CallContext,
  judge: { system: string; version: string },
  bank: AnswerBank,
  postingId: number,
  pack: Pack,
): Promise<Problem[]> {
  const problems = await Promise.all(
    claimParts(pack).map(async (part): Promise<Problem[]> => {
      try {
        const message = await logged(ctx, { kind: "judge", postingId, promptVersion: judge.version }, () =>
          ctx.client.messages.create(
            judgeParams(JUDGE_MODEL, judge.system, part, evidenceText(part, bank) ?? "(an id no longer in the Answer bank)"),
          ),
        );
        if (message.stop_reason !== "end_turn") return [];
        const answer = JudgeAnswer.parse(JSON.parse(message.content.find((b) => b.type === "text")?.text ?? ""));
        return claimProblems(answer).map((claim) => ({ code: "unsupported_claim" as const, message: problemMessage(part, claim) }));
      } catch (error) {
        console.error(`Claim judge skipped a ${part.section} part of posting ${postingId}: ${error instanceof Error ? error.message : error}`);
        return [];
      }
    }),
  );
  return problems.flat();
}
