import { z } from "zod";

/**
 * The contract between the agent and the app: what the agent must report
 * about one posting. The agent reads; it doesn't decide. The verdict is
 * derived from these facts by code (rules.ts), after every quote has been
 * checked against the posting text (verify.ts).
 *
 * The .describe() texts are part of the contract: they end up in the JSON
 * Schema the agent is given (`pnpm agent:schema evaluation`).
 */

const Quote = z
  .string()
  .min(3)
  .describe(
    "Text copied verbatim from the posting, as written. To quote two separate places, join them with '...'. Code checks every quote against the posting; a quote that isn't found is discarded along with the claim it supports.",
  );

export const Facts = z
  .object({
    remote: z
      .object({
        scope: z
          .enum(["worldwide", "europe", "specific_countries", "us_only", "americas", "onsite_or_hybrid", "unknown"])
          .describe("Where the role can be done from, per the text (not the ATS location field alone)."),
        regions: z.array(z.string()).describe("Countries or regions the text names as eligible, e.g. ['EU', 'UK']."),
        quote: Quote.nullable(),
      })
      .strict(),
    eligibility: z
      .object({
        status: z
          .enum(["named", "implied", "excluded", "unknown"])
          .describe(
            "Can the candidate apply from where they live (the profile says where)? named: their country, or a place in it, is explicitly eligible. implied: an eligible region clearly includes it (Europe, EU, EMEA, a time zone range around theirs, worldwide). excluded: the text or form rules it out (e.g. a country list without it, US-only). unknown: can't tell.",
          ),
        quote: Quote.nullable().describe("Required for named, implied and excluded."),
      })
      .strict(),
    usOnlySignals: z
      .array(
        z
          .object({
            signal: z.enum(["us_work_authorization", "401k", "us_states_only", "usd_only_pay", "us_benefits", "visa_sponsorship_us", "other"]),
            quote: Quote,
          })
          .strict(),
      )
      .describe("Signs the role is really US-only, even if the header says remote."),
    office: z
      .object({
        requirement: z
          .enum(["none", "optional", "required_days", "onsite", "unknown"])
          .describe("required_days: hybrid with mandatory office days. onsite: fully in office."),
        location: z.string().nullable().describe("The office city/country when attendance is required."),
        quote: Quote.nullable(),
      })
      .strict(),
    languages: z
      .object({
        required: z.array(z.string()).describe("Spoken languages the role requires besides English, in English, e.g. ['German']. Not nice-to-haves."),
        quote: Quote.nullable().describe("Required when the list isn't empty."),
      })
      .strict(),
    stack: z
      .object({
        primaryLanguages: z.array(z.string()).describe("Main programming languages of the role, most important first."),
        typescript: z.boolean(),
        react: z.boolean(),
        node: z.boolean(),
        backendHeavy: z.boolean().describe("True when the role is mainly backend/infrastructure work."),
        quote: Quote.nullable(),
      })
      .strict(),
    seniority: z.enum(["junior", "mid", "senior", "staff_plus", "manager", "unknown"]),
    pay: z
      .object({
        min: z.number().nullable(),
        max: z.number().nullable(),
        currency: z.string().nullable(),
        period: z.enum(["year", "month", "day", "hour"]).nullable(),
        basis: z.enum(["salary", "contract_rate", "unknown"]),
        quote: Quote.nullable(),
      })
      .strict(),
    contract: z
      .object({
        b2bMentioned: z.boolean().describe("Contractor/B2B engagement is mentioned as possible."),
        eorMentioned: z.boolean().describe("Employer of record (Deel, Remote, Oyster…) is mentioned."),
        quote: Quote.nullable(),
      })
      .strict(),
    applicationQuestions: z
      .array(z.string())
      .describe("Non-standard application questions visible in the text, verbatim. Empty when none are shown."),
    fit: z
      .object({
        score: z.number().int().min(0).max(10).describe("Fit against the candidate profile, using the fit rubric in the instructions."),
        reason: z.string().max(400),
      })
      .strict(),
    whyFit: z.array(z.object({ point: z.string().max(200), quote: Quote }).strict()).max(4),
    gaps: z.array(z.object({ gap: z.string().max(200), quote: Quote.nullable() }).strict()).max(5),
  })
  .strict();
export type Facts = z.infer<typeof Facts>;

const EvaluationResult = z
  .object({
    postingId: z.number().int(),
    snapshotId: z.number().int().describe("Copy from the work order: ties the evaluation to the exact text read."),
    facts: Facts,
  })
  .strict();

export const EvaluationSubmission = z.object({ results: z.array(EvaluationResult).min(1) }).strict();
export type EvaluationSubmission = z.infer<typeof EvaluationSubmission>;
