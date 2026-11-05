import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, parseAshbyForm, parseBambooHRForm, parseGreenhouseForm, parseWorkableForm } from "./forms.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/forms/${name}`, import.meta.url), "utf8"));
const byKind = (form: ReturnType<typeof parseAshbyForm>, kind: string) => form!.questions.filter((q) => q.kind === kind).map((q) => q.question);

describe("application forms", () => {
  it("Ashby: open questions, choices with options, personal fields apart, no cover letter", () => {
    const form = parseAshbyForm(fixture("ashby-form-1.json"))!;
    expect(form.coverLetter).toBe("none");
    expect(byKind(form, "text")).toContain("What about Acme or the role caught your attention and made you apply?");
    const rating = form.questions.find((q) => q.question === "How would you rate your expertise in Vue.js/React?")!;
    expect(rating).toMatchObject({ kind: "choice", required: true });
    expect(rating.options!.length).toBeGreaterThan(2);
    expect(byKind(form, "personal")).toEqual(
      expect.arrayContaining([
        // The description under the label comes along: it says what "salary" means here.
        expect.stringMatching(/^What is your expected yearly salary for the role\? — We're assuming .* gross yearly base salary/),
        "If you've used Acme, drop us a screenshot of your favorite workflow",
      ]),
    );
    // Contact fields are not questions at all.
    expect(form.questions.some((q) => /^(name|email|resume)$/i.test(q.question))).toBe(false);
  });

  it("Ashby: 'how did you discover us' is for the candidate", () => {
    const form = parseAshbyForm(fixture("ashby-form-2.json"))!;
    expect(byKind(form, "text")).toEqual([]);
    expect(byKind(form, "personal")).toEqual(["How did you first discover Hooli?", "Where did you find out about this position?"]);
  });

  it("Ashby: a portfolio upload request is not an essay", () => {
    const form = parseAshbyForm(fixture("ashby-form-3.json"))!;
    expect(byKind(form, "text")).toEqual(["Why Initech? What specifically about us caught your attention?"]);
  });

  it("Ashby: the question under a heading-like label is kept, and its hint can't make an essay a link field", () => {
    const entry = (title: string, descriptionHtml: string | null, type = "LongText") => ({
      field: { path: title, title, type },
      isRequired: title !== "Cover letter",
      descriptionHtml,
    });
    const form = parseAshbyForm({
      data: {
        jobPosting: {
          applicationForm: {
            sections: [
              {
                fieldEntries: [
                  entry("Tell us more", "<p>Tell us about a complex project you led end to end. What was the impact?</p>"),
                  entry("Have you worked on side projects?", "<p>If so, include any GitHub links.</p>", "String"),
                  entry("Anything else?", "<p>Your expected yearly salary, please.</p>", "String"),
                  entry("Cover letter", "<p>Tell us why you want to join our team!</p>"),
                ],
              },
            ],
          },
        },
      },
    })!;
    expect(form.coverLetter).toBe("optional");
    expect(byKind(form, "text")).toEqual([
      "Tell us more — Tell us about a complex project you led end to end. What was the impact?",
      "Have you worked on side projects? — If so, include any GitHub links.",
    ]);
    expect(byKind(form, "personal")).toEqual(["Anything else? — Your expected yearly salary, please."]);
  });

  it("Greenhouse: optional cover letter, yes/no questions as choices, consent as personal", () => {
    const form = parseGreenhouseForm(fixture("greenhouse-form-1.json"))!;
    expect(form.coverLetter).toBe("optional");
    expect(form.questions.find((q) => q.question.startsWith("Do you have 8+ years"))).toMatchObject({ kind: "choice", options: ["Yes", "No"] });
    expect(byKind(form, "personal")).toEqual(["NDPA Consent", "Have you previously been employed by Globex?"]);
  });

  it("preferred names, past employment and legal restrictions are yours", () => {
    const form = parseGreenhouseForm({
      questions: [
        "What's the name you'd prefer us to use throughout the interview process?",
        "Preferred First Name",
        "Do you require any reasonable accommodations or additional support during the recruitment process?",
        "Are you happy working with Stark Industries under a B2B or B2C arrangement?",
        "What engagement model would you prefer?",
        "Have you previously worked at or consulted for Stark Industries?",
        "Are you subject to any employment agreements and/or post-employment restrictions with your current employer?",
        "Why Stark Industries?",
      ].map((label) => ({ label, required: true, fields: [{ name: "q", type: "input_text" }] })),
    })!;
    expect(byKind(form, "text")).toEqual(["Why Stark Industries?"]);
  });

  it("rates, financial expectations, start dates, cooperation form and data consent are yours", () => {
    const form = parseGreenhouseForm({
      questions: [
        "What is your expected hourly rate?",
        "What are your daily rate expectations (EUR)?",
        "Monthly rate expectation (gross)",
        "What are your financial expectations?",
        "I agree to the processing of my Personal Data for recruitment purposes",
        "When would you be able to start?",
        "How soon could you start?",
        "Preferred form of cooperation (B2B / employment)",
        "Tell us about a system you scaled.",
      ].map((label) => ({ label, required: true, fields: [{ name: "q", type: "input_text" }] })),
    })!;
    expect(byKind(form, "text")).toEqual(["Tell us about a system you scaled."]);
  });

  it("Workable: company questions only, numbers and essays; cover letter field", () => {
    const form = parseWorkableForm(fixture("workable-form-1.json"))!;
    expect(form.coverLetter).toBe("none");
    expect(form.questions.filter((q) => q.numeric)).toHaveLength(4);
    expect(byKind(form, "text")).toHaveLength(2);
    expect(form.questions.some((q) => q.question === "Summary")).toBe(false);
    expect(parseWorkableForm(fixture("workable-form-2.json"))).toEqual({ ats: "workable", coverLetter: "optional", questions: [] });
  });

  // The formFields of real job details (Parser, signageOS, Piano), captured 2026-10-26.
  it("BambooHR: pay and start date fields, essays, yes/no, and statements to tick as yours", () => {
    const form = parseBambooHRForm(fixture("bamboohr-parser.json"))!;
    expect(form.coverLetter).toBe("none");
    expect(byKind(form, "text")).toHaveLength(5);
    expect(byKind(form, "text")[0]).toBe("How many years of experience do you have in Python?");
    expect(form.questions.find((q) => q.question === "Have you ever been employed by Parser?")).toMatchObject({
      kind: "choice",
      options: ["Yes", "No"],
    });
    const personal = byKind(form, "personal");
    expect(personal.slice(0, 2)).toEqual(["Desired Pay", "Date Available"]);
    expect(personal).toContain("Will you now or in the future require any kind of sponsorship to work in the country of application?");
    expect(personal.some((q) => q.startsWith("I hereby certify"))).toBe(true);
    // Contact fields are not questions.
    expect(form.questions.some((q) => /^(first name|email|resume|linkedin url)$/i.test(q.question))).toBe(false);
  });

  it("BambooHR: an optional cover letter; residence and work authorization are yours", () => {
    const form = parseBambooHRForm(fixture("bamboohr-signageos.json"))!;
    expect(form.coverLetter).toBe("optional");
    expect(byKind(form, "choice")).toEqual([
      "Hands-on experience using AI in your day-to-day work?",
      "Do you speak Czech or Slovak at B2 level or higher?",
    ]);
    expect(byKind(form, "personal")).toContain("Do you have permanent residence in the Czech Republic and valid work authorization?");
  });

  it("BambooHR: multiple choice keeps its options, and Other when the form offers it", () => {
    const form = parseBambooHRForm(fixture("bamboohr-piano.json"))!;
    const english = form.questions.find((q) => q.question === "Do you have English language skills?")!;
    expect(english.kind).toBe("choice");
    expect(english.options).toHaveLength(7);
    const permit = form.questions.find((q) => q.question.startsWith("Do you have a current valid working permission"))!;
    expect(permit).toMatchObject({ kind: "personal", required: true });
    expect(permit.options?.at(-1)).toBe("Other");
    expect(parseBambooHRForm({ result: {} })).toBeNull();
  });
});

describe("classify", () => {
  it("leaves technical questions for the pack to draft", () => {
    for (const q of [
      "Describe a race condition you debugged",
      "How did you design for high availability?",
      "How would you address a disagreement in review?",
    ]) {
      expect(classify(q, "text")).toBe("text");
    }
  });

  it("keeps the candidate's own situation personal", () => {
    for (const q of [
      "What is your availability to start?",
      "Your home address",
      "If other, please specify",
      "Race / ethnicity",
      "I consent to data processing",
    ]) {
      expect(classify(q, "text")).toBe("personal");
    }
  });
});
