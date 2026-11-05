import { and, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type ApplicationForm, COVER_LETTER, classify, type FormQuestion } from "../ats/forms.ts";
import type { Db } from "../db/client.ts";
import { applications, companies, evaluations, postingSnapshots, postings, prepPacks } from "../db/schema.ts";
import { type AnswerBank, citableIds } from "./answer-bank.ts";
import type { Problem, ProblemCode } from "./attempts.ts";
import type { Facts } from "./facts.ts";
import { quoteFound } from "./quotes.ts";
import type { ProfileSources } from "./sources.ts";
import { formatIssues } from "./submit.ts";

/** Answer limits from the old pipeline's prep pack format. */
export const MAX_ANSWER_WORDS = 120;
const MAX_COVER_LETTER_WORDS = 300;
const MAX_WHY_WORDS = 40;

const FactIds = z.array(z.string()).describe("Answer bank ids (fact.* or story.*) this text relies on.");

const Sources = z
  .array(
    z
      .object({
        file: z.string().describe("A profile file path exactly as listed in the work order's profile.index."),
        quote: z.string().min(3).describe("Text copied verbatim from that file that backs the claim."),
      })
      .strict(),
  )
  .describe("Quotes from the candidate's profile files backing this text. Every claim about the candidate needs a fact id or a source quote.");

export const PrepPack = z
  .object({
    postingId: z.number().int(),
    cvHeadline: z.string().max(80).describe('e.g. "Senior Frontend Engineer" or "Senior Product Engineer"'),
    summary: z.string().max(300).describe("Two sentences: why this role, for this candidate."),
    whyFit: z
      .array(
        z
          .object({
            text: z.string().max(250),
            factIds: FactIds,
            sources: Sources,
            postingQuote: z.string().min(3).describe("The line of the posting this point answers, verbatim."),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    gaps: z
      .array(
        z
          .object({
            gap: z.string().max(150),
            sayThis: z.string().max(250).describe("One honest sentence the candidate could say about it."),
          })
          .strict(),
      )
      .max(4),
    applicationAnswers: z
      .array(
        z
          .object({
            question: z.string().describe("The question exactly as it appears in the work order's `questions`."),
            answer: z
              .string()
              .min(1)
              .describe(
                `Open questions: the complete answer, written to be pasted into the form as is (no placeholders or notes), at most ${MAX_ANSWER_WORDS} words. Choice questions: exactly one of the listed options (several joined with "; " when the question allows more), or a number when a number is asked.`,
              ),
            why: z
              .string()
              .max(300)
              .optional()
              .describe(`Choice questions only: one sentence on why this option is the honest one (at most ${MAX_WHY_WORDS} words).`),
            factIds: FactIds,
            sources: Sources,
          })
          .strict(),
      )
      .describe("One answer per question in the work order's `questions` (open and choice), in the same order. Never the `youAnswer` ones."),
    whyUs: z
      .array(z.object({ point: z.string().max(250), sourceUrl: z.url() }).strict())
      .max(3)
      .describe("Checkable facts about the company or product, each with a source link."),
    coverLetter: z
      .string()
      .min(1)
      .nullable()
      .describe(
        `null when the work order's coverLetter is "skip". Otherwise the complete cover letter, ready to paste: a greeting, 3–4 short paragraphs (why this role, the proof project, the real stack overlap, one honest gap, logistics from the Answer bank; ask which engagement model they offer, never state a preference) and a sign-off with the candidate's name. No placeholders. At most ${MAX_COVER_LETTER_WORDS} words.`,
      ),
    coverLetterFactIds: FactIds.describe("Answer bank ids for claims about the candidate in the cover letter."),
    coverLetterSources: Sources.describe("Profile quotes for claims about the candidate in the cover letter."),
    askThem: z.array(z.string()).max(4),
  })
  .strict();
export type PrepPack = z.infer<typeof PrepPack>;

export const PrepSubmission = z.object({ packs: z.array(PrepPack).min(1) }).strict();

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const normalize = (q: string) => q.replace(/\s+/g, " ").trim().toLowerCase();

/** A question the pack must answer: open (drafted in full) or choice (one option, with why). */
interface PackQuestion {
  question: string;
  kind: "text" | "choice";
  required: boolean;
  options?: string[];
  multiple?: boolean;
  numeric?: boolean;
  /** Where it was found: the ATS form, or only the posting text. */
  source: "form" | "posting";
}

/** What a pack for this posting must contain, derived by code from the form and the facts. */
export interface PackExpectations {
  questions: PackQuestion[];
  /** Asked in the form, but only the candidate can answer (salary, visa, consent…): listed, never drafted. */
  youAnswer: FormQuestion[];
  coverLetter: "write" | "skip";
  coverLetterReason: string;
}

/**
 * The questions to answer: every open or choice question of the form, plus
 * questions only the posting text asks (an evaluation copies those into
 * facts.applicationQuestions). A posting question that repeats a form question
 * is dropped.
 */
export function packExpectations(facts: Pick<Facts, "applicationQuestions">, form: ApplicationForm | null, postingText: string): PackExpectations {
  const questions: PackQuestion[] = [];
  const youAnswer: FormQuestion[] = [];
  for (const q of form?.questions ?? []) {
    if (q.kind === "personal") youAnswer.push(q);
    else
      questions.push({
        question: q.question,
        kind: q.kind,
        required: q.required,
        options: q.options,
        multiple: q.multiple,
        numeric: q.numeric,
        source: "form",
      });
  }
  const known = [...questions, ...youAnswer].map((q) => normalize(q.question));
  for (const raw of facts.applicationQuestions) {
    const question = raw.replace(/\s+/g, " ").trim();
    const n = normalize(question);
    if (!n || known.some((k) => k === n || k.includes(n) || n.includes(k))) continue;
    known.push(n);
    if (classify(question, "text") === "personal") youAnswer.push({ question, kind: "personal", required: false });
    else questions.push({ question, kind: "text", required: false, source: "posting" });
  }

  let coverLetter: PackExpectations["coverLetter"] = "write";
  let coverLetterReason: string;
  if (!form) coverLetterReason = "The application form couldn't be read, so write one to be safe.";
  else if (form.coverLetter !== "none") coverLetterReason = `The form has a ${form.coverLetter} cover-letter field.`;
  else if (COVER_LETTER.test(postingText)) coverLetterReason = "The posting asks for a cover letter.";
  else {
    coverLetter = "skip";
    coverLetterReason = "The form has no cover-letter field and the posting doesn't ask for one.";
  }
  return { questions, youAnswer, coverLetter, coverLetterReason };
}

/** Questions of `expected` the pack has no answer for. */
export function unansweredQuestions(pack: Pick<PrepPack, "applicationAnswers">, expected: Pick<PackExpectations, "questions">) {
  const answered = new Set(pack.applicationAnswers.map((a) => normalize(a.question)));
  return expected.questions.filter((q) => !answered.has(normalize(q.question)));
}

/**
 * Check a pack against the Answer bank and the posting. Unlike evaluations,
 * a pack with problems is not stored: it goes to the candidate as text they
 * might send, so it must be clean. With `expected`, it must also answer every
 * question of the form and the posting, and carry a cover letter exactly when
 * one is asked for.
 */
export function checkPrepPack(
  pack: PrepPack,
  bank: AnswerBank,
  postingText: string,
  profile: Pick<ProfileSources, "files" | "banned"> = { files: new Map(), banned: [] },
  expected?: PackExpectations,
): Problem[] {
  const problems: Problem[] = [];
  const add = (code: ProblemCode, message: string) => problems.push({ code, message });
  const ids = citableIds(bank);

  // Every claim about the candidate is backed by an Answer bank fact or a verbatim profile quote.
  const cite = (where: string, factIds: string[], sources: { file: string; quote: string }[], required = true) => {
    if (required && !factIds.length && !sources.length) add("no_citation", `${where}: no citation (needs a fact id or a profile source quote)`);
    for (const id of factIds) if (!ids.has(id)) add("unknown_fact_id", `${where}: unknown fact id "${id}"`);
    for (const src of sources) {
      const text = profile.files.get(src.file);
      if (text === undefined) add("bad_source_file", `${where}: "${src.file}" is not a citable profile file`);
      else if (!quoteFound(src.quote, text)) add("source_quote_not_found", `${where}: quote not found in ${src.file} (or it's a "don't say" line)`);
    }
  };
  pack.whyFit.forEach((w, i) => {
    cite(`whyFit[${i}]`, w.factIds, w.sources);
    if (!quoteFound(w.postingQuote, postingText)) add("posting_quote_not_found", `whyFit[${i}].postingQuote not found in the posting`);
  });

  const byQuestion = new Map((expected?.questions ?? []).map((q) => [normalize(q.question), q]));
  pack.applicationAnswers.forEach((a, i) => {
    const where = `applicationAnswers[${i}]`;
    const q = byQuestion.get(normalize(a.question));
    if (expected && !q) {
      const personal = expected.youAnswer.some((y) => normalize(y.question) === normalize(a.question));
      add(
        "question_mismatch",
        personal
          ? `${where}: "${a.question}" is for the candidate to answer; leave it out`
          : `${where}: "${a.question}" is not one of the work order's questions (copy the question exactly)`,
      );
      return;
    }
    if (q?.kind === "choice") {
      // A choice: one of the listed options (or a number), and why. Cited when it claims something about the candidate.
      cite(where, a.factIds, a.sources, false);
      if (!a.why?.trim()) add("choice_invalid", `${where}: a choice needs "why"`);
      else if (words(a.why) > MAX_WHY_WORDS) add("over_length", `${where}.why: ${words(a.why)} words (max ${MAX_WHY_WORDS})`);
      if (q.numeric && !/^\d+(\.\d+)?\+?$/.test(a.answer.trim())) add("choice_invalid", `${where}: expected a number, got "${a.answer}"`);
      if (q.options?.length) {
        const options = new Set(q.options.map(normalize));
        const picked = q.multiple ? a.answer.split(";").map(normalize).filter(Boolean) : [normalize(a.answer)];
        const unknown = picked.filter((p) => !options.has(p));
        if (unknown.length || !picked.length)
          add("choice_invalid", `${where}: "${a.answer}" is not one of the options: ${q.options.map((o) => `"${o}"`).join(", ")}`);
      }
      return;
    }
    cite(where, a.factIds, a.sources);
    if (words(a.answer) > MAX_ANSWER_WORDS) add("over_length", `${where}: ${words(a.answer)} words (max ${MAX_ANSWER_WORDS})`);
  });
  if (expected) {
    for (const q of unansweredQuestions(pack, expected)) add("unanswered_question", `not answered: "${q.question}"`);
    if (expected.coverLetter === "skip" && pack.coverLetter !== null)
      add("cover_letter_unexpected", `coverLetter must be null: ${expected.coverLetterReason}`);
    if (expected.coverLetter === "write" && pack.coverLetter === null)
      add("cover_letter_missing", `coverLetter is missing: ${expected.coverLetterReason}`);
  }

  if (pack.coverLetter !== null) {
    cite("coverLetter", pack.coverLetterFactIds, pack.coverLetterSources);
    const letterWords = words(pack.coverLetter);
    if (letterWords > MAX_COVER_LETTER_WORDS) add("over_length", `coverLetter: ${letterWords} words (max ${MAX_COVER_LETTER_WORDS})`);
  }
  // Drafts are pasted as they are, so leftover template markers are an error.
  const drafts: [string, string][] = [
    ...(pack.coverLetter !== null ? [["coverLetter", pack.coverLetter] as [string, string]] : []),
    ...pack.applicationAnswers.flatMap((a, i): [string, string][] =>
      byQuestion.get(normalize(a.question))?.kind === "choice" ? [] : [[`applicationAnswers[${i}].answer`, a.answer]],
    ),
  ];
  for (const [where, text] of drafts) {
    if (/\[[^\]]*\]|\{\{|\bTODO\b|\bXXX\b|<(name|company|role)>/i.test(text)) add("placeholder", `${where}: contains a placeholder`);
  }

  // Banned phrasings, anywhere in the text the candidate might send.
  const texts: [string, string][] = [
    ["cvHeadline", pack.cvHeadline],
    ["summary", pack.summary],
    ...pack.whyFit.map((w, i): [string, string] => [`whyFit[${i}].text`, w.text]),
    ...pack.gaps.map((g, i): [string, string] => [`gaps[${i}].sayThis`, g.sayThis]),
    ...pack.applicationAnswers.map((a, i): [string, string] => [`applicationAnswers[${i}].answer`, a.answer]),
    ...(pack.coverLetter !== null ? [["coverLetter", pack.coverLetter] as [string, string]] : []),
  ];
  for (const [where, text] of texts) {
    for (const b of [...bank.banned, ...profile.banned]) {
      if (b.pattern.test(text)) add("banned_phrase", `${where}: banned phrasing ${b.label}${b.note ? ` (${b.note})` : ""}`);
    }
  }
  return problems;
}

/**
 * A lead by the rules, or a "needs check" the candidate confirmed is open to
 * them. Both go to Ready and get a prep pack.
 */
const countsAsLead = () =>
  or(eq(evaluations.verdict, "lead"), and(eq(evaluations.verdict, "needs_check"), isNotNull(postings.eligibilityConfirmedAt)));

const isShortlisted = () => sql`exists (select 1 from ${applications} a where a.posting_id = ${postings.id} and a.stage = 'shortlisted')`;

/**
 * The evaluation a pack is drafted for and checked against: the lead evaluation of the text on the board,
 * or, for a shortlisted posting, its latest one. The candidate said yes to that, whatever the verdict
 * (⌘K can shortlist anything) and even if the company edited the posting since (the Shortlist shows the same one).
 */
const packEvaluation = () =>
  or(
    and(countsAsLead(), eq(evaluations.purpose, "queue"), eq(postingSnapshots.contentHash, postings.contentHash)),
    and(
      isShortlisted(),
      sql`${evaluations.id} = (select e.id from ${evaluations} e where e.posting_id = ${postings.id} order by e.created_at desc, e.id desc limit 1)`,
    ),
  );

/** Stages at which the candidate has already decided about a posting. */
const DECIDED_STAGES = ["applied", "screening", "interviewing", "offer", "rejected", "no_response", "skipped"] as const;

/** Current leads (text on the board now, queue purpose, not decided, company watched), with their pack if any. Shortlisted ones count whatever their verdict or company (packEvaluation): they wait for a pack. */
function currentLeads(db: Db) {
  const decided = db
    .select({ id: applications.postingId })
    .from(applications)
    .where(and(inArray(applications.stage, [...DECIDED_STAGES]), sql`${applications.postingId} is not null`));

  return db
    .select({
      postingId: postings.id,
      evaluationId: evaluations.id,
      company: companies.name,
      title: postings.title,
      url: postings.url,
      location: postings.locationRaw,
      facts: evaluations.facts,
      text: postingSnapshots.descriptionText,
      form: postings.applicationForm,
      formFetchedAt: postings.applicationFormFetchedAt,
      pack: prepPacks.content,
      fitScore: evaluations.fitScore,
      priority: companies.priority,
      shortlisted: sql<boolean>`coalesce(${applications.stage} = 'shortlisted', false)`,
    })
    .from(evaluations)
    .innerJoin(postings, eq(postings.id, evaluations.postingId))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .innerJoin(postingSnapshots, eq(postingSnapshots.id, evaluations.snapshotId))
    .leftJoin(prepPacks, eq(prepPacks.evaluationId, evaluations.id))
    .leftJoin(applications, eq(applications.postingId, postings.id))
    .where(
      and(
        packEvaluation(),
        isNull(postings.closedAt),
        // A rejection elsewhere at the company pauses it; a role already shortlisted there still gets its pack.
        or(eq(companies.status, "active"), isShortlisted()),
        notInArray(postings.id, decided),
      ),
    )
    .orderBy(desc(evaluations.fitScore), sql`case ${companies.priority} when 'A' then 0 when 'B' then 1 when 'C' then 2 else 3 end`);
}

/** Current leads whose application form hasn't been read, or was read more than `maxAgeDays` ago. */
export async function leadsNeedingForms(db: Db, maxAgeDays = 3) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  return (await currentLeads(db)).filter((l) => !l.formFetchedAt || l.formFetchedAt.getTime() < cutoff).map((l) => l.postingId);
}

/**
 * Leads that need a pack, best first: packs missing answers to the form's
 * questions (or a cover letter the form asks for) are redrafted before new
 * leads get one. With `postingIds`, exactly those postings, redrafted even
 * when their pack is complete (`/prep <ids>`). With `shortlisted`, only the
 * shortlisted leads (the app's "Draft packs").
 */
export async function nextPrepWork(db: Db, limit: number, opts: { postingIds?: number[]; shortlisted?: boolean } = {}) {
  const requested = opts.postingIds?.length ? new Set(opts.postingIds) : null;
  const leads = (await currentLeads(db)).filter((l) => (!requested || requested.has(l.postingId)) && (!opts.shortlisted || l.shortlisted));
  const work = leads.flatMap((l) => {
    const expected = packExpectations(l.facts as Facts, l.form as ApplicationForm | null, l.text);
    const existing = l.pack as PrepPack | null;
    let redo: { missing: string[]; reason: string } | null = null;
    if (existing && requested) {
      redo = { missing: unansweredQuestions(existing, expected).map((q) => q.question), reason: "redraft requested" };
    } else if (existing) {
      const missing = unansweredQuestions(existing, expected).map((q) => q.question);
      const letterMissing = expected.coverLetter === "write" && !existing.coverLetter;
      if (!missing.length && !letterMissing) return [];
      redo = {
        missing,
        reason: [missing.length ? `${missing.length} unanswered question(s)` : null, letterMissing ? "no cover letter" : null]
          .filter(Boolean)
          .join(", "),
      };
    }
    const { form: _form, formFetchedAt: _at, pack: _pack, fitScore: _fit, priority: _priority, ...item } = l;
    return [{ ...item, ...expected, redo }];
  });
  return inPrepOrder(work).slice(0, limit);
}

/**
 * Which packs to draft first: shortlisted leads (the candidate is about to
 * apply), then redrafts of packs missing answers, then new leads. Stable, so
 * each group keeps its fit/priority order.
 */
export function inPrepOrder<T extends { shortlisted: boolean; redo: unknown }>(work: T[]): T[] {
  const rank = (w: T) => (w.shortlisted ? 0 : w.redo ? 1 : 2);
  return work.toSorted((a, b) => rank(a) - rank(b));
}

type PrepOutcome = { postingId: number; status: "stored" } | { postingId: number; status: "error"; problems: Problem[] };

/**
 * Check and store packs. `review` runs after every code check passes and before storing:
 * the problems it returns block the pack like a failed check (the API runner's claim judge).
 */
export async function submitPrepPacks(
  db: Db,
  input: unknown,
  bank: AnswerBank,
  runId: number | null,
  profile?: Pick<ProfileSources, "files" | "banned">,
  review?: (pack: PrepPack) => Promise<Problem[]>,
) {
  const parsed = PrepSubmission.safeParse(input);
  if (!parsed.success) return { schemaErrors: formatIssues(parsed.error), outcomes: [] as PrepOutcome[] };

  const outcomes: PrepOutcome[] = [];
  for (const pack of parsed.data.packs) {
    // The pack belongs to the posting's current lead evaluation, or a shortlisted posting's latest (packEvaluation).
    const [lead] = await db
      .select({ evaluationId: evaluations.id, text: postingSnapshots.descriptionText, facts: evaluations.facts, form: postings.applicationForm })
      .from(evaluations)
      .innerJoin(postings, eq(postings.id, evaluations.postingId))
      .innerJoin(postingSnapshots, eq(postingSnapshots.id, evaluations.snapshotId))
      .where(and(eq(evaluations.postingId, pack.postingId), packEvaluation()))
      .limit(1);
    if (!lead) {
      outcomes.push({
        postingId: pack.postingId,
        status: "error",
        problems: [{ code: "no_lead_evaluation", message: "no current lead evaluation for this posting" }],
      });
      continue;
    }
    const expected = packExpectations(lead.facts as Facts, lead.form as ApplicationForm | null, lead.text);
    const checked = checkPrepPack(pack, bank, lead.text, profile, expected);
    const problems = checked.length ? checked : ((await review?.(pack)) ?? []);
    if (problems.length) {
      outcomes.push({ postingId: pack.postingId, status: "error", problems });
      continue;
    }
    await db
      .insert(prepPacks)
      .values({ postingId: pack.postingId, evaluationId: lead.evaluationId, runId, content: pack })
      .onConflictDoUpdate({ target: prepPacks.evaluationId, set: { content: pack, runId, createdAt: sql`now()` } });
    outcomes.push({ postingId: pack.postingId, status: "stored" });
  }
  return { schemaErrors: [] as string[], outcomes };
}
