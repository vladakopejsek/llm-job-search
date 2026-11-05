/**
 * The interface between the daily Claude run (the /daily-run skill) and the app.
 * Data goes through files (--out / <file>), so pnpm's own output never mixes
 * with it; stdout carries a short human-readable summary.
 *
 *   pnpm agent:start                                   → prints the run id
 *   pnpm agent:start --kind replies                    → a /replies run; --kind prep for /prep (default: evaluate)
 *   pnpm agent:next --run 7 --limit 10 --audit 3 --out work/batch-1.json
 *   pnpm agent:next --run 7 --posting 1331,1590 --out work/batch-1.json   → evaluate these (unevaluated, open) postings now
 *   pnpm agent:next --run 7 --within 1331,1590 --limit 10 --out work/batch-1.json   → the usual choice, among these postings only (after a collect)
 *   pnpm agent:schema evaluation --out work/schema-evaluation.json
 *   pnpm agent:submit --run 7 work/results-1.json      → exit 0 ok, 2 stored with warnings, 1 errors
 *   pnpm agent:prep-next --run 7 --limit 8 --out work/prep-1.json
 *   pnpm agent:prep-next --run 7 --posting 1331,1590 --out work/prep-1.json   → redraft these packs (re-reads their forms)
 *   pnpm agent:submit-prep --run 7 work/packs-1.json   → exit 0 ok, 1 errors (nothing stored for those)
 *   pnpm agent:applications --out work/applications.json    → open applications + mailbox search window
 *   pnpm agent:propose-outcomes --run 7 work/outcomes.json   → reply proposals, confirmed in the queue
 *   pnpm agent:finish --run 7
 *   pnpm agent:rescore                                 → re-apply the rules to all stored facts (no model calls)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { answerBankPath, approvedText, loadAnswerBank } from "../agent/answer-bank.ts";
import { type AttemptKind, badJsonDraft, evaluationDrafts, outcomeDrafts, prepDrafts, recordAttempts } from "../agent/attempts.ts";
import { EvaluationSubmission } from "../agent/facts.ts";
import { refreshForms } from "../agent/forms.ts";
import { OutcomeSubmission, openApplications, submitOutcomes } from "../agent/outcomes.ts";
import { leadsNeedingForms, nextPrepWork, PrepSubmission, submitPrepPacks } from "../agent/prep.ts";
import { rescoreEvaluations } from "../agent/rescore.ts";
import { finishRun, formatSummary, RUN_KINDS, startRun } from "../agent/runs.ts";
import { loadProfileSources } from "../agent/sources.ts";
import { submitEvaluations } from "../agent/submit.ts";
import { nextWork } from "../agent/work.ts";
import { createDb, type Db } from "../db/client.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const resolve = (file: string) => path.resolve(process.env.INIT_CWD ?? REPO_ROOT, file);

const SCHEMAS: Record<string, z.ZodType> = {
  evaluation: EvaluationSubmission,
  prep: PrepSubmission,
  outcomes: OutcomeSubmission,
};

const { values, positionals } = parseArgs({
  options: {
    run: { type: "string" },
    limit: { type: "string", default: "10" },
    audit: { type: "string", default: "0" },
    out: { type: "string" },
    /** next / prep-next: only these postings (comma-separated ids); prep-next redrafts them even if their pack is complete. */
    posting: { type: "string" },
    /** next: the usual choice (triage, one evaluation per role), made among these postings only (comma-separated ids). */
    within: { type: "string" },
    /** start: what the run does (agent_runs.kind). */
    kind: { type: "string", default: "evaluate" },
  },
  allowPositionals: true,
});
const [command, arg] = positionals;

async function writeJson(file: string, data: unknown) {
  const target = resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`);
  return path.relative(REPO_ROOT, target);
}

function runId(): number {
  const id = Number(values.run);
  if (!values.run || !Number.isInteger(id)) throw new Error("--run <id> is required (from pnpm agent:start)");
  return id;
}

/** The JSON in `file`, or null after telling the agent (and the attempt log) it can't be read. */
async function readJson(db: Db, kind: AttemptKind, file: string): Promise<{ input: unknown } | null> {
  try {
    return { input: JSON.parse(await readFile(resolve(file), "utf8")) };
  } catch (error) {
    const message = `Can't read ${file} as JSON: ${error instanceof Error ? error.message : error}`;
    console.log(message);
    await recordAttempts(db, runId(), kind, badJsonDraft(message));
    return null;
  }
}

async function main(): Promise<number> {
  if (command === "schema") {
    const schema = SCHEMAS[arg ?? ""];
    if (!schema) throw new Error(`Unknown schema "${arg}". Available: ${Object.keys(SCHEMAS).join(", ")}`);
    const json = z.toJSONSchema(schema);
    if (values.out) console.log(`Schema written to ${await writeJson(values.out, json)}`);
    else console.log(JSON.stringify(json, null, 2));
    return 0;
  }

  const { db, close } = createDb();
  try {
    switch (command) {
      case "start": {
        const kind = RUN_KINDS.find((k) => k === values.kind);
        if (!kind) throw new Error(`--kind must be one of: ${RUN_KINDS.join(", ")}`);
        const id = await startRun(db, kind);
        console.log(`Run id: ${id}`);
        return 0;
      }
      case "next": {
        runId();
        const ids = (list?: string) => list?.split(",").map((s) => Number(s.trim()));
        const items = await nextWork(db, {
          limit: Number(values.limit),
          audit: Number(values.audit),
          postingIds: ids(values.posting),
          within: ids(values.within),
        });
        if (!values.out) throw new Error("--out <file> is required");
        const file = await writeJson(values.out, { items });
        const audit = items.filter((i) => i.purpose === "audit").length;
        console.log(items.length ? `${items.length} work items (${audit} audit) written to ${file}` : "No work left.");
        return 0;
      }
      case "submit": {
        if (!arg) throw new Error("Usage: pnpm agent:submit --run <id> <results.json>");
        const file = await readJson(db, "evaluation", arg);
        if (!file) return 1;
        const report = await submitEvaluations(db, file.input, runId());
        await recordAttempts(db, runId(), "evaluation", evaluationDrafts(file.input, report));
        if (report.schemaErrors.length) {
          console.log("Nothing stored. Fix these and resubmit:");
          for (const e of report.schemaErrors) console.log(`  ${e}`);
          return 1;
        }
        let code = 0;
        for (const o of report.outcomes) {
          if (o.status === "error") {
            console.log(`  posting ${o.postingId}: ERROR ${o.error}`);
            code = 1;
            continue;
          }
          console.log(`  posting ${o.postingId}: ${o.verdict} — ${o.reasons.join("; ")}`);
          for (const w of o.warnings) {
            console.log(`    quote ${w.problem}: ${w.field} ${w.quote ? JSON.stringify(w.quote) : ""} → ${w.downgraded}`);
            if (code === 0) code = 2; // a posting that errored (1) matters more than a downgrade
          }
        }
        if (code === 2) console.log("Stored, with downgrades. Copy the exact wording from the posting and resubmit to fix them.");
        return code;
      }
      case "prep-next": {
        runId();
        if (!values.out) throw new Error("--out <file> is required");
        const bank = await loadAnswerBank(); // fail early if the Answer bank is missing or invalid
        const postingIds = values.posting ? values.posting.split(",").map((s) => Number(s.trim())) : undefined;
        if (postingIds?.some((n) => !Number.isInteger(n))) throw new Error("--posting takes posting ids, e.g. --posting 1331,1590");
        // The questions and whether a cover letter is wanted come from the ATS form; read it for leads that need it.
        // A deliberate redraft (--posting) always re-reads its forms, so it answers the form as it is now.
        const forms = await refreshForms(db, [...new Set([...(await leadsNeedingForms(db)), ...(postingIds ?? [])])]);
        if (forms.read || forms.unsupported || forms.failed.length) {
          console.log(
            `Application forms: ${forms.read} read, ${forms.unsupported} not readable on this board${forms.failed.length ? `, ${forms.failed.length} failed` : ""}.`,
          );
          for (const f of forms.failed) console.log(`  ${f}`);
        }
        const items = await nextPrepWork(db, postingIds ? postingIds.length : Number(values.limit), { postingIds });
        const missing = postingIds?.filter((id) => !items.some((i) => i.postingId === id)) ?? [];
        if (missing.length) {
          console.log(`Not current leads (closed, decided, not a lead, or eligibility not confirmed), skipped: ${missing.join(", ")}`);
        }
        const profile = await loadProfileSources(undefined, approvedText(bank));
        const file = await writeJson(values.out, {
          answerBank: path.relative(REPO_ROOT, answerBankPath()),
          profile: {
            dir: path.relative(REPO_ROOT, profile.dir),
            // alwaysRead files for every pack; of the rest, open only the 1–2 that match the role.
            index: profile.index,
            styleFile: profile.styleFile,
            dontSay: profile.banned.map((b) => b.label),
          },
          items,
        });
        const redos = items.filter((i) => i.redo).length;
        console.log(
          items.length
            ? `${items.length} leads need a prep pack${redos ? ` (${redos} to redraft: questions unanswered or a letter missing)` : ""}; written to ${file}`
            : "No leads need a prep pack.",
        );
        return 0;
      }
      case "submit-prep": {
        if (!arg) throw new Error("Usage: pnpm agent:submit-prep --run <id> <packs.json>");
        const bank = await loadAnswerBank();
        const file = await readJson(db, "prep", arg);
        if (!file) return 1;
        const report = await submitPrepPacks(db, file.input, bank, runId(), await loadProfileSources(undefined, approvedText(bank)));
        await recordAttempts(db, runId(), "prep", prepDrafts(file.input, report));
        if (report.schemaErrors.length) {
          console.log("Nothing stored. Fix these and resubmit:");
          for (const e of report.schemaErrors) console.log(`  ${e}`);
          return 1;
        }
        let code = 0;
        for (const o of report.outcomes) {
          if (o.status === "stored") console.log(`  posting ${o.postingId}: stored`);
          else {
            code = 1;
            console.log(`  posting ${o.postingId}: NOT stored`);
            for (const p of o.problems) console.log(`    ${p.message}`);
          }
        }
        return code;
      }
      case "applications": {
        if (!values.out) throw new Error("--out <file> is required");
        const data = await openApplications(db);
        const file = await writeJson(values.out, data);
        console.log(`${data.applications.length} open applications; search replies since ${data.since}; written to ${file}`);
        return 0;
      }
      case "propose-outcomes": {
        if (!arg) throw new Error("Usage: pnpm agent:propose-outcomes --run <id> <outcomes.json>");
        const file = await readJson(db, "outcomes", arg);
        if (!file) return 1;
        const report = await submitOutcomes(db, file.input, runId());
        await recordAttempts(db, runId(), "outcomes", outcomeDrafts(report));
        if (report.schemaErrors.length) {
          console.log("Nothing stored. Fix these and resubmit:");
          for (const e of report.schemaErrors) console.log(`  ${e}`);
          return 1;
        }
        console.log(`${report.stored} proposals stored.`);
        for (const s of report.skipped) console.log(`  skipped ${s}`);
        return 0;
      }
      case "rescore": {
        const r = await rescoreEvaluations(db);
        console.log(`Re-applied the rules to ${r.total} evaluations; ${r.changed.length} changed.`);
        for (const c of r.changed) console.log(`  evaluation ${c.id}: ${c.from} → ${c.to} (${c.reasons.join("; ")})`);
        return 0;
      }
      case "finish": {
        console.log(formatSummary(await finishRun(db, runId())).join("\n"));
        return 0;
      }
      default:
        throw new Error(
          `Unknown command "${command}". Commands: start, next, schema, submit, prep-next, submit-prep, applications, propose-outcomes, rescore, finish`,
        );
    }
  } finally {
    await close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
