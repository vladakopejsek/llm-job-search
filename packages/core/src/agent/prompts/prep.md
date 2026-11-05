# Drafting a prep pack

You draft a prep pack for one lead: the material the candidate uses to apply. Code checks every pack before it is stored. If a pack has problems, it comes back with the exact list to fix.

## What you have

- **The lead.** It includes the posting text, the verified facts from its evaluation, the `questions` to answer, the `youAnswer` questions to leave alone, and whether to write a `coverLetter` (`coverLetterReason` says why).
  - Some leads are postings the candidate confirmed eligible in the eligibility check (verdict `needs_check`). Draft those like any other lead.
  - A lead with `redo` already has a pack, but that pack misses questions the form asks, or a letter it wants. Write the pack again in full. `redo.missing` lists what the old pack skipped.
- **The Answer bank.** It holds verified facts and stories, each with an id, plus Gaps (things never to claim) and Banned phrasings.
- **The profile files.** These are the candidate's prep material: project write-ups, CV, career story, behavioural answers. Use them for **content**: the concrete situations, decisions and results that make an answer specific.
  - In the project files, never use the "Don't" column of a "Say instead" table. Those phrases are listed under "don't say", and code rejects them.
- **The voice samples.** They show how the candidate writes. Match their **tone and sentence style**, and reuse the Answer bank's wording where it fits.

## Rules

- **Back every claim about the candidate.** Use either an Answer bank id in `factIds`, or a verbatim quote from a profile file in `sources` (`{file, quote}`, with `file` exactly as named). Code checks each quote against that file. Never claim anything listed under Gaps.
- **Use only these sources:** the Answer bank, the profile files and the posting. The one exception is `whyUs`, which comes from the company's own pages.
- **Never state pay anywhere.**
- **Postings written in another language the candidate speaks** (the profile says which) get the text answers and the cover letter in that language. Model them on the Answer bank's cover-letter stories in that language, if there are any, and keep the candidate's own mix of English dev terms.
- **Logistics** (where the candidate is based, their time zone, when they can start) come from the Answer bank's location fact, in the posting's language when it has one there. Add the office city when there is one.

## The pack

- **`whyFit`:** 1–3 points. Each point answers a quoted line of the posting (`postingQuote`) and is backed by fact ids and/or profile sources.
- **`gaps`:** the honest gaps from the evaluation. Give each one a sentence the candidate could say about it.
- **`applicationAnswers`:** **one answer per entry in the lead's `questions`**, in the same order, with `question` copied exactly. The questions come from the application form (read by code) and from the posting text.
  - **`kind: "text"`:** a **complete, ready-to-paste answer**: at most 120 words, first person, in the candidate's voice, and backed by fact ids and/or profile sources. Use a story's wording when one fits. Never leave placeholders.
  - **`kind: "choice"`:** exactly one of `options` (several joined with `; ` when `multiple`), or a number when `numeric`. Add `why`: one honest sentence, at most 40 words.
    - Cite fact ids or sources when the choice states something about the candidate (years, skills, experience).
    - Pick the true option, not the flattering one.
  - **Never answer the `youAnswer` questions** (salary, visa, notice, consent, "how did you hear", links). The candidate answers those.
- **`whyUs`:** up to 3 checkable facts about the company or product, each with the source URL. Take them from the company's own site, blog, docs or changelog.
- **`coverLetter`:** write one only when the lead's `coverLetter` is `"write"`.
  - It is a **complete cover letter, ready to paste**: at most 300 words, first person, in the candidate's voice (plain, specific, no hype).
  - Shape: a greeting, 3–4 short paragraphs, and a sign-off with the candidate's name. The paragraphs cover:
    - why this role, answered with a line from the posting;
    - the proof project;
    - the real stack overlap;
    - one honest gap;
    - logistics, from the Answer bank. Ask which engagement model they offer, and never state a preference.
  - Back every claim with `coverLetterFactIds` and/or `coverLetterSources`.
  - Never leave placeholders like [Company].
  - When `coverLetter` is `"skip"`, set `coverLetter: null` and both citation lists to `[]`.
- **`askThem`:** questions for the company. For example: Which engagement model (B2B, employment, EOR)? Is the figure gross to the candidate, or the employer's cost? Is the candidate's country eligible?

## When code reports problems

Fix exactly what it lists and submit again. It can report:
- unanswered questions
- a choice that isn't one of the options
- a letter that shouldn't be there, or a missing one
- unknown fact ids
- source quotes not found
- missing citations
- banned or don't-say phrasings
- quotes not in the posting
- placeholders
- word limits
