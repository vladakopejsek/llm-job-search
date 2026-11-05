/**
 * Evals (docs/evals.md). Model calls go through the Message Batches API at half price;
 * `--direct` sends them one by one at full price instead, for when the batch queue is slow.
 *
 * The model comparison: the evaluation prompt on postings the candidate already decided.
 *   pnpm eval dataset [--sample 100] [--out data/evals/evaluation-v1.jsonl]     freeze the cases (once per version)
 *   pnpm eval run --name haiku-medium --model claude-haiku-5-5 [--effort medium] [--reps 2] [--dataset …] [--direct]
 *   pnpm eval report opus-medium haiku-medium …                                 the reference run first
 *
 * The pack judge: stored pack parts, as they are and with one planted error.
 *   pnpm eval judge-dataset [--parts 150] [--out data/evals/judge-v1.jsonl]     sample and plant (Opus)
 *   pnpm eval judge-run --name judge-sonnet --model claude-sonnet-5-5 [--reps 2] [--dataset …] [--direct]
 *   pnpm eval judge-report judge-opus judge-sonnet …
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadAnswerBank } from "../agent/answer-bank.ts";
import { createDb } from "../db/client.ts";
import { type BatchRequest, EVALS_DIR, type RunMeta, readJsonl, repoRelative, runBatch, writeJsonl } from "../evals/batch.ts";
import { buildDataset, describeDataset } from "../evals/dataset.ts";
import type { EvalCase } from "../evals/grade.ts";
import { acceptPlant, type JudgeCase, judgeReport, kindOf, plantParams, sampleParts } from "../evals/judge.ts";
import { evalReport } from "../evals/report.ts";
import { PRICES } from "../llm/calls.ts";
import { createClient, MODEL } from "../llm/client.ts";
import { evaluationParams, evaluationPrompt, postingMessage } from "../llm/evaluate.ts";
import { judgeParams, judgePrompt } from "../llm/judge.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const { values, positionals } = parseArgs({
  options: {
    out: { type: "string" },
    sample: { type: "string", default: "100" },
    parts: { type: "string", default: "150" },
    name: { type: "string" },
    model: { type: "string" },
    effort: { type: "string", default: "medium" },
    reps: { type: "string", default: "2" },
    dataset: { type: "string" },
    // One by one at full price, when the batch queue is slow.
    direct: { type: "boolean" },
  },
  allowPositionals: true,
});
const [command, ...names] = positionals;
/** Paths given on the command line are relative to where pnpm was run, not to packages/core. */
const fromCwd = (file: string | undefined) => (file ? path.resolve(process.env.INIT_CWD ?? process.cwd(), file) : undefined);
const EVALUATION = path.join(EVALS_DIR, "evaluation-v1.jsonl");
const JUDGE = path.join(EVALS_DIR, "judge-v1.jsonl");

/** A dataset is frozen once built: rebuilding it under the same name would make old runs incomparable. */
async function freeze(file: string, rows: unknown[]) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeJsonl(file, rows);
}
function refuseOverwrite(file: string) {
  if (existsSync(file)) throw new Error(`${file} exists; name a new version with --out`);
}

/** The run's model, effort and reps from the flags, checked. */
function runSetup() {
  const { name, model } = values;
  if (!name || !model) throw new Error("Needs --name and --model");
  if (!PRICES[model]) throw new Error(`No prices for ${model} in src/llm/calls.ts`);
  const effort = EFFORTS.find((e) => e === values.effort);
  if (!effort) throw new Error(`--effort is one of ${EFFORTS.join(", ")}`);
  return { name, model, effort: effort satisfies RunMeta["effort"], reps: Number(values.reps) };
}

function printCost(name: string, result: Awaited<ReturnType<typeof runBatch>>) {
  const cost = result.rows.reduce((s, r) => s + r.costUsd, 0);
  console.log(`${name}: ${result.rows.length} answers, ${result.errors} errors, $${cost.toFixed(2)} paid`);
}

const reps = (n: number) => Array.from({ length: n }, (_, rep) => rep);

if (command === "dataset") {
  const out = fromCwd(values.out) ?? EVALUATION;
  refuseOverwrite(out);
  const { db, close } = createDb();
  try {
    const cases = await buildDataset(db, Number(values.sample));
    await freeze(out, cases);
    console.log([`Wrote ${out}`, ...describeDataset(cases)].join("\n"));
  } finally {
    await close();
  }
} else if (command === "run") {
  const run = runSetup();
  const dataset = fromCwd(values.dataset) ?? EVALUATION;
  const { system, version } = await evaluationPrompt();
  const result = await runBatch(
    createClient(),
    { ...run, dataset: repoRelative(dataset), promptVersion: version },
    async () =>
      (await readJsonl<EvalCase>(dataset)).flatMap((c) =>
        reps(run.reps).map(
          (rep): BatchRequest => ({
            caseId: c.id,
            rep,
            // Purpose and triage note stay out: a note like "company is applied" would leak the label.
            params: evaluationParams(
              run.model,
              system,
              [{ role: "user", content: postingMessage({ ...c.item, purpose: "queue", note: "" }) }],
              run.effort,
            ),
          }),
        ),
      ),
    { direct: values.direct },
  );
  printCost(run.name, result);
} else if (command === "report") {
  if (!names.length) throw new Error("Name the runs to compare, the reference first");
  console.log((await evalReport(names)).join("\n"));
} else if (command === "judge-dataset") {
  const out = fromCwd(values.out) ?? JUDGE;
  refuseOverwrite(out);
  const total = Number(values.parts);
  const { db, close } = createDb();
  try {
    const bank = await loadAnswerBank();
    // Cover letters hold the most claims, so they're a fair share despite being fewer.
    const parts = await sampleParts(db, bank, {
      whyFit: Math.round(total * 0.4),
      answer: Math.round(total * 0.33),
      coverLetter: Math.round(total * 0.27),
    });
    const name = `plant-${path.basename(out, ".jsonl")}`;
    const planted = await runBatch(
      createClient(),
      { name, model: MODEL, effort: "medium", reps: 1, dataset: repoRelative(out), promptVersion: "plant" },
      async () => parts.map((p, i) => ({ caseId: p.id, rep: 0, params: plantParams(MODEL, p.part, p.evidence, kindOf(i)) })),
    );
    printCost(name, planted);
    const answers = new Map(planted.rows.map((r) => [r.caseId, r.output]));
    const cases: JudgeCase[] = parts.flatMap((p, i) => {
      const plant = acceptPlant(p.part.text, answers.get(p.id) ?? null);
      return plant
        ? [{ id: p.id, section: p.part.section, question: p.part.question, evidence: p.evidence, clean: p.part.text, ...plant, kind: kindOf(i) }]
        : [];
    });
    await freeze(out, cases);
    console.log(`Wrote ${out}: ${cases.length} of ${parts.length} parts got a usable planted error`);
  } finally {
    await close();
  }
} else if (command === "judge-run") {
  const run = runSetup();
  const dataset = fromCwd(values.dataset) ?? JUDGE;
  const { system, version } = await judgePrompt();
  const result = await runBatch(
    createClient(),
    { ...run, dataset: repoRelative(dataset), promptVersion: version },
    async () =>
      (await readJsonl<JudgeCase>(dataset)).flatMap((c) =>
        reps(run.reps).flatMap((rep) => [
          { caseId: `${c.id}c`, rep, params: judgeParams(run.model, system, { ...c, text: c.clean }, c.evidence, run.effort) },
          { caseId: `${c.id}p`, rep, params: judgeParams(run.model, system, { ...c, text: c.planted }, c.evidence, run.effort) },
        ]),
      ),
    { direct: values.direct },
  );
  printCost(run.name, result);
} else if (command === "judge-report") {
  if (!names.length) throw new Error("Name the judge runs to compare");
  console.log((await judgeReport(names)).join("\n"));
} else {
  throw new Error("Usage: pnpm eval dataset | run | report | judge-dataset | judge-run | judge-report (see src/cli/eval.ts)");
}
