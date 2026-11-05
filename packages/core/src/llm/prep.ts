import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import Anthropic from "@anthropic-ai/sdk";
import { type AnswerBank, answerBankPath, approvedText, loadAnswerBank } from "../agent/answer-bank.ts";
import { prepDrafts, recordAttempts } from "../agent/attempts.ts";
import { refreshForms } from "../agent/forms.ts";
import { leadsNeedingForms, nextPrepWork, PrepPack, submitPrepPacks } from "../agent/prep.ts";
import { finishRun, startRun } from "../agent/runs.ts";
import { loadProfileSources, type ProfileSources } from "../agent/sources.ts";
import type { Db } from "../db/client.ts";
import { type CallContext, logged, promptVersion, type StepResult } from "./calls.ts";
import { apiUsable, createClient, inSpan, MODEL, strictSchema } from "./client.ts";
import { judgePrompt, reviewPack } from "./judge.ts";
import { onSubscription } from "./subscription.ts";

const PROMPT = path.join(import.meta.dirname, "../agent/prompts/prep.md");
/** Requests per lead, counting pause_turn continuations: what bounds a lead's cost. */
const MAX_REQUESTS = 10;
/**
 * The claim judge reviews the first submit that passes the code checks, if that's the first or second;
 * the two after it let a redraft that fixed its points still fix a broken quote, so the judge never
 * costs a pack (with two submits, it once did).
 */
const MAX_SUBMITS = 4;

/** Fixed, and in a fixed order: the tools sit at the start of the cached prefix. */
const TOOLS = [
  // max_uses counts per request; MAX_REQUESTS bounds the whole lead.
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 20000 },
  {
    name: "submit_pack",
    description:
      "Submit the complete prep pack for this lead. Code checks it and stores it, or returns the problems to fix; then call it again with the fixed pack.",
    strict: true,
    input_schema: strictSchema(PrepPack.omit({ postingId: true })) as Anthropic.Tool.InputSchema,
  },
] satisfies Anthropic.ToolUnion[];

type Send = (messages: Anthropic.MessageParam[]) => Promise<Anthropic.Message>;

/**
 * One lead's conversation: research with the server's web tools, then submit_pack,
 * fixing what the checks report. `submit` stores the pack and returns null, or returns
 * the problems for the model to fix. Forced tool_choice is a 400 on Opus 5.5, so a model
 * that stops without submitting gets one nudge.
 */
export async function packLoop(
  send: Send,
  first: string,
  submit: (input: unknown, attempt: number) => Promise<string | null>,
): Promise<{ stored: boolean; reason?: string }> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: first }];
  let submits = 0;
  let nudged = false;
  for (let request = 0; request < MAX_REQUESTS; request++) {
    const response = await send(messages);
    messages.push({ role: "assistant", content: response.content });
    switch (response.stop_reason) {
      case "pause_turn":
        // The server paused its own tool loop: send the same conversation again, with nothing added.
        continue;
      case "tool_use": {
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          if (block.name !== "submit_pack") {
            results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `Unknown tool ${block.name}.` });
            continue;
          }
          const problems = await submit(block.input, submits + 1);
          if (problems === null) return { stored: true };
          if (++submits >= MAX_SUBMITS) return { stored: false, reason: `not stored after ${MAX_SUBMITS} submits: ${problems}` };
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: problems });
        }
        if (!results.length) return { stored: false, reason: "tool_use without a client tool call" };
        // Only tool results here: a text block next to them is a 400.
        messages.push({ role: "user", content: results });
        continue;
      }
      case "end_turn":
        if (nudged) return { stored: false, reason: "no submit_pack call" };
        nudged = true;
        messages.push({ role: "user", content: "Call submit_pack with the complete pack." });
        continue;
      default:
        return { stored: false, reason: `stop_reason ${response.stop_reason}` };
    }
  }
  return { stored: false, reason: `no pack after ${MAX_REQUESTS} requests` };
}

type Review = NonNullable<Parameters<typeof submitPrepPacks>[5]>;

/**
 * The claim judge for one lead's submits: it reviews one, the first that passes the code checks
 * (submitPrepPacks calls it only then), and only while two submits remain after it, so a false
 * alarm can't cost the pack.
 */
export function judgeOnce(review: Review): (attempt: number) => Review | undefined {
  let judged = false;
  return (attempt) =>
    !judged && attempt <= MAX_SUBMITS - 2
      ? (pack) => {
          judged = true;
          return review(pack);
        }
      : undefined;
}

/** A runaway guard for one press of "Draft packs": a pack costs about $0.25. */
const MAX_USD = 20;

type PrepItem = Awaited<ReturnType<typeof nextPrepWork>>[number];

/**
 * The app's "Draft packs": every shortlisted lead's missing pack, in a run of its own, on the
 * API, or with `/prep <ids>` on the subscription when there's no key or credit. Returns a
 * line (or /prep's report) for the log.
 */
export async function draftShortlistedPacks(db: Db): Promise<string> {
  // The questions and the cover-letter rule come from the stored form, and submitting reads
  // it again: refresh before drafting, never between.
  const forms = await refreshForms(db, await leadsNeedingForms(db));
  if (forms.read || forms.failed.length) console.log(`Application forms: ${forms.read} read, ${forms.failed.length} failed`);
  const items = await nextPrepWork(db, Number.POSITIVE_INFINITY, { shortlisted: true });
  if (!items.length) return "no pack to draft";
  // whyUs comes from the company's own pages. Only this run gets the web tools: the project allowlist
  // leaves them out, so a run that reads untrusted text next to private data (/replies) can't send it anywhere.
  if (!(await apiUsable())) return onSubscription(`/prep ${items.map((i) => i.postingId).join(" ")}`, 180, ["WebFetch", "WebSearch"]);

  const runId = await startRun(db, "prep");
  try {
    const ctx = { client: createClient(), db, runId, model: MODEL, budget: { max: MAX_USD, spent: 0 } };
    const { done, skipped } = await draftPacks(ctx, items);
    return [`${done} drafted on the API`, ...skipped.map((s) => `posting ${s.postingId} skipped (${s.reason})`)].join(", ");
  } finally {
    await finishRun(db, runId);
  }
}

/**
 * Draft these leads' packs, one at a time so they share the cached prefix (prompt, Answer
 * bank and profile files, about 43k tokens). Throws AnswerBankError when the bank doesn't parse.
 */
async function draftPacks(ctx: CallContext, items: PrepItem[]): Promise<StepResult> {
  const bank = await loadAnswerBank();
  const profile = await loadProfileSources(undefined, approvedText(bank));
  if (!profile.files.size) throw new Error(`No profile files in ${profile.dir}: packs would have nothing to cite`);
  const system = await prepSystem(profile);
  const version = promptVersion(system, TOOLS);
  const judge = await judgePrompt();

  const skipped: StepResult["skipped"] = [];
  for (const item of items) {
    const { postingId } = item;
    const review = judgeOnce((pack) => reviewPack(ctx, judge, bank, postingId, pack));
    const first = `${JSON.stringify(item, null, 2)}\n\nResearch the company with web_search and web_fetch for whyUs, then call submit_pack once with the complete pack. If it reports problems, fix exactly those and call it again.`;
    const result = await inSpan(`prep posting ${postingId}`, { "session.id": `run-${ctx.runId}`, "job_search.posting_id": postingId }, () =>
      packLoop(
        (messages) => logged(ctx, { kind: "prep", postingId, promptVersion: version }, () => stream(ctx, system, messages)),
        first,
        (input, attempt) => submit(ctx, bank, profile, postingId, input, review(attempt)),
      ),
    );
    if (!result.stored) skipped.push({ postingId, reason: result.reason ?? "not stored" });
  }
  return { done: items.length - skipped.length, skipped };
}

/** Everything a pack may draw on, in a stable order so it caches: rules, Answer bank, profile files, voice, don't-say. */
async function prepSystem(profile: ProfileSources): Promise<string> {
  const files = [...profile.files].map(([file, text]) => `<file name="${file}">\n${text}\n</file>`).join("\n\n");
  const style = profile.styleFile ? await readFile(path.join(profile.dir, profile.styleFile), "utf8") : null;
  return [
    await readFile(PROMPT, "utf8"),
    `# Answer bank\n\n${await readFile(answerBankPath(), "utf8")}`,
    `# Profile files\n\nCite them in \`sources\` with \`file\` exactly as named here.\n\n${files}`,
    ...(style ? [`# Voice samples (style only, not citable)\n\n${style}`] : []),
    `# Don't say\n\n${profile.banned.map((b) => `- ${b.label}`).join("\n")}`,
  ].join("\n\n");
}

/** One turn, streamed: at 32k max_tokens the SDK requires it. */
async function stream(ctx: CallContext, system: string, messages: Anthropic.MessageParam[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = ctx.client.messages.stream({
        model: ctx.model,
        max_tokens: 32000,
        // Two breakpoints: the system prompt (shared by every lead) and the growing conversation.
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        output_config: { effort: "high" },
        tools: TOOLS,
        messages,
      });
      return { ...(await response.finalMessage()), _request_id: response.request_id };
    } catch (error) {
      // The SDK retries HTTP errors, but not an error event in the middle of a stream (no status).
      const midStream =
        error instanceof Anthropic.APIError && error.status === undefined && ["overloaded_error", "api_error"].includes(String(error.type));
      if (!midStream || attempt >= 2) throw error;
      await setTimeout(attempt ? 15_000 : 5_000);
    }
  }
}

/** Store one pack with the CLI's checks; null when stored, otherwise the problems as the CLI prints them. */
async function submit(
  ctx: CallContext,
  bank: AnswerBank,
  profile: ProfileSources,
  postingId: number,
  input: unknown,
  review?: Parameters<typeof submitPrepPacks>[5],
): Promise<string | null> {
  const packs = { packs: [{ ...(input as object), postingId }] };
  const report = await submitPrepPacks(ctx.db, packs, bank, ctx.runId, profile, review);
  await recordAttempts(ctx.db, ctx.runId, "prep", prepDrafts(packs, report));
  if (report.schemaErrors.length) return report.schemaErrors.map((e) => e.replace(/^packs\.0\./, "")).join("\n");
  const outcome = report.outcomes[0];
  if (outcome?.status === "stored") return null;
  return outcome?.problems.map((p) => p.message).join("\n") ?? "not stored";
}
