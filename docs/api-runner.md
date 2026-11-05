# The API runner

This page explains how the LLM steps run on the Anthropic API: the commands, how each kind of call works, what it costs and what happens when something fails. It's for readers who want to understand the runner or change it.

## Contents

- [Two runtimes](#two-runtimes)
- [Commands](#commands)
- [How a daily run works](#how-a-daily-run-works)
- [Evaluating a posting](#evaluating-a-posting)
- [Drafting a pack](#drafting-a-pack)
- [Ask](#ask)
- [Prompt caching](#prompt-caching)
- [Cost log and budgets](#cost-log-and-budgets)
- [Failure handling](#failure-handling)
- [Tracing](#tracing)

## Two runtimes

- **The API runner:** TypeScript code calls the Messages API directly. Code decides what to read and when to stop; the model only reads and writes.
- **The subscription:** Claude Code skills (`/daily-run`, `/prep`, `/replies`) run with `claude -p` on a Claude subscription, with no API credit needed.

Both read the same prompts ([agent/prompts/](../packages/core/src/agent/prompts/)) and store results through the same checks (`submitEvaluations`, `submitPrepPacks`). A model's result is just another submission: it's stored, or rejected with problems for the model to fix.

**The switch is automatic.** Before any work, `apiUsable()` ([llm/client.ts](../packages/core/src/llm/client.ts)) makes one tiny Haiku call. It returns false when the key is missing, rejected, out of credit or over a spend limit. Any other error, such as an outage, fails the run instead, so a passing problem never switches runtimes.

Without a usable API, `pnpm daily-run` does nothing and exits with code 3, so whatever schedules it can run `claude -p /daily-run` instead. `pnpm fresh`, Draft packs and Ask start `claude -p` themselves ([llm/subscription.ts](../packages/core/src/llm/subscription.ts), and [Ask](#ask) has its own). They leave `ANTHROPIC_API_KEY` out of its environment: with the key set, `claude -p` bills the API and skips the claude.ai connectors.

## Commands

| Command | What it does | Limit | Without the API |
|---|---|---|---|
| `pnpm daily-run` | Collect, then evaluate the backlog | 75 evaluations (`backfill`: 100), plus 3 audit items | Exit 3; a scheduler can run `claude -p /daily-run` |
| `pnpm fresh --since <time>` | Evaluate the postings a collect just found, and print the ones that reached the decide queue | 60 evaluations, no audit items | `claude -p "/daily-run new <ids>"` |
| Draft packs (app button) | Draft or complete the pack of each shortlisted lead | All of them | `claude -p "/prep <ids>"` (no claim judge) |
| Ask (app) | Answer a question about the search | 8 turns | `claude -p` with Ask's tools |
| `claude -p /replies` | Turn Gmail replies into stage proposals | – | Subscription only |

```
pnpm daily-run                                   # collect, then up to 75 evaluations
pnpm daily-run backfill                          # up to 100
pnpm daily-run --evaluations 2 --skip-collect    # a small test run
pnpm daily-run --model claude-sonnet-5-5         # another model (it needs prices in llm/calls.ts)
```

Run them on a schedule, such as cron: `pnpm daily-run` a few times a week, and after each `pnpm collect`, `pnpm fresh` and then `claude -p /replies` (with no API key in its environment). Gmail is a claude.ai connector, so `/replies` runs only on the subscription. It ends with `REPLIES OK` or `REPLIES FAILED: <why>`, so a scheduler can tell whether it worked.

## How a daily run works

[cli/daily-run.ts](../packages/core/src/cli/daily-run.ts) runs these steps. The `/daily-run` skill follows the same limits and order.

1. **Check the API.** If `apiUsable()` is false, exit 3 having done nothing.
2. **Collect and screen** (skipped with `--skip-collect`). Fetch every job board, then screen the open postings.
3. **Discover, at most once a week.** `autoPromote` adds up to 15 new companies to the watchlist. It skips when it already ran in the last 6 days.
4. **Start the run** (`startRun`, a row in `agent_runs`). It starts after collect, so the app's Lab page can pair it with the collect run that fed it.
5. **Evaluate.** One `nextWork` call picks the postings, plus 3 audit items: postings the screen rejected, evaluated anyway to check that the rules aren't too strict. Four run at a time.
6. **Finish the run** (`finishRun`, always, in `finally`), and print a summary with tokens and cost. The exit code is 1 if any step failed.

## Evaluating a posting

[llm/evaluate.ts](../packages/core/src/llm/evaluate.ts). One posting is one conversation, with no tools.

- **System prompt:** [evaluation.md](../packages/core/src/agent/prompts/evaluation.md) plus the Profile section of the Answer bank, cached.
- **User message:** the company, title, location, workplace, URL, purpose and triage note, then the posting text.
- **Settings:** Opus 5.5 unless `--model` says otherwise, `max_tokens` 16000, effort `medium`.

**Structured outputs.** The request sets `output_config.format` to the JSON Schema of `Facts` ([agent/facts.ts](../packages/core/src/agent/facts.ts)). The API then constrains decoding: the model can only write tokens that fit the schema, so a turn that ends normally is valid JSON.

`strictSchema` in [llm/client.ts](../packages/core/src/llm/client.ts) converts the Zod schema. Limits the API can't enforce (such as `maxLength`) move into the field description, where the model still sees them, and Zod checks them on submit.

**Checks and one retry.** The facts go through `submitEvaluations`, the same code the CLI uses: quotes are checked against the text, and the rules decide the verdict. If a quote wasn't found (the evaluation is stored with that claim downgraded) or a Zod limit failed, the model gets one retry turn that lists the problems. If it answers with the same facts, nothing is submitted again.

## Drafting a pack

[llm/prep.ts](../packages/core/src/llm/prep.ts). Draft packs refreshes the leads' application forms, then drafts each pack in its own conversation, one lead at a time.

- **System prompt**, about 43k tokens, cached: [prep.md](../packages/core/src/agent/prompts/prep.md), the Answer bank, every citable profile file, the voice samples and the don't-say list.
- **User message:** the lead's work item, and the instruction to research the company, then call `submit_pack`.
- **Tools:** `web_search` and `web_fetch` are server tools, which Anthropic runs inside the request (at most 5 uses each per request). `submit_pack` is a strict client tool: the code runs it, and the API holds its input to the `PrepPack` schema.
- **Settings:** `max_tokens` 32000, which the SDK only allows with streaming; effort `high`.

**The tool loop.** In a tool loop, the model calls tools, the code sends back their results, and the model continues until it's done. Here the loop sends the conversation at most 10 times per lead (counting `pause_turn`), and acts on each `stop_reason`:

| `stop_reason` | What the loop does |
|---|---|
| `pause_turn` | The server paused its own tool loop. Send the same conversation again. |
| `tool_use` | Run `submit_pack` and reply with one `tool_result` per call, nothing else. A stored pack ends the loop; problems go back with `is_error: true`. |
| `end_turn` without a submit | Forced `tool_choice` is a 400 on Opus 5.5, so the model can stop without submitting. It gets one nudge: "Call submit_pack with the complete pack." A second stop skips the lead. |
| `refusal`, `max_tokens`, other | Skip the lead. |

**The claim judge.** `submitPrepPacks` runs the code checks first: fact ids exist, and quotes are word for word in their files. On the first submit that passes them, if it's the first or second, the judge ([llm/judge.ts](../packages/core/src/llm/judge.ts), Haiku 5.5) reads each part of the pack that makes claims against the whole Answer bank. Claims nothing backs come back as `unsupported_claim` problems.

A lead gets at most 4 submits. Two remain after the judge, and later submits skip it, so a false alarm costs a rewrite, never the pack. See [the pack judge eval](evals.md#2-the-pack-judge).

## Ask

Ask answers a question about the search in the app ([ask/ask.ts](../packages/core/src/ask/ask.ts)). The answer streams to the screen as server-sent events (a standard way for a server to push messages to the browser), the same events on both runtimes ([ask/events.ts](../packages/core/src/ask/events.ts)).

- **Question:** today's date, up to 6 earlier questions and answers, then the question.
- **Tools** ([ask/tools.ts](../packages/core/src/ask/tools.ts)): `search_postings`, `posting`, `applications`, `application`, `tracker_stats`, and `sql` for anything else. They use a read-only database connection (`DATABASE_URL_READONLY`).
- **`sql`** ([ask/sql.ts](../packages/core/src/ask/sql.ts)) runs one statement in a read-only transaction with a 5-second timeout, always rolled back, and returns at most 50 rows.

**On the API** ([ask/api.ts](../packages/core/src/ask/api.ts)), a tool loop written by hand, on Opus 5.5 at effort `medium`. Each turn streams its text to the screen; on `tool_use`, the turn's tools run at once (they only read) and their results go back in one message, in call order. The loop ends on `end_turn`, and stops with an error after 8 turns, at $0.50, or on any other stop reason.

**On the subscription** ([ask/subscription.ts](../packages/core/src/ask/subscription.ts)), `claude -p` runs with Ask's prompt, no built-in tools, and at most 8 turns. Its tools come from [ask/mcp-server.ts](../packages/core/src/ask/mcp-server.ts), an MCP server (MCP, the Model Context Protocol, is a standard way to give a model tools that run in another process) that runs the same tools through the same `runTool`. `claude` starts from an empty folder with no settings, so no CLAUDE.md, memory, plugin or hook gets in.

## Prompt caching

Prompt caching stores the start of a prompt (the prefix) for 5 minutes. A later request that starts with the same bytes reads it from the cache, at a fraction of the input price.

- **A breakpoint on the system prompt** caches the tools and the system prompt together; the tools come first in the prefix. Every request has it.
- **The conversation is cached too.** Pack and Ask requests also set `cache_control` at the top level, so each turn reads the earlier turns from the cache.
- **Keep the prefix stable.** The tool list is fixed, in a fixed order. Any byte change in the prefix misses the cache.
- **Packs run one at a time** so they share the warm 43k-token prefix. `cache_read_tokens` in `llm_calls` shows whether it works.

## Cost log and budgets

Every call goes through `logged` in [llm/calls.ts](../packages/core/src/llm/calls.ts). It refuses to start a call once the budget is spent, prices the response, and inserts one row into `llm_calls` ([db/schema.ts](../packages/core/src/db/schema.ts)):

- **`kind`:** `evaluation`, `prep`, `judge` or `ask`. Ask rows have no run and no posting.
- **What ran:** the run, the posting, the model that answered, and the prompt version (the first 12 hex characters of a SHA-256 of the system prompt and the schema or tools).
- **Usage:** uncached input tokens, output tokens (thinking included), cache reads, cache writes, web searches.
- **Result:** cost in USD, latency, stop reason and the API's request id.

A failed insert never throws: losing a row is better than losing the result. `finishRun` adds the run's cost and number of calls to `agent_runs.stats`, and the Lab's Runs table shows it. A subscription run makes no API calls, so it shows no cost rather than $0.

Prices in USD per million tokens (`PRICES` in `llm/calls.ts`):

| Model | Input | 5-minute cache write | 1-hour cache write | Cache read | Output |
|---|---|---|---|---|---|
| `claude-opus-5-5` | 4 | 5 | 8 | 0.20 | 20 |
| `claude-sonnet-5-5` | 2 | 2.50 | 4 | 0.20 | 10 |
| `claude-haiku-5-5` | 0.10 | 0.125 | 0.20 | 0.01 | 0.50 |

Haiku 5.5 costs 5× these prices when the whole prompt, cache included, is over 100k tokens, and a web search costs $0.01. The Batch API (many requests sent at once, answered within 24 hours) halves everything. The evals use it, but the daily run doesn't: its retry turn would need a second batch.

On Opus 5.5 an evaluation costs about $0.03 (about $2.12 for 75, [measured](evals.md#1-which-model-evaluates-postings)), and a pack about $0.25, plus about $0.006 for the judge.

**Budgets** are runaway guards, not targets: $20 per daily run, $20 per press of Draft packs, $3 per `pnpm fresh`, and $0.50 per Ask question. Once a budget is spent, no new call starts, and calls in flight finish.

## Failure handling

| Case | What happens |
|---|---|
| Collect, screen or discover fails | Logged. The run goes on with the postings already in the database and exits 1 at the end. |
| Refusal or `max_tokens` | The posting or lead is skipped and listed in the summary. `llm_calls.stop_reason` keeps the record. |
| Rate limits, 5xx, overloaded | The SDK retries HTTP errors 4 times. Pack turns also retry an error in the middle of a stream twice, after 5 and 15 seconds. |
| An error escapes | `finishRun` still runs and the CLI exits 1. Everything stored stays, and the next run picks up the rest. |
| Budget reached | No new calls. The run finishes, and the CLI exits 1 with "budget reached". |
| Answer bank doesn't parse | Draft packs fails, and the app shows why. |
| The claim judge fails | No problems from it: an error, a refusal or the budget never costs a pack. |

## Tracing

`pnpm daily-run` and `pnpm fresh` send traces when `OTEL_EXPORTER_OTLP_ENDPOINT` is set ([llm/client.ts](../packages/core/src/llm/client.ts)). They use OpenTelemetry, an open standard for traces, so any backend that takes OTLP works. The Anthropic SDK records a span per call with the full prompt and output, and each posting gets its own trace, tagged with its run as `session.id`. For example, Langfuse:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 of public:secret>,x-langfuse-ingestion-version=4
```

Traces hold the full prompts, including the Answer bank, the profile files and the posting texts. Without the variables, nothing leaves the machine.
