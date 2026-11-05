# Metrics

This page defines every number the tool reports about itself and exactly how each one is computed. It's for anyone reading the Lab page or judging whether the tool helps.

Together the metrics answer one question: does the tool make the job search faster and better, without shortcuts? The definitions are fixed before the data comes in, so they can't be picked to flatter the results. A changed definition is noted here with its reason, and earlier numbers are never quietly recomputed.

## Reading load

How many postings reach the candidate, out of all collected.

- **Formula**: for the period, count each stage: collected (open postings) → passed the screen → evaluated by the model → leads (a Lead verdict, or a Needs check the candidate confirmed) → applications. Report each count and its share of the stage before it.
- **Source**: `postings`, `evaluations` and `applications` (origin `queue` or `outside`).
- **Caveat**: "collected" depends on which companies are watched. Compare periods only while the watchlist is stable, or say how it changed.

## Minutes per decision

How long the candidate spends deciding on a lead (**triage**) and applying to it (**apply**). The app records events in `ui_events`, and [`queue/timing.ts`](../packages/core/src/queue/timing.ts) turns them into durations.

| Clock | Starts at the first of | Stops at |
|---|---|---|
| Triage | the lead opening in Focus (`details_opened`), opening the posting (`posting_opened`), opening the prep pack (`pack_opened`) | a shortlist, a skip or a saved application |
| Apply | the apply session opening (`session_started`), copying an answer (`answer_copied`) | a saved application (`apply_saved`) or a skip |

- **Breaks**: any gap over 30 minutes between two events on the same lead is taken out of each clock.
- **Undo and snooze**: a decision later undone is dropped, with every timing it ended. Work before a snooze is dropped too, and the next decision starts new clocks.
- **Untimed**: a decision with no clock running (for example a skip from a summary) isn't timed. It's counted as untimed and reported alongside, so a falling median can't hide a shift towards untimed skips.
- **Report**: the median per phase, with n (the number of decisions) and the range. Not the mean, because one long application would dominate it.
- **Caveat**: apply time is wall-clock time and includes filling in the company's own form. That's the time being saved, but reading and typing can't be separated. In these clocks, a skip for *Already applied* counts as a skip.

## With and without the prep pack

- **Design**: with the timing experiment switched on (a switch on the Lab page), each lead that has a prep pack gets an arm, `pack` or `no_pack`. The arm comes from a hash of the posting ID and a salt (a random value) drawn when the experiment starts, so the candidate can't choose it. In the `no_pack` arm the pack is hidden in Focus, and the apply session starts from the form's questions only.
- **Report**: the apply clock of [Minutes per decision](#minutes-per-decision) per arm, over about 10 applications in each. Medians with n and the range.
- **Caveat**: n is small and self-measured, and the candidate knows which arm they're in. That's enough to show a direction and a rough size, not to prove a difference, so no significance test is reported.

## Picks worth applying

Whether the leads the pipeline puts in the queue are worth applying to ([`queue/feedback.ts`](../packages/core/src/queue/feedback.ts)).

- **Formula**: applied ÷ (applied + wrong-pick skips).
  - **Applied**: applications made in the queue or outside it (not imported), with an applied date, at any later stage.
  - **Wrong-pick skips**: skips because the role was not eligible, the wrong stack or the wrong level (`not_eligible`, `stack`, `seniority`).
  - Other skip reasons (pay, not interested, the company, another role there) say nothing about the pick and count neither way.
- **Caveat**: this measures precision only. Roles the pipeline wrongly rejected never show up here. Recall comes from the eval set ([evals.md](evals.md)) and the audit evaluations.

## What the checks catch

- **Source**: `agent_attempts`, one row for every submission of every item, rejected ones included ([`agent/attempts.ts`](../packages/core/src/agent/attempts.ts)).
- **Per run** (printed when a run finishes):
  - **Clean on the first attempt**: the first submission was stored with no problem.
  - **Fixed on a retry**: the first had problems, and a later one was stored with none.
  - **Never stored**: every submission in the run was rejected.
  - **Unreadable files** (not JSON, or schema errors tied to no item) and **problems by code**: unknown fact IDs, quotes not found, banned phrasings, unanswered questions, placeholders, over-length answers, claims the judge found unsupported, and so on.
- **Report**: across runs, the share clean on the first attempt and the count per problem code. Each of those problems was caught before it reached the candidate.

## How much the drafts are rewritten

- **Formula**: for each sent answer and cover letter that started from a draft, the share changed: the Levenshtein distance (the fewest single-character edits that turn one text into the other) ÷ the longer text's length. Report the median and the share sent with less than 10% changed.
- **Source**: `application_answers` (`answer` vs `drafted_answer`) and `application_submissions` (`cover_letter` vs `drafted_cover_letter`), computed in [`lab/rewrite-share.ts`](../packages/core/src/lab/rewrite-share.ts). Only submissions with a pinned prep pack count, so the `no_pack` arm is left out.
- **Caveat**: heavy editing isn't failure. A draft rewritten in the candidate's own words still saved the thinking. This shows how usable the drafts are, not whether they helped.

## Outcomes

- **Formula**: the response rate (any reply, rejections included), the median days to the first reply, and the furthest stage reached, from the tracker's event log ([`tracker/stats.ts`](../packages/core/src/tracker/stats.ts)). A reply is an email reply or a stage only the company can move an application to.
- **Caveat**: descriptive only. Outcomes depend on the job market and the roles targeted as much as on the tool, and the samples are small, so they're no proof that the tool made a difference.

## Cost

- **LLM runs on the API**: dollars per run, per 100 postings evaluated and per lead, from `llm_calls` (one row per API call, with its tokens and cost) grouped by run. `agent_runs.stats.cost` holds each run's total, and the Lab's Runs table shows it. Judge calls are logged too, as kind `judge`, and Ask's as kind `ask`, outside any run.
- **Caveat**: runs on the subscription (the `/daily-run` and `/prep` skills) have no cost data. They're left out, not counted as $0.
- **Evals**: dollars per posting and per run, from the token counts saved with every eval answer (`pnpm eval report`, see [evals.md](evals.md)).

## Guardrail

**Applications or messages sent automatically: 0, by design.** The app has no code path that submits a form or sends an email, and every stage change from an email is a proposal the candidate confirms. Gmail access is read-only: the `/replies` skill forbids contacting anyone, and the project settings deny Gmail's send, reply, forward, draft and delete tools.
