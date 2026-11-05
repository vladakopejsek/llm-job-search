import { type BatchRow, productionPrice, readJsonl, readMeta, repoPath, runPath } from "./batch.ts";
import { type EvalCase, type Graded, grade, type Metrics, type Rate, summarize, wilson } from "./grade.ts";

/** A scheduled run evaluates up to 75 postings (src/cli/daily-run.ts). */
const RUN_SIZE = 75;

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Reps of one case are correlated, so the interval counts cases, not rows. */
function rate(r: Rate, reps = 1): string {
  if (!r.n) return "–";
  const [lo, hi] = wilson({ k: r.k / reps, n: r.n / reps });
  return `${pct(r.k / r.n)} (${pct(lo)}–${pct(hi)})`;
}

/** How often two sets of verdicts agree, on the cases both decided (first rep of each). */
function agreement(a: Map<string, Graded>, b: Map<string, string | null>): Rate {
  const r = { k: 0, n: 0 };
  for (const [id, g] of a) {
    const other = b.get(id);
    if (!g.verdict || !other) continue;
    r.n++;
    if (g.verdict === other) r.k++;
  }
  return r;
}

/** Cases whose reps all reached the same verdict: the run-to-run noise of the model itself. */
function consistency(graded: Graded[]): Rate {
  const byCase = Object.groupBy(graded, (g) => g.caseId);
  const multi = Object.values(byCase).filter((g) => (g?.length ?? 0) > 1);
  return { k: multi.filter((g) => new Set(g!.map((x) => x.verdict)).size === 1).length, n: multi.length };
}

interface Run {
  meta: Awaited<ReturnType<typeof readMeta>>;
  rows: BatchRow[];
  graded: Graded[];
}

/**
 * Compare runs of the same dataset as a markdown table, next to two baselines: the shipped
 * pipeline's stored verdicts and "always lead". Then the jobs each run would miss, and the
 * labelled cases where a run disagrees with the first one, to read by hand: an eval number
 * is only as good as the disagreements behind it.
 */
export async function evalReport(names: string[]): Promise<string[]> {
  const metas = await Promise.all(names.map(readMeta));
  const datasets = new Set(metas.map((m) => m.dataset));
  if (datasets.size > 1) throw new Error(`Runs read different datasets (${[...datasets].join(", ")}): their numbers don't compare`);
  const cases = new Map((await readJsonl<EvalCase>(repoPath(metas[0]!.dataset))).map((c) => [c.id, c]));
  const runs: Run[] = await Promise.all(
    metas.map(async (meta) => {
      const rows = await readJsonl<BatchRow>(runPath(meta.name, ".jsonl"));
      return { meta, rows, graded: rows.map((row) => grade(cases.get(row.caseId)!, row)) };
    }),
  );

  const firstRep = (r: Run) => new Map(r.graded.filter((g) => g.rep === 0).map((g) => [g.caseId, g]));
  const shipped = new Map([...cases.values()].map((c) => [c.id, c.production]));
  const reference = runs[0]!;
  const referenceVerdicts = new Map([...firstRep(reference)].map(([id, g]) => [id, g.verdict]));

  const lines = [
    `Dataset: ${metas[0]!.dataset}, ${cases.size} cases (${[...cases.values()].filter((c) => c.label).length} labelled).`,
    ...(new Set(metas.map((m) => m.promptVersion)).size > 1 ? ["Warning: the runs used different prompt versions."] : []),
    "",
    `| Run | Model, effort | Jobs kept (recall) | Not eligible caught | Lead precision | Same as shipped | Same as ${reference.meta.name} | Same across reps | No verdict | Quote misses per answer | $ per posting | $ per run of ${RUN_SIZE} |`,
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const row = (name: string, setup: string, m: Metrics, reps: number, rest: string[]) =>
    lines.push(
      `| ${name} | ${setup} | ${rate(m.recall, reps)} | ${rate(m.ineligibleCaught, reps)} | ${rate(m.leadPrecision, reps)} | ${rest.join(" | ")} |`,
    );

  for (const r of runs) {
    const m = summarize(cases, r.graded);
    const noVerdict = Object.entries(m.noVerdict)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${k}`);
    const perPosting = productionPrice(r.rows) / r.rows.length;
    row(r.meta.name, `${r.meta.model.replace("claude-", "")}, ${r.meta.effort}`, m, r.meta.reps, [
      rate(agreement(firstRep(r), shipped)),
      r === reference ? "–" : rate(agreement(firstRep(r), referenceVerdicts)),
      r.meta.reps > 1 ? rate(consistency(r.graded)) : "–",
      noVerdict.join(", ") || "0",
      (m.quoteWarnings / r.rows.length).toFixed(2),
      `$${perPosting.toFixed(4)}`,
      `$${(perPosting * RUN_SIZE).toFixed(2)}`,
    ]);
  }
  const baseline = (verdict: (c: EvalCase) => Graded["verdict"]): Graded[] =>
    [...cases.values()].map((c) => ({ caseId: c.id, rep: 0, status: "ok", verdict: verdict(c), reasons: [], quoteWarnings: 0, facts: null }));
  row(
    "shipped pipeline",
    "stored verdicts",
    summarize(
      cases,
      baseline((c) => c.production),
    ),
    1,
    ["–", "–", "–", "–", "–", "–", "–"],
  );
  row(
    "always lead",
    "no model",
    summarize(
      cases,
      baseline(() => "lead"),
    ),
    1,
    ["–", "–", "–", "0", "–", "$0", "$0"],
  );
  lines.push(
    "",
    "The labelled cases are postings the shipped pipeline put in the queue, so it keeps every wanted job and catches no ineligible one by construction: those two columns can't measure it, and the set can't show jobs it never surfaced.",
  );

  const describe = (c: EvalCase) => `${c.item.company}, ${c.item.title} (${c.decision})`;
  for (const r of runs) {
    const missed = r.graded.filter((g) => g.verdict === "rejected" && cases.get(g.caseId)?.label === "apply");
    if (missed.length) {
      lines.push("", `${r.meta.name}: wanted jobs it rejects (${missed.length})`);
      for (const g of missed.slice(0, 15)) lines.push(`- r${g.rep} ${describe(cases.get(g.caseId)!)}: ${g.reasons.join("; ")}`);
    }
    if (r === reference) continue;
    const flips = [...firstRep(r)].filter(
      ([id, g]) => cases.get(id)?.label && g.verdict && referenceVerdicts.get(id) && g.verdict !== referenceVerdicts.get(id),
    );
    if (flips.length) {
      lines.push("", `${r.meta.name} vs ${reference.meta.name}: labelled cases decided differently (${flips.length})`);
      for (const [id, g] of flips.slice(0, 15)) {
        lines.push(
          `- ${describe(cases.get(id)!)}: ${referenceVerdicts.get(id)} → ${g.verdict}${g.reasons.length ? ` (${g.reasons.join("; ")})` : ""}`,
        );
      }
    }
  }
  return lines;
}
