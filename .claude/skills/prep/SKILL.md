---
name: prep
description: Draft prep packs on the Claude subscription (the app's Draft packs button does it on the API). "/prep" drafts every pending pack (shortlisted leads first, then new leads and postings you confirmed eligible, packs missing form answers); "/prep 1331 1590" redrafts those postings' packs even if they're complete. Run it from the repo root.
---

# Prep packs on demand

Packs are only drafted on demand: the Draft packs button on Today drafts the shortlist's missing ones on the API, or runs `/prep <ids>` (this skill) on the subscription when there's no API credit. You can also run it yourself. Use it after shortlisting leads in Focus (their packs are drafted first) or confirming an "eligibility unclear" posting in the eligibility gate, or to redraft a pack you don't like.

**Arguments.** Posting ids (space- or comma-separated) mean "redraft exactly these". No arguments means "everything pending", up to **20** packs.

1. `bin/agent start --kind prep` → note the run id.
2. Get the work order:
   - with ids: `bin/agent prep-next --run <id> --posting <ids, comma-separated> --out work/run-<id>/prep-1.json`
   - without: `bin/agent prep-next --run <id> --limit 20 --out work/run-<id>/prep-1.json`

   It reads the application forms first, then prints what needs a pack. If it says a posting isn't a current lead (closed, decided, not a lead, or eligibility not confirmed), tell the user and leave it out.
3. Draft and submit the packs, as below.
4. `bin/agent finish --run <id>`, then print for each posting: stored or not (with the remaining problems), the number of questions answered, and whether a cover letter was written.

## Drafting and submitting
```
bin/agent schema prep --out work/run-<id>/schema-prep.json                 # once; read it
```
**The rules for a pack are in `packages/core/src/agent/prompts/prep.md`:** citations, answers, cover letter, whyUs, the local-language rule and voice. Give every subagent that path.

The work file lists:
- the leads, shortlisted first: posting text, verified facts, `questions`, `youAnswer`, `coverLetter`, `redo`;
- where the candidate's material is.

**Where the inputs are:**
- **`answerBank`:** the Answer bank. Read it fully.
- **`profile.index`:** the profile files under `profile.dir`, one entry per file with its title, section headings and approximate size.
  - **Don't read everything.** For each lead, read the files marked `alwaysRead`, then open only the **1–2 other files whose title and headings best match the role**. For example: a write-up of an operations tool for an operations-tooling role; a library write-up for a developer-tools role; the behavioural answers when the posting asks behavioural questions.
  - `profile.dontSay` lists the phrases code rejects.
- **`profile.styleFile`:** the voice samples.

Cite profile files in `sources` with `file` exactly as listed in `profile.index`.

**Split the leads between subagents** running in parallel, 2–3 leads each. Put leads that need the same project files in one subagent, so each file is read once. Each subagent writes a pack to `work/run-<id>/packs-<n>.json` as `{"packs":[…]}`.

Submit: `bin/agent submit-prep --run <id> work/run-<id>/packs-1.json`.
- Packs with problems are **not stored**.
- Fix exactly what's listed and resubmit, at most 2 attempts.
