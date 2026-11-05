# Design

This page explains how the pipeline works, where it calls an LLM (large language model) and why. It's for engineers who want to read the code, change it or build something similar. The tool never applies, sends email or contacts anyone: a human reviews every result and does the applying.

## Contents

- [Overview](#overview)
- [Configuration](#configuration)
- [Collect](#collect)
- [Screen](#screen)
- [Evaluate](#evaluate)
- [Prep packs](#prep-packs)
- [The app](#the-app)
- [Evals, logs and traces](#evals-logs-and-traces)
- [Two runtimes](#two-runtimes)
- [Ask](#ask)
- [Tooling](#tooling)

## Overview

The tool is a **workflow**, not an **agent**. An agent is one model with tools that decides every step itself. In a workflow, code runs the steps and calls the LLM only at fixed points, each with one narrow job, a fixed input and a checked output.

```
Collect → Screen → Extract facts → Decide → Draft pack → Check claims → Human review
 code      code        LLM          code       LLM        code + LLM        app
```

Why: a workflow can be tested and repeated. The same facts always give the same verdict, every verdict has a recorded reason, and evals measure each LLM step on its own.

## Configuration

Everything that depends on where the candidate lives is configuration, not code. It lives in `data/search.json`, which is not in git. [`seeds/search.example.json`](../seeds/search.example.json) is a fictional candidate in Lisbon.

The file names the home country (its places, ISO codes and currency), the cities where an office role is acceptable, the spoken languages besides English, local words for "developer" in job titles, the countries to search on Workday, and the prep files that packs may cite. [`search-config.ts`](../packages/core/src/search-config.ts) validates the file with Zod (a TypeScript schema library) and reads it once.

## Collect

Code calls the public job-board API of each watched company's ATS (applicant tracking system), such as Ashby, Greenhouse, Lever, Workday or BambooHR. It stores the full text of every posting with an engineering title, with a hash of the text, so an edited posting is evaluated again ([`collect/run.ts`](../packages/core/src/collect/run.ts)).

Why: a direct API call is free, fast, complete and repeatable. A model reading pages with a web-fetch tool is none of those, and it can't read boards that JavaScript renders.

- **Snapshots**: when an evaluation, a re-evaluation request or a submission needs the exact text, the text is saved as a snapshot. Evals replay the text each LLM step saw.
- **Workday**: one Workday employer can list thousands of jobs, so this collector reads only jobs in the configured countries. Workday and BambooHR fetch descriptions one request at a time, only for engineering titles.
- **Discovery**: `pnpm discover` scans a public daily snapshot of about 1.4 million listings (job-board-aggregator) for software roles in Europe at companies not yet watched. It only suggests companies, and once a week the daily run promotes up to 15 of them. `pnpm discover --boards` scans a few public job boards the same way, national ones only for the home country.

## Screen

Cheap rules run before expensive ones ([`screen/rules.ts`](../packages/core/src/screen/rules.ts)). Every posting they remove is an LLM call not paid for.

- **Title rules** drop roles the profile rules out: management, junior, mobile, another main language, infrastructure, data and ML, security, QA, hardware, sales and support.
- **Location rules** drop roles clearly outside Europe (`location.outside_europe`) and office or hybrid roles outside the home country (`location.office_abroad`). A rule gives way when the posting text contradicts the ATS fields, for example an "On-site" field on a posting whose text says remote.
- **Triage** checks the candidate's tracker ([`screen/triage.ts`](../packages/core/src/screen/triage.ts)). It holds back a role already decided, every role at a company that rejected the candidate, and other roles at a company with an active application. A role posted in several countries is evaluated once.
- **Audits**: each daily run also evaluates 3 screen-rejected postings. A lead among them means a rule is too strict.

The rules favor **recall** (keeping every good role) over **precision** (keeping only good roles). Why: a wrongly rejected role is never seen again, while a wrongly passed one costs one LLM call.

## Evaluate

One posting goes in and structured facts come out ([`Facts` in `agent/facts.ts`](../packages/core/src/agent/facts.ts)). The fields include the remote scope, eligibility from the home country, US-only signals, office attendance, required spoken languages (`languages.required`), the stack, pay, seniority and a fit score.

- **Structured outputs.** The API constrains the answer to a JSON schema, so the result always parses into a known shape.
- **Read, don't decide.** The model reports what the posting says. Code makes the decision. Why: a model is good at reading messy text, and code applies the same rule every time.
- **Quotes checked by code.** Each important field carries a verbatim quote, and [`agent/verify.ts`](../packages/core/src/agent/verify.ts) checks every quote against the posting. When a quote isn't found, its claim is downgraded: eligibility becomes `unknown`, and a US-only signal or a language requirement is dropped. So an unverified reason to reject never rejects a role.
- **`unknown` is a valid answer.** `eligibility.status` is `named`, `implied`, `excluded` or `unknown`. Why: when a schema forces a value, the model guesses, and `unknown` gives it an honest way out.
- **One retry.** When a quote isn't found or the schema check fails, the model gets one more turn to fix it.
- **Cost.** The fixed part of the prompt (instructions and candidate profile) uses prompt caching: the API reuses an unchanged prompt start at a fraction of the price. The evals also use the Batch API (answers within 24 hours, at half price). The daily run doesn't, because of the retry turn.

Then [`decide` in `agent/rules.ts`](../packages/core/src/agent/rules.ts) turns the checked facts into one of three verdicts, with reasons such as "Portugal excluded", "German required" or "office required in Berlin".

- **Rejected**: eligibility is excluded; the remote scope is US-only or Americas with no eligibility evidence; two or more US-only signals with unknown eligibility; an office role outside `officeCities`; a required language the candidate doesn't speak; a junior or management role; a stated stack with no TypeScript side.
- **Needs check**: nothing rejects the role, but eligibility is unknown ("eligibility from Portugal unclear"). In the app the candidate can confirm eligibility, which makes the role a lead.
- **Lead**: nothing rejects the role and the fit score is 5 or more out of 10. A lower score rejects it ("low fit"). The fit score is the one fuzzy judgment: the model gives it from a rubric in the prompt.

Changing a filter means changing a line of tested code, not rewording a prompt. `pnpm agent:rescore` re-decides every saved evaluation after a rule change, with no new LLM calls.

## Prep packs

For a lead, the model drafts a **prep pack** ([`agent/prep.ts`](../packages/core/src/agent/prep.ts)). It holds why the candidate fits, what to say about each gap, an answer to every question in the application form except personal ones (salary, visa, consent), a few points about the company found with web search, questions to ask, and a cover letter when the form or posting asks for one.

The pack draws on the candidate's **Answer bank** (verified facts, each with an ID), their **prep files**, **the posting** and the web search. Every claim about the candidate must cite a fact ID or quote a prep file.

Why not RAG? RAG (retrieval-augmented generation) searches a large knowledge base and puts only the matching pieces into the prompt. The Answer bank and prep files fit into every prompt whole, so retrieval would add complexity for no gain.

A pack is text the candidate might send, so it must be clean. A pack with any problem is not stored, and the problems go back to the model to fix.

- **Code checks** (`checkPrepPack` in [`agent/prep.ts`](../packages/core/src/agent/prep.ts)): missing citations, unknown fact IDs, quotes not found in their file or the posting, banned phrasings, unanswered questions, invalid choice answers, placeholders, over-length answers, and a missing or unwanted cover letter.
- **The judge** ([`llm/judge.ts`](../packages/core/src/llm/judge.ts), API runtime only): a second model (Haiku) reads each part of the pack against the whole Answer bank. It rates every claim about the candidate as backed, unsupported or contradicted, and code sends the ones not backed back to the drafting model. Its own eval is in [evals.md](evals.md).

Why a judge: code can check that a quote exists, not that the text says what the quote says. A fresh model whose only job is to doubt does better than the writer checking its own work. The judge reviews only the first submit that passes the code checks, and only if two more submits remain to fix what it finds.

## The app

The app ([`apps/queue`](../apps/queue)) is where the human works. **Today** shows what needs the candidate now, **Focus** shows one lead at a time with its facts, quotes and verdict reasons, and **Apply** has the drafted answers ready to copy into the company's form. **Pipeline** lists applications by stage with a timeline and a call sheet, **Companies** lists watched, paused and discovered companies, **Lab** shows the [metrics](metrics.md), and [Ask](#ask) answers questions.

The human's actions are stored as data, in an event log per application. A **re-evaluation request** saves the verdict the candidate disagreed with and their note; the model reads the posting again without the note, and the pair becomes an eval case. The text actually sent is stored next to the draft it came from, so the difference shows what the model gets wrong.

## Evals, logs and traces

- **Evals**: an eval is a fixed set of test cases (posting text plus the right answer) and a script that scores an LLM step on them, like unit tests for code whose output varies. The labels are the candidate's real decisions to apply or skip. Method and results are in [evals.md](evals.md).
- **Logs**: [`llm/calls.ts`](../packages/core/src/llm/calls.ts) logs every API call in `llm_calls`: kind, model, prompt version (a hash of the system prompt and schema), tokens, cost, latency and stop reason. Each run has a budget, and no call starts once it's spent.
- **Traces**: with `OTEL_EXPORTER_OTLP_ENDPOINT` set, each call becomes an OpenTelemetry span (a timed record of one operation) with its full prompt and output. Any OTLP backend can receive them, such as Langfuse. Without the variable, no traces are sent.

## Two runtimes

The LLM steps run in one of two ways. Both use the same prompts ([`agent/prompts/`](../packages/core/src/agent/prompts)) and the same submit code, so every result meets the same checks: the schema, the quote check, the rules and the fact IDs.

- **API runner**: TypeScript calls the Anthropic Messages API. `pnpm daily-run` works through the backlog, `pnpm fresh` evaluates what a collect just found, and the app's **Draft packs** button drafts packs for shortlisted leads. Details are in [api-runner.md](api-runner.md).
- **Subscription**: Claude Code skills (`/daily-run`, `/prep`, `/replies`) run headless with `claude -p` on a Claude subscription. The model fetches its work and submits results through `bin/agent` commands.
- **Email replies** always run on the subscription (`/replies`), because Gmail is a claude.ai connector. Gmail access is read-only, and the model only proposes stage changes that the candidate confirms.

The switch is automatic: before any work, `apiUsable()` in [`llm/client.ts`](../packages/core/src/llm/client.ts) makes one tiny call to test the key and credit. When there's no key or no credit, `pnpm daily-run` exits with code 3 so its scheduler runs the `/daily-run` skill instead. `pnpm fresh` and Draft packs start the skill themselves (`onSubscription` in [`llm/subscription.ts`](../packages/core/src/llm/subscription.ts)), and Ask starts its own `claude -p` ([`ask/subscription.ts`](../packages/core/src/ask/subscription.ts)).

## Ask

The Ask page answers questions in plain words, such as "how many applications got a reply in October, by channel?". Claude answers from the database, and every tool call shows under the answer. Here the model chooses what to read, so every tool is read-only.

The six tools in [`ask/tools.ts`](../packages/core/src/ask/tools.ts) are the app's own reads (`search_postings`, `posting`, `applications`, `application`, `tracker_stats`) plus `sql` for anything else. The `sql` tool's description lists every table and column, generated from the database schema.

- **One tool set for both runtimes.** The API loop calls `runTool` directly, and `claude -p` gets the same tools from a small MCP server (Model Context Protocol: a standard way to give a model tools). Both check inputs with the same Zod schemas and cap results at 50 rows and 20,000 characters. `claude -p` runs in an empty folder with no settings and no built-in tools, so nothing else enters the conversation.
- **Same events.** Both runtimes turn their output into the same events (`start`, `text`, `tool_call`, `tool_result`, `done`, `error`). The server streams them to the browser as server-sent events (a one-way HTTP stream).
- **A hand-written tool loop** ([`ask/api.ts`](../packages/core/src/ask/api.ts)). When the model ends its turn with tool calls, code runs them all and sends every result back in one message, marking a failed one `is_error`. This repeats until the model answers without a tool, for at most 8 turns or $0.50.
- **Read-only, three ways** ([`ask/sql.ts`](../packages/core/src/ask/sql.ts)). Each guard alone covers the common case:
  1. A Postgres role that can only read (`pg_read_all_data`, from `DATABASE_URL_READONLY`). Without it, Ask returns an error instead of using the main role.
  2. A read-only transaction with a 5-second statement timeout, always rolled back.
  3. A prepared statement inside an outer `LIMIT`. Postgres refuses to prepare more than one statement at once, so a second one can't be smuggled in.
- **No RAG.** The questions are about structured data (counts, dates, stages), and SQL answers them exactly.

## Tooling

The rule: adopt a tool when you feel the problem it solves.

- **Anthropic SDK, used directly.** Three LLM steps with structured output need no framework, and the plain SDK keeps the prompt, schema and token counts visible.
- **No LangChain, LangGraph or n8n.** Their abstractions hide the prompt, schema and tokens, and n8n would move the logic into a visual canvas. The workflow is a small, mostly linear graph that survives restarts because each step's result is saved per posting.
- **Hono with a typed client, not tRPC.** Routes validate input with Zod and form one chain, which the browser calls through `hc<AppType>`. A changed route is then a type error, not a runtime 400. The UI is React with TanStack Router and Query, shadcn/ui and Tailwind.
- **Biome and Knip.** Biome lints and formats; Knip reports unused files, exports and dependencies. `pnpm check` runs both plus the type check and tests, and fails on warnings. GitHub Actions runs it on every push to `main` and every pull request.

Each layer of the app has one job:

| Layer | Owns | Must not |
|---|---|---|
| `packages/core/src/<area>/` | The domain: `queries.ts` (reads), `actions.ts` (writes, each with its `application_events` row), pure functions with tests, Zod schemas | Know about HTTP or React |
| `apps/queue/server/routes/` | Transport: validate, call core once, answer | Hold logic |
| `apps/queue/src/features/<screen>/` | One screen: its queries and actions, one component per file | Fetch inside components, or reach into another feature |
| `apps/queue/src/components/` | Pieces several screens share; `ui/` holds the shadcn components | Know about one feature |
| `apps/queue/src/lib/` | Cross-cutting helpers: the API client, decisions, formatting, hotkeys | Collect helpers only one feature uses |

The browser imports only pure modules from core (constants, schemas, pure functions). Server types reach it through `AppType`.
