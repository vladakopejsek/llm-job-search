import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnswerBankError, citableIds, parseAnswerBank } from "./answer-bank.ts";
import { checkPrepPack, inPrepOrder, MAX_ANSWER_WORDS, type PrepPack, packExpectations, unansweredQuestions } from "./prep.ts";
import { citableText, dontSayPhrases } from "./sources.ts";

const example = readFileSync(new URL("../../../../seeds/answer-bank.example.md", import.meta.url), "utf8");
const bank = parseAnswerBank(example);
const POSTING = "You'll own our billing UI in React and TypeScript. We integrate with Stripe.";
/** What the agent is shown; the codes are checked separately. */
const messages = (...args: Parameters<typeof checkPrepPack>) => checkPrepPack(...args).map((p) => p.message);

const pack = (): PrepPack => ({
  postingId: 1,
  cvHeadline: "Senior Frontend Engineer",
  summary: "Billing UI in React is exactly the candidate's last project.",
  whyFit: [
    { text: "Rebuilt a billing dashboard in React.", factIds: ["fact.billing.rebuild"], sources: [], postingQuote: "own our billing UI in React" },
  ],
  gaps: [{ gap: "Kubernetes", sayThis: "I haven't run Kubernetes myself; I've deployed to managed platforms." }],
  applicationAnswers: [{ question: "Why us?", answer: "Because billing is my home turf.", factIds: ["fact.billing.stripe"], sources: [] }],
  whyUs: [{ point: "Public changelog shows weekly billing releases", sourceUrl: "https://example.com/changelog" }],
  coverLetter: "Hi team,\n\nI rebuilt a billing dashboard in React and TypeScript and would love to do the same for you.\n\nBest,\nAlex",
  coverLetterFactIds: ["fact.billing.rebuild"],
  coverLetterSources: [],
  askThem: ["Which engagement model do you offer?"],
});

describe("parseAnswerBank", () => {
  it("reads profile, facts, stories, gaps and banned phrasings", () => {
    expect(bank.profile).toMatch(/^Alex Moreira, Lisbon/);
    expect(bank.facts.get("fact.billing.stripe")).toMatch(/Stripe Checkout/);
    expect(bank.stories.get("story.failure.flag")?.body).toMatch(/owner and an expiry date/);
    expect([...bank.gaps.keys()]).toEqual(["gap.kubernetes", "gap.mobile"]);
    expect(bank.banned.map((b) => b.label)).toEqual(['"rockstar"', '"10x"', "/\\b\\d+ markets\\b/i"]);
    expect(citableIds(bank).has("story.failure.flag")).toBe(true);
  });

  it("reports every problem with its line, instead of guessing", () => {
    const broken = "## Profile\nx\n## Facts\n- a fact without an id\n- [fact.a] one\n- [fact.a] again\n## Banned phrasings\n- /(unclosed/\n";
    try {
      parseAnswerBank(broken);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AnswerBankError);
      const problems = (error as AnswerBankError).problems.join("\n");
      expect(problems).toMatch(/line 4: fact without an id/);
      expect(problems).toMatch(/line 6: duplicate id fact\.a/);
      expect(problems).toMatch(/line 8: invalid regex/);
    }
  });
});

describe("checkPrepPack", () => {
  it("tags every problem with a code, for the attempt log", () => {
    const p = pack();
    p.whyFit[0]!.factIds = ["fact.billing.invented"];
    p.whyFit[0]!.postingQuote = "You'll lead a team of five";
    p.summary = "A rockstar fit.";
    expect(checkPrepPack(p, bank, POSTING).map((x) => x.code)).toEqual(["unknown_fact_id", "posting_quote_not_found", "banned_phrase"]);
  });

  it("accepts a clean pack", () => {
    expect(messages(pack(), bank, POSTING)).toEqual([]);
  });

  it("rejects citations of facts that don't exist", () => {
    const p = pack();
    p.whyFit[0]!.factIds = ["fact.billing.invented"];
    expect(messages(p, bank, POSTING)).toEqual(['whyFit[0]: unknown fact id "fact.billing.invented"']);
  });

  it("rejects a why-fit point that doesn't answer a real line of the posting", () => {
    const p = pack();
    p.whyFit[0]!.postingQuote = "You'll lead a team of five";
    expect(messages(p, bank, POSTING)).toEqual(["whyFit[0].postingQuote not found in the posting"]);
  });

  it("enforces banned phrasings, including regex ones, anywhere the candidate might send", () => {
    const p = pack();
    p.summary = "A rockstar fit.";
    p.coverLetter += "\nShipped in 7 markets.";
    expect(messages(p, bank, POSTING)).toEqual([
      'summary: banned phrasing "rockstar" (never describe yourself this way)',
      "coverLetter: banned phrasing /\\b\\d+ markets\\b/i (don't state market counts)",
    ]);
  });

  it("enforces word limits", () => {
    const p = pack();
    p.applicationAnswers[0]!.answer = "word ".repeat(MAX_ANSWER_WORDS + 1);
    expect(messages(p, bank, POSTING)[0]).toMatch(/121 words/);
  });
});

describe("drafts are ready to paste", () => {
  it("rejects placeholders left in a cover letter or answer", () => {
    const p = pack();
    p.coverLetter = "Dear [Hiring Manager], …";
    p.applicationAnswers[0]!.answer = "TODO";
    expect(messages(p, bank, POSTING)).toEqual(["coverLetter: contains a placeholder", "applicationAnswers[0].answer: contains a placeholder"]);
  });

  it("requires the cover letter's claims to cite real facts", () => {
    const p = pack();
    p.coverLetterFactIds = ["fact.invented"];
    expect(messages(p, bank, POSTING)).toEqual(['coverLetter: unknown fact id "fact.invented"']);
  });
});

describe("profile sources", () => {
  const PROJECT = [
    "# Billing rebuild",
    "I rebuilt the invoice screens and cut support tickets by a third.",
    "",
    "## 9. Say instead",
    "| Don't | Say |",
    "|---|---|",
    '| "I built billing alone" | "I led the client rebuild with one other engineer." |',
  ].join("\n");
  const profile = {
    files: new Map([["projects/billing.md", citableText(PROJECT)]]),
    banned: dontSayPhrases(PROJECT).map((phrase) => ({ pattern: new RegExp(phrase, "i"), label: `"${phrase}"`, note: "" })),
  };

  it("accepts a claim backed by a verbatim profile quote instead of a fact id", () => {
    const p = pack();
    p.whyFit[0]!.factIds = [];
    p.whyFit[0]!.sources = [{ file: "projects/billing.md", quote: "cut support tickets by a third" }];
    expect(messages(p, bank, POSTING, profile)).toEqual([]);
  });

  it("rejects quotes from the don't-say column, unknown files, and uncited claims", () => {
    const p = pack();
    p.whyFit[0]!.factIds = [];
    p.whyFit[0]!.sources = [
      { file: "projects/billing.md", quote: "I built billing alone" },
      { file: "notes.md", quote: "anything" },
    ];
    p.applicationAnswers[0]!.factIds = [];
    expect(messages(p, bank, POSTING, profile)).toEqual([
      "whyFit[0]: quote not found in projects/billing.md (or it's a \"don't say\" line)",
      'whyFit[0]: "notes.md" is not a citable profile file',
      "applicationAnswers[0]: no citation (needs a fact id or a profile source quote)",
    ]);
  });

  it("turns don't-say phrases into banned phrasings", () => {
    const p = pack();
    p.coverLetter = "Hi,\n\nI built billing alone and shipped it.\n\nBest,\nAlex";
    expect(messages(p, bank, POSTING, profile)).toEqual(['coverLetter: banned phrasing "I built billing alone"']);
  });

  it("doesn't ban a don't-say phrase that the approved wording itself contains", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadProfileSources } = await import("./sources.ts");
    const dir = await mkdtemp(join(tmpdir(), "profile-"));
    await mkdir(join(dir, "projects"));
    await writeFile(
      join(dir, "projects/checkout.md"),
      '## 12. Say instead\n| Don\'t | Say |\n|---|---|\n| "Stripe checkout" | "Stripe Checkout and webhooks" |\n| "Owned payments" | "The frontend of payments" |\n',
    );
    const sources = await loadProfileSources(dir, "", { include: ["projects/"], alwaysRead: [], styleFile: null });
    expect(sources.banned.map((b) => b.label)).toEqual(['"Owned payments"']);
  });

  it("keeps the correct wording citable", () => {
    expect(citableText(PROJECT)).toContain("I led the client rebuild with one other engineer.");
    expect(citableText(PROJECT)).not.toContain("I built billing alone");
  });
});

describe("packs answer the form", () => {
  const form = {
    ats: "ashby" as const,
    coverLetter: "none" as const,
    questions: [
      { question: "Why us?", kind: "text" as const, required: true },
      { question: "Rate your React", kind: "choice" as const, required: true, options: ["Beginner", "Expert"] },
      { question: "Years of TypeScript?", kind: "choice" as const, required: true, numeric: true },
      { question: "Salary expectation?", kind: "personal" as const, required: true },
    ],
  };
  const expected = packExpectations({ applicationQuestions: ["Why us?", "Share a link to your favourite side project"] }, form, POSTING);
  const complete = (): PrepPack => ({
    ...pack(),
    coverLetter: null,
    coverLetterFactIds: [],
    applicationAnswers: [
      { question: "Why us?", answer: "Because billing is my home turf.", factIds: ["fact.billing.stripe"], sources: [] },
      { question: "Rate your React", answer: "Expert", why: "Six years of React in production.", factIds: ["fact.billing.rebuild"], sources: [] },
      { question: "Years of TypeScript?", answer: "6", why: "Since 2019.", factIds: [], sources: [] },
    ],
  });

  it("merges form and posting questions, keeps personal ones apart, skips the letter when not asked", () => {
    expect(expected.questions.map((q) => q.question)).toEqual(["Why us?", "Rate your React", "Years of TypeScript?"]);
    expect(expected.youAnswer.map((q) => q.question)).toEqual(["Salary expectation?", "Share a link to your favourite side project"]);
    expect(expected.coverLetter).toBe("skip");
    expect(packExpectations({ applicationQuestions: [] }, null, POSTING).coverLetter).toBe("write");
    expect(packExpectations({ applicationQuestions: [] }, { ...form, coverLetter: "optional" }, POSTING).coverLetter).toBe("write");
    expect(packExpectations({ applicationQuestions: [] }, form, "Please attach a cover letter.").coverLetter).toBe("write");
  });

  it("accepts a complete pack", () => {
    expect(messages(complete(), bank, POSTING, undefined, expected)).toEqual([]);
  });

  it("rejects a pack that leaves a question unanswered (the old silent failure)", () => {
    const p = complete();
    p.applicationAnswers = p.applicationAnswers.slice(0, 1);
    expect(messages(p, bank, POSTING, undefined, expected)).toEqual(['not answered: "Rate your React"', 'not answered: "Years of TypeScript?"']);
    expect(unansweredQuestions(p, expected).map((q) => q.question)).toEqual(["Rate your React", "Years of TypeScript?"]);
  });

  it("checks choices: a listed option or a number, with why", () => {
    const p = complete();
    p.applicationAnswers[1] = { ...p.applicationAnswers[1]!, answer: "Guru", why: undefined };
    p.applicationAnswers[2] = { ...p.applicationAnswers[2]!, answer: "six" };
    expect(messages(p, bank, POSTING, undefined, expected)).toEqual([
      'applicationAnswers[1]: a choice needs "why"',
      'applicationAnswers[1]: "Guru" is not one of the options: "Beginner", "Expert"',
      'applicationAnswers[2]: expected a number, got "six"',
    ]);
  });

  it("leaves personal questions to the candidate and the letter out when it isn't asked for", () => {
    const p = complete();
    p.applicationAnswers.push({ question: "Salary expectation?", answer: "EUR 90k", factIds: [], sources: [] });
    p.coverLetter = "Hi team, …";
    p.coverLetterFactIds = ["fact.billing.rebuild"];
    expect(messages(p, bank, POSTING, undefined, expected)).toEqual([
      'applicationAnswers[3]: "Salary expectation?" is for the candidate to answer; leave it out',
      "coverLetter must be null: The form has no cover-letter field and the posting doesn't ask for one.",
    ]);
  });
});

describe("inPrepOrder", () => {
  it("drafts shortlisted leads first, then redrafts, then new leads, each in the order given", () => {
    const w = (id: number, shortlisted: boolean, redo: boolean) => ({ id, shortlisted, redo: redo ? { missing: [] } : null });
    const order = inPrepOrder([w(1, false, false), w(2, false, true), w(3, true, false), w(4, false, false), w(5, true, true)]);
    expect(order.map((x) => x.id)).toEqual([3, 5, 2, 1, 4]);
  });
});
