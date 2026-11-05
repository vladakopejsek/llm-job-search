# Evals

This page covers the two evals in this repo: which model should evaluate job postings, and whether a second model can catch unsupported claims in prep packs. It's for readers who want to see how the models were chosen, or to rerun an eval after changing a prompt or a rule.

An eval is a fixed set of test cases and code that scores a model's answers on them. Each eval here answers one question with numbers: is this model, prompt or check good enough for the job, and what does it cost?

## Contents

- [How the evals work](#how-the-evals-work)
- [Running the evals](#running-the-evals)
- [1. Which model evaluates postings](#1-which-model-evaluates-postings)
- [2. The pack judge](#2-the-pack-judge)
- [Local models](#local-models)
- [Regression testing](#regression-testing)
- [Limits](#limits)

## How the evals work

- **Batch API.** Requests go through Anthropic's Message Batches API: many requests sent at once, answered within 24 hours (usually under an hour), at half price. The batch id is saved before waiting, so an interrupted run resumes instead of paying twice.
- **Saved runs.** Each run is saved in `data/evals/runs/`: its settings in `<name>.json`, its answers in `<name>.jsonl`, failed requests in `<name>.errors.jsonl`. A run whose answers are saved is never sent again. `data/` is outside git, because the cases hold the candidate's decisions and profile.
- **Grading after saving.** Code grades the saved answers every time you print a report. A fix to the grading or the rules needs no new API calls: print the report again.
- **Intervals.** Every rate comes with a 95% Wilson interval, a confidence range that stays honest for small samples and for rates near 0% or 100%. "89% (82–93%)" means 89% was measured, and the true rate is likely between 82% and 93%. Each case runs more than once (a rep is one run of a case), but intervals count cases, not reps.

The code is in [packages/core/src/evals/](../packages/core/src/evals/), and the command in [cli/eval.ts](../packages/core/src/cli/eval.ts).

## Running the evals

The cases are built from your own database and Answer bank.

```
# 1. Which model evaluates postings
pnpm eval dataset [--sample 100] [--out data/evals/evaluation-v1.jsonl]     # build and freeze the cases
pnpm eval run --name sonnet-medium --model claude-sonnet-5-5 [--effort medium] [--reps 2] [--dataset …] [--direct]
pnpm eval report opus-medium sonnet-medium                                  # the reference run first

# 2. The pack judge
pnpm eval judge-dataset [--parts 150] [--out data/evals/judge-v1.jsonl]     # sample pack parts, plant errors (Opus 5.5)
pnpm eval judge-run --name judge-haiku --model claude-haiku-5-5 [--reps 2] [--dataset …] [--direct]
pnpm eval judge-report judge-opus judge-haiku
```

- **`--direct`** sends the requests one by one at full price, 16 at a time, for when the batch queue is slow.
- **A dataset is never overwritten.** Name a new version with `--out`. Rebuilding one under its old name would make old runs incomparable.
- **A model needs prices** in [llm/calls.ts](../packages/core/src/llm/calls.ts), or the run doesn't start.
- **`report` refuses runs of different datasets**, and warns when the runs used different prompt versions.

## 1. Which model evaluates postings

**Question:** which model should evaluate postings? Per token, Sonnet 5.5 costs half as much as Opus 5.5, and Haiku 5.5 a fortieth.

### Cases

`pnpm eval dataset` ([evals/dataset.ts](../packages/core/src/evals/dataset.ts)) builds `data/evals/evaluation-v1.jsonl`:

- **Labelled, 164.** Postings the candidate decided on, with the text the pipeline read. The label is the candidate's own decision, not another model's output:
  - **apply (115):** shortlisted, applied or any later stage, or skipped because they applied to another role there.
  - **not eligible (33):** skipped as not eligible.
  - **not interested (16):** skipped for pay, the company or taste.
- **Unlabelled, 209.** Evaluated postings sampled evenly by the shipped verdict (lead, needs check, rejected). They show how often a model decides differently from the reference.

The model gets exactly what production sends (`evaluationParams` in [llm/evaluate.ts](../packages/core/src/llm/evaluate.ts)), except the triage note. A note like "company is applied" would leak the label.

### Grading

[evals/grade.ts](../packages/core/src/evals/grade.ts) runs the production path without the database:

1. Parse the answer with the `Facts` schema.
2. Check every quote against the posting text (`verifyFacts`). A quote that isn't there downgrades its claim, as in production.
3. Let the rules decide the verdict (`decide`).

An answer that was cut off, refused or failed the schema gets no verdict. It's counted on its own, never as a wrong verdict.

### Metrics

`pnpm eval report` ([evals/report.ts](../packages/core/src/evals/report.ts)) prints one row per run:

- **Jobs kept (recall):** of the postings the candidate wanted, the share the model doesn't reject. Recall measures what a filter lets through of what you want. A rejection here is a missed job, the costly error.
- **Not eligible caught:** of the postings skipped as not eligible, the share the model rejects. Each one caught is a check the candidate doesn't have to do.
- **Lead precision:** of the labelled postings the model calls a lead, the share the candidate wanted. Precision measures how much of what a filter lets through is right.
- **Same as shipped, same as the reference:** how often the verdict matches the stored production verdict, or the first run named. Counted on all cases, labelled or not.
- **Same across reps:** the share of cases with the same verdict on both reps. This is the model's own noise.
- **No verdict:** answers cut off, refused or failing the schema. "Too long" means over a length limit in `Facts`.
- **Quote misses per answer:** quotes not found in the posting.
- **Cost:** dollars per posting and per run of 75, as production pays: full price, with the cached prompt read from a warm cache. The batch bill isn't used, because a batch caches unevenly.

Two baselines sit beside the runs: **always lead** (no model) and the **shipped pipeline** (the stored production verdicts). Below the table, the report lists the wanted jobs each run rejects and the labelled cases where a run disagrees with the reference. Read them before trusting a number.

### Results

Measured: 373 cases (164 labelled), each model at production's medium effort, two reps per case. The rules change over time, and each table was graded with the rules of its own moment, so compare rows within a table, not across tables.

| Run | Jobs kept (recall) | Not eligible caught | Lead precision | Same as Opus | Same across reps | No verdict | Quote misses per answer | $ per run of 75 |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | 89% (82–93%) | 12% (5–27%) | 80% (70–88%) | – | 95% | 0 | 0.28 | $2.12 |
| Sonnet 5.5 | 90% (83–94%) | 15% (7–31%) | 81% (69–89%) | 85% | 97% | 3 too long | 0.65 | $0.96 |
| Haiku 5.5 | 80% (72–87%) | 12% (5–28%) | 73% (59–83%) | 78% | 87% | 17 too long | 0.49 | $0.07 |
| Always lead | 100% | 0% | 70% | – | – | – | – | $0 |

- **Sonnet decides as well as Opus at under half the price.** Their rates are within a few points of each other, well inside the noise. Opus quotes more faithfully (0.28 quote misses per answer against 0.65), but most misses are quotes of the header lines, which the prompt now forbids (see [the quote rule](#example-the-quote-rule)).
- **Haiku isn't good enough.** It rejects one wanted job in five, and its leads are barely more precise than "always lead". One case in eight gets a different verdict on the second rep.
- **No model catches many ineligible roles (12–15%).** Most of the 33 get "needs check": the posting is tied to one country without saying that remote work from elsewhere is out. The candidate skipped them for what the posting didn't say, and "needs check" is the right verdict for that.
- **The eval found a bug in the rules, not the model.** Opus sometimes writes one stack entry for several languages ("JavaScript/TypeScript"), and `decide` rejected such roles for their stack. [agent/rules.ts](../packages/core/src/agent/rules.ts) splits these entries now. The fix was checked by grading the saved answers again, with no new API calls.
- **The set is small.** 115 wanted jobs means about ±6 points of noise on recall.

### The Profile section

The evaluation prompt includes the Profile section of the Answer bank. Its wording moves the verdicts as much as the choice of model. To test a variant without touching your bank, point `ANSWER_BANK_PATH` at a copy.

Measured: Sonnet 5.5 on the same 373 cases, one Profile per run. The first row is the Sonnet run above. The last row was graded with newer rules than the others, so its bullet below compares it with a run under the same rules.

| Profile | Jobs kept (recall) | Not eligible caught | Lead precision | Same across reps | No verdict | Quote misses per answer | $ per run of 75 |
|---|---|---|---|---|---|---|---|
| Fully remote work only | 90% (83–94%) | 15% (7–31%) | 81% (69–89%) | 97% | 3 too long | 0.65 | $0.96 |
| Also hybrid or office roles in nearby cities | 95% (90–98%) | 12% (5–27%) | 77% (65–85%) | 96% | 1 too long | 0.58 | $0.98 |
| Remote anywhere, office only in named cities, plus the `officeCities` rule | 95% (89–98%) | 14% (6–29%) | 82% (71–90%) | 97% | 0 | 0.62 | $0.97 |
| The row above, plus recent backend share and business domains | 97% (93–99%) | 18% (9–34%) | 82% (72–89%) | 97% | 1 too long | 0.60 | $0.98 |

- **The Profile must say where the candidate would go to an office.** With "fully remote" alone, models rate hybrid and office roles near home low, and the rules reject them for low fit. Accepting nearby offices halves those misses, but precision drops, because the model also likes office roles in cities the candidate skipped.
- **Naming the cities fixes both.** The Profile names them, and `officeCities` in `data/search.json` makes the rules reject office roles anywhere else. That keeps 95% of wanted jobs at 82% lead precision.
- **Paired flips are stronger evidence than the intervals.** The intervals of the first two rows overlap, but 23 cases changed verdict between the two runs, mostly from rejected to lead.
- **A fuller Profile helps.** Two more lines (the share of recent backend work, and the business domains the candidate knows) keep recall at 97% and raise not eligible caught from 11% to 18%, against a run with the same rules. Of 12 labelled flips, 5 wanted jobs move from needs check to lead, their reasons citing the domains, and 3 ineligible roles are rejected.

**In the runner:** Opus 5.5 is the default (`MODEL` in [llm/client.ts](../packages/core/src/llm/client.ts)), because it quotes most faithfully, at about $2.12 a run. On a paid budget Sonnet 5.5 is the better buy: the same decisions for under half the price (`pnpm daily-run --model claude-sonnet-5-5`).

## 2. The pack judge

**Question:** can a model catch claims in a prep pack that its cited evidence doesn't back?

Code already checks that every cited fact id exists and every quote is word for word in its file. It can't check that the sentence says what the evidence says. A quote about a team of three, cited for "led a team of ten", passes.

### The judge

The judge ([llm/judge.ts](../packages/core/src/llm/judge.ts), rubric in [agent/prompts/judge.md](../packages/core/src/agent/prompts/judge.md)) makes one call per pack part: a why-fit point, a form answer (for a choice question, the choice with its reason), or a cover letter.

- **System prompt:** the rubric and the whole Answer bank, cached.
- **User message:** the part and the evidence it cites.
- **Answer:** a structured output (JSON the API holds to a schema). It lists every claim about the candidate with the exact phrase and a verdict: backed, unsupported or contradicted. Code keeps the claims that aren't backed.

### Cases

`pnpm eval judge-dataset` ([evals/judge.ts](../packages/core/src/evals/judge.ts)) builds `data/evals/judge-v1.jsonl`:

1. Sample about 150 parts from stored packs: 40% why-fit points, 33% answers, 27% cover letters.
2. Opus 5.5 plants exactly one unsupported claim in a copy of each. Four kinds take turns: a changed number, an added technology, an invented achievement, a changed employer or title.
3. Code keeps a plant only if the text changed, the planted phrase is new and appears in it, and the rest wasn't rewritten.

Each part is judged twice: as stored, and with the planted error.

### Metrics

`pnpm eval judge-report`:

- **Planted caught:** the share of planted parts where a flag covers at least half of the planted phrase's words. The report also splits it by kind.
- **Untouched parts flagged:** flags on the parts as stored. Each one is a real problem in a stored pack or a false alarm, so the report lists them for a person to read. That reading calibrates the judge.
- **Other flags per planted part:** noise beside the real error.

### Results

Measured: 149 parts (60 why-fit, 50 answers, 39 cover letters), each judged as stored and with one planted error, two reps per judge.

| Judge | Planted caught | Untouched parts flagged | Other flags per planted part | $ per part |
|---|---|---|---|---|
| v1 Opus 5.5 | 79% (72–85%) | 61% | 1.27 | $0.0120 |
| v1 Sonnet 5.5 | 89% (82–93%) | 71% | 1.23 | $0.0047 |
| v1 Haiku 5.5 | 88% (82–92%) | 62% | 1.02 | $0.0004 |
| v2 Opus 5.5 | 85% (79–90%) | 34% | 0.54 | $0.0102 |
| v2 Sonnet 5.5 | 90% (84–94%) | 57% | 0.92 | $0.0048 |
| v2 Haiku 5.5 | 91% (85–95%) | 37% | 0.49 | $0.0005 |
| v3 Sonnet 5.5 | 88% (82–92%) | 38% | 0.60 | $0.0088 |
| **v3 Haiku 5.5** | **93% (87–96%)** | **39%** | 0.59 | **$0.0008** |

The three judge versions:

- **v1** sees only the evidence a part cites. Many of its flags on stored parts are true claims with incomplete citations.
- **v2** also sees the whole Answer bank, and flags only what nothing in it backs.
- **v3**, the current judge, lists every claim with a verdict, and code keeps the unbacked ones. Deciding claim by claim stops it from listing a claim it has just called backed. The rubric also names what isn't a claim, such as opinions, gaps and colleagues' work.

Findings:

- **The biggest model is the worst judge.** Opus 5.5 catches the fewest planted errors at the highest price, and misses blatant ones, such as a language the candidate never used added to their core stack. Opus also wrote the planted errors, and a model tends to find its own phrasing plausible (self-preference), so a judge from a different model than the writer is safer.
- **Technology lists are the hardest kind** (66–79% caught). An extra tool slipped into "MySQL, Redis and Docker" reads as natural.
- **Many stored packs make claims the Answer bank doesn't back.** Of 25 sampled v3 Haiku flags on stored parts, about 14 are real (unbacked technical details, a hedge turned into a claim, two past jobs in the wrong order), about 6 are minor embellishments ("daily", "site-wide") and about 5 are false alarms. The code checks catch none of the real ones.

**In the runner:** v3 on Haiku 5.5 reviews packs in the API runner. Its unbacked claims go back to the drafting model as problems to fix (see [api-runner.md](api-runner.md#drafting-a-pack)). It costs about $0.006 per pack, plus the extra drafting turn.

## Local models

**Question:** could a self-hosted model sit between the API and the subscription, as a third runtime? The candidates are qwen3.5:9b (a dense model: all its parameters run for each token) and qwen3.5:35b (a mixture of experts: only 3B of its parameters run for each token). Ollama, a tool that serves open models locally, ran them on one 8 GB GPU.

The runner for this test isn't in the repo. It sent production's `evaluationParams` and `judgeParams` to Ollama's `/api/chat` and saved the answers as run files, so `pnpm eval report` and `judge-report` graded them like any other run. One rep, thinking off.

**Evaluations**, on the 164 labelled cases. The Sonnet row is the last Profile run above.

| Run | Jobs kept (recall) | Not eligible caught | Lead precision | Same as Sonnet | Quote misses per answer | Seconds per posting |
|---|---|---|---|---|---|---|
| Sonnet 5.5 | 97% (93–99%) | 18% (9–34%) | 82% (72–89%) | – | 0.60 | – |
| qwen3.5:35b | 93% (87–96%) | 24% (13–41%) | 74% (60–84%) | 66% | 2.94 | 81 |
| qwen3.5:9b | 89% (82–94%) | 18% (9–34%) | 70% (60–78%) | 65% | 1.50 | 68 |
| Always lead | 100% | 0% | 70% | – | – | – |

**The judge**, on the parts of the first 50 packs (100 parts), with Haiku run again on the current Answer bank:

| Judge | Planted caught | Untouched parts flagged | Other flags per planted part | Per part |
|---|---|---|---|---|
| Haiku 5.5 | 94% (84–98%) | 28% (17–42%) | 0.34 | $0.0005 |
| qwen3.5:35b | 88% (76–94%) | 52% (39–65%) | 0.42 | 22 s |
| qwen3.5:9b | 82% (69–90%) | 38% (26–52%) | 0.40 | 40 s |

On all 149 parts, the 9b caught 75% against Haiku's 89%, and flagged 57% of untouched parts against 37%.

- **The answers are well-formed.** Ollama's `format` option turns the JSON Schema into a grammar the decoder must follow. All but one of 328 evaluation answers parsed.
- **The 9b is no filter.** Its leads are exactly as precise as calling everything a lead. Its fit scores run backwards: 7.3 on average for jobs the candidate wasn't interested in, 6.7 for the ones they applied to.
- **The 35b falls short on judgment, not quoting.** Most of its quote misses are mechanical: it quotes the header lines, or joins passages out of order. Its fit score barely separates wanted jobs (5.9 on average) from ineligible ones (5.6), where Sonnet's are 6.2 and 4.6.
- **As a judge, the 35b catches nearly what Haiku does, but flags almost twice as many untouched parts.** Each flag is a rewrite request.

Serving gotchas, each found by a wrong number:

- **`format` constrains the output but doesn't show the model the schema.** Put the schema in the system prompt too.
- **The default context is 4096 tokens.** Longer prompts are cut without an error.
- **The KV cache (the memory that holds the context during generation) is reserved up front.** A 32k context pushed part of the 9b off the GPU and made it 3–5x slower; 16k fits.
- **Ollama's Anthropic-compatible `/v1/messages` ignores `output_config.format`.** Production would need its own adapter.

**In the runner:** there's no local tier. Placed in front of the subscription, it would give leads only slightly more precise than no filter (74% and 70%, against 70% for always lead). The judge is the one place a local model could add something, since the subscription path has no judge: the 35b would catch most unbacked claims, at the cost of a rewrite request on half the parts.

## Regression testing

Grading runs on saved answers, so a change to the rules ([agent/rules.ts](../packages/core/src/agent/rules.ts)) or the quote checks needs no new run: print the report again. A change to the evaluation prompt ([agent/prompts/evaluation.md](../packages/core/src/agent/prompts/evaluation.md)) or the `Facts` schema needs a new run of the production model on the same dataset:

```
pnpm eval run --name opus-medium-<change> --model claude-opus-5-5 --reps 2
pnpm eval report opus-medium opus-medium-<change>
```

The report lists every labelled case whose verdict changed. A change ships if recall holds within the noise and the flips read as improvements. A new kind of mistake found in production becomes a case in the next dataset version (`--out data/evals/evaluation-v2.jsonl`).

### Example: the quote rule

The model reads the company, title, location and workplace lines above the posting text. Quotes are checked against the posting text only, so a quote of those header lines ("Location: Remote") always fails, downgrades its claim and costs production a retry turn. This test compares three wordings of the quote rule (rule 1 in `evaluation.md`).

Measured: Opus 5.5 on the 164 labelled cases, two reps per case.

| Quote rule | Jobs kept (recall) | Not eligible caught | Lead precision | Quote misses per answer | $ per run of 75 |
|---|---|---|---|---|---|
| No rule about the header lines | 96% (90–98%) | 12% (5–27%) | 80% (70–87%) | 0.26 | $2.28 |
| Never quote the header lines; if only they say where the role is, say unknown | 96% (90–98%) | 6% (2–20%) | 79% (69–87%) | 0.02 | $2.29 |
| **The header lines are context: read them, never quote them** | **96% (91–98%)** | 8% (2–22%) | **81% (72–88%)** | **0.03** | $2.30 |

- **Quote misses fall almost tenfold** with either wording, so production's retry turn becomes rare. Recall holds.
- **"Say unknown" makes the model ignore the header.** For example, a role whose country list leaves out the home country becomes a lead. Ineligible roles caught fall by half.
- **"Context" keeps the header useful.** Its lead precision is the best of the three: 9 wanted jobs move from needs check to lead, their reasons citing the location list. The prompt uses this wording, and the quote retry message says the same.

## Limits

- **Selection bias.** The labelled postings are ones the shipped pipeline put in the queue, so it keeps every wanted job and catches no ineligible one by construction. The set also can't show a wanted job the pipeline never surfaced; the daily run's audit items (postings the screen rejected, evaluated anyway) cover that side.
- **One shot.** Production gives an answer one retry when quotes aren't found; the eval doesn't. A missed quote pushes a verdict towards "needs check", so single-shot verdicts lean lenient, the same way for every model.
- **Label noise.** "Not eligible" is the candidate's call, sometimes made on what the posting doesn't say. Some planted errors aren't errors either: one plant changed a count to the number the evidence actually gives.
- **Small sets.** With 115 wanted jobs, a difference of a few points is noise. Read the disagreements, and look at paired flips.
- **Calibration by Claude.** The reading of the judge's flags on stored parts was done by Claude. A person reading a dozen flags is the better calibration.
- **Local models aren't reproducible from the repo.** Their runner isn't kept.
