import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import type Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";
import { costUsd, PRICES } from "../llm/calls.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
/** Datasets and results hold the candidate's decisions and profile, so they live in data/, outside git. */
export const EVALS_DIR = path.join(REPO_ROOT, "data/evals");
export const runPath = (name: string, suffix: string) => path.join(EVALS_DIR, "runs", `${name}${suffix}`);
/** Runs store their dataset relative to the repo, so results survive a move. */
export const repoPath = (file: string) => path.resolve(REPO_ROOT, file);
export const repoRelative = (file: string) => path.relative(REPO_ROOT, path.resolve(file));

/** A model's JSON answer, or null when it isn't JSON. */
export function parseJson(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
}

/** What a run was: enough to tell whether two runs compare. */
export interface RunMeta {
  name: string;
  batchId: string;
  model: string;
  effort: Anthropic.OutputConfig["effort"];
  reps: number;
  /** Relative to the repo root. */
  dataset: string;
  promptVersion: string;
  createdAt: string;
  /** "direct": sent one by one at full price instead of as a batch. Absent on batch runs. */
  mode?: "direct";
}

/**
 * A run's cost as production pays it: full price, with every row's cached prompt read from a warm cache.
 * A batch caches unevenly (about 4 in 10 Opus rows wrote the cache, nearly every Sonnet row read it),
 * so its bill isn't a fair comparison. A local model has no price: it's free.
 */
export const productionPrice = (rows: BatchRow[]) =>
  rows.reduce(
    (s, r) =>
      s +
      (PRICES[r.model]
        ? costUsd(r.model, {
            input_tokens: r.usage.input,
            output_tokens: r.usage.output,
            cache_read_input_tokens: r.usage.cacheRead + r.usage.cacheWrite,
          } as Anthropic.Usage)
        : 0),
    0,
  );

/** One answer, as the batch returned it. */
export interface BatchRow {
  caseId: string;
  rep: number;
  model: string;
  stopReason: string | null;
  output: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
}

export interface BatchRequest {
  caseId: string;
  rep: number;
  params: Anthropic.MessageCreateParamsNonStreaming;
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export const writeJsonl = (file: string, rows: unknown[]) => writeFile(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));

export const readMeta = async (name: string): Promise<RunMeta> => JSON.parse(await readFile(runPath(name, ".json"), "utf8"));

/** One answer as a row; an answer from another model than the one asked for measures nothing, so it's an error. */
function toRow(
  caseId: string,
  rep: number,
  m: Anthropic.Message,
  model: string,
  discount: number,
): BatchRow | { caseId: string; rep: number; type: string; error: unknown } {
  if (m.model !== model) return { caseId, rep, type: "wrong_model", error: m.model };
  return {
    caseId,
    rep,
    model: m.model,
    stopReason: m.stop_reason,
    output: m.content.find((b) => b.type === "text")?.text ?? null,
    usage: {
      input: m.usage.input_tokens,
      output: m.usage.output_tokens,
      cacheRead: m.usage.cache_read_input_tokens ?? 0,
      cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
    },
    costUsd: costUsd(m.model, m.usage) * discount,
  };
}

async function save(meta: RunMeta, results: ReturnType<typeof toRow>[]) {
  const rows = results.filter((r): r is BatchRow => "output" in r);
  const errors = results.filter((r) => !("output" in r));
  await mkdir(path.dirname(runPath(meta.name, "")), { recursive: true });
  await writeFile(runPath(meta.name, ".json"), `${JSON.stringify(meta, null, 2)}\n`);
  await writeJsonl(runPath(meta.name, ".jsonl"), rows);
  if (errors.length) await writeJsonl(runPath(meta.name, ".errors.jsonl"), errors);
  return { rows, errors: errors.length };
}

/**
 * Send `requests` and collect the answers. As one Message Batch by default (half price,
 * within 24 hours, usually under an hour): the batch id is saved before waiting, so an
 * interrupted run resumes instead of paying twice. With `direct`, one by one at full price,
 * 16 at a time, for when the batch queue is slow. A run whose answers are saved is never sent
 * again. Answers that couldn't be produced (errors, expiry, another model) go to
 * <name>.errors.jsonl, never into the rows that get graded.
 */
export async function runBatch(
  client: Anthropic,
  meta: Omit<RunMeta, "batchId" | "createdAt" | "mode">,
  build: () => Promise<BatchRequest[]>,
  options: { direct?: boolean } = {},
): Promise<{ rows: BatchRow[]; errors: number }> {
  const { name } = meta;
  if (existsSync(runPath(name, ".jsonl"))) return { rows: await readJsonl(runPath(name, ".jsonl")), errors: 0 };

  if (options.direct) {
    // A lone <name>.json is a batch still being processed: a direct run would pay again and overwrite its id.
    if (existsSync(runPath(name, ".json"))) {
      throw new Error(
        `${name}: batch ${(await readMeta(name)).batchId} is unfinished; rerun without --direct to collect it, or cancel it and use a new name`,
      );
    }
    const requests = await build();
    const createdAt = new Date().toISOString();
    const limit = pLimit(16);
    let done = 0;
    const results = await Promise.all(
      requests.map((r) =>
        limit(async () => {
          // The SDK retries 429s, 5xx and dropped connections; what still fails is an error row.
          const result = await client.messages.create(r.params).then(
            (m) => toRow(r.caseId, r.rep, m, meta.model, 1),
            (error: unknown) => ({ caseId: r.caseId, rep: r.rep, type: "errored", error: String(error) }),
          );
          if (++done % 50 === 0) console.log(`${name}: ${done} of ${requests.length} done`);
          return result;
        }),
      ),
    );
    return save({ ...meta, batchId: "direct", createdAt, mode: "direct" }, results);
  }

  let saved: RunMeta;
  if (existsSync(runPath(name, ".json"))) {
    saved = await readMeta(name);
    console.log(`${name}: resuming batch ${saved.batchId}`);
  } else {
    const requests = await build();
    const batch = await client.messages.batches.create({
      requests: requests.map((r) => ({ custom_id: `${r.caseId}-r${r.rep}`, params: r.params })),
    });
    saved = { ...meta, batchId: batch.id, createdAt: new Date().toISOString() };
    await mkdir(path.dirname(runPath(name, "")), { recursive: true });
    await writeFile(runPath(name, ".json"), `${JSON.stringify(saved, null, 2)}\n`);
    console.log(`${name}: batch ${batch.id}, ${requests.length} requests`);
  }

  for (;;) {
    const batch = await client.messages.batches.retrieve(saved.batchId);
    if (batch.processing_status === "ended") break;
    const c = batch.request_counts;
    console.log(`${name}: ${c.succeeded + c.errored} of ${c.succeeded + c.errored + c.processing} done`);
    await setTimeout(30_000);
  }

  const results: ReturnType<typeof toRow>[] = [];
  for await (const r of await client.messages.batches.results(saved.batchId)) {
    const at = r.custom_id.lastIndexOf("-r");
    const caseId = r.custom_id.slice(0, at);
    const rep = Number(r.custom_id.slice(at + 2));
    if (r.result.type !== "succeeded") {
      results.push({ caseId, rep, type: r.result.type, error: r.result.type === "errored" ? r.result.error : null });
      continue;
    }
    // The Batch API halves every token price.
    results.push(toRow(caseId, rep, r.result.message, saved.model, 0.5));
  }
  return save(saved, results);
}
