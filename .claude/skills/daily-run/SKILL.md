---
name: daily-run
description: The daily run on the Claude subscription, the fallback for when there's no API credit. It collects new postings and evaluates them against the candidate's filters. Email replies aren't part of it: `/replies` runs after every collect. "/daily-run new <ids>" only evaluates the postings a collect just found (`pnpm fresh` runs it). Prep packs aren't part of it: they're drafted on demand (the app's Draft packs button, or /prep). With API credit, `pnpm daily-run` (src/cli/daily-run.ts) does the same run on the API. Run this from the repo root.
---

# Daily run (subscription fallback)

**Modes:**
- **Plain `/daily-run`:** the scheduled run. Up to **75** evaluations.
- **`/daily-run backfill`:** the catch-up run for a large backlog. Up to **100** evaluations.
- **`/daily-run new <comma-separated posting ids>`:** right after a collect, when there's no API credit (`pnpm fresh` runs it). Skip step 1. Up to **60** evaluations, chosen only among those postings: add `--within <the ids>` to every `next`, and no `--audit`.

Everything else is the same in all modes. Wherever this file says "the evaluation limit", use the limit of your mode.

**Keep it in step with the API runner.** `src/cli/daily-run.ts` defines the limits, the step order and the weekly discover rule, and this skill follows it. A change to any of those updates both in the same commit.

You are the reading-and-writing part of this job-search tool. The app decides. You read postings and draft text, and code checks every result you submit. Work autonomously: nobody is watching. At the end, print the run summary.

## Hard rules
- **Never apply, email, message or contact anyone.**
- **Only the commands below touch the database.** Never run SQL, never edit code, and never change `.env` or settings.
- **Work files go in `work/run-<id>/`** (gitignored).
- **Use `bin/agent …` for every app command.** Its exit codes are reliable: 0 ok, 1 error (some or all of it not stored), 2 stored with downgrades.

## 1. Collect
```
pnpm collect                          # 2–7 min: fetch all boards, screen, triage
pnpm discover --auto-promote          # new companies from the aggregator snapshot; promotes at most once a week, skips otherwise
```
If collect fails completely (e.g. no network), note it and continue with what's already in the database.

## 2. Start
```
bin/agent start                       → "Run id: <id>"   (use it as --run <id> everywhere)
```
Start only after collecting. The Lab matches each run to the collect run that started just before it.

## 3. Evaluate postings (up to the evaluation limit)
```
bin/agent schema evaluation --out work/run-<id>/schema-evaluation.json     # once; read it
bin/agent next --run <id> --limit 10 --audit 3 --out work/run-<id>/batch-1.json   # --audit 3 only on the first batch
```
**The rules for each posting are in `packages/core/src/agent/prompts/evaluation.md`:** quotes, audit and re-evaluation items, and the fit rubric. The candidate is the `## Profile` section of `data/answer-bank.md`.

Each work item has `postingId`, `snapshotId`, `purpose`, `note`, company, title, location and the full `text`.

**Split each batch between subagents**, about 5 items each, running in parallel.
- Give each subagent its items, the schema file path, the Profile section and the path to `evaluation.md`.
- Each writes `work/run-<id>/results-<batch>-<n>.json` as `{"results":[{postingId, snapshotId, facts}]}` and returns only the file path.

Then submit each file:
```
bin/agent submit --run <id> work/run-<id>/results-1-1.json
```
- **Exit 1:** something wasn't stored: schema errors (nothing stored), or the postings marked ERROR (the others were). Fix what's listed and resubmit.
- **Exit 2:** stored, but some quotes weren't found, so those claims were downgraded. If you can find the exact wording in the text, fix the quote and resubmit (it overwrites). Otherwise leave it.
- At most 2 attempts per file. After that, move on and mention it in the summary.

**Repeat** `next` → evaluate → `submit` until `next` prints "No work left." or the evaluation limit is reached.
- The work comes most promising first, so stopping at the limit leaves the long shots for later runs.
- **Always submit a batch before asking for the next one**, or you'll get the same items again.

## 4. Finish
```
bin/agent finish --run <id>
```
Print its summary. Then add anything the candidate should know:
- files that failed twice
- feeds that errored
- audit items judged as leads (a rule may be too strict)
- whether collect failed
