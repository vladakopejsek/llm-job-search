import { describe, expect, it } from "vitest";
import { EvaluationSubmission, type Facts } from "./facts.ts";
import { quoteFound } from "./quotes.ts";
import { decide, MIN_FIT } from "./rules.ts";
import { verifyFacts } from "./verify.ts";

/** An eligible, well-fitting role; each test changes one thing. */
const base = (): Facts => ({
  remote: { scope: "europe", regions: ["EU"], quote: "Remote within the EU" },
  eligibility: { status: "implied", quote: "Remote within the EU" },
  usOnlySignals: [],
  office: { requirement: "none", location: null, quote: null },
  languages: { required: [], quote: null },
  stack: { primaryLanguages: ["TypeScript"], typescript: true, react: true, node: true, backendHeavy: false, quote: "React and TypeScript" },
  seniority: "senior",
  pay: { min: null, max: null, currency: null, period: null, basis: "unknown", quote: null },
  contract: { b2bMentioned: false, eorMentioned: false, quote: null },
  applicationQuestions: [],
  fit: { score: 8, reason: "TS/React product work in logistics" },
  whyFit: [{ point: "Warehouse domain", quote: "warehouse operations" }],
  gaps: [],
});
const TEXT = `We're hiring a Senior Engineer.
• Remote within the EU — we work across CET.
You'll build React and TypeScript tools for warehouse operations.
We offer “flexible” hours.`;

describe("quoteFound", () => {
  it("forgives case, whitespace, curly quotes, dashes and bullets", () => {
    expect(quoteFound("remote within   the eu - we work across CET", TEXT)).toBe(true);
    expect(quoteFound('We offer "flexible" hours', TEXT)).toBe(true);
  });

  it("forgives emoji a copy left out", () => {
    const czech = "🚀 Na čem budeš pracovat?\n * 🌐 Webová aplikace pro industry odvětví\n * 🌍 Moderní software pro stavební firmy";
    expect(quoteFound("Webová aplikace pro industry odvětví Moderní software pro stavební firmy", czech)).toBe(true);
    expect(quoteFound("Webová aplikace pro všechna odvětví", czech)).toBe(false);
  });

  it("accepts separate passages joined with an ellipsis, in order", () => {
    expect(quoteFound("Remote within the EU ... warehouse operations", TEXT)).toBe(true);
    expect(quoteFound("warehouse operations … Remote within the EU", TEXT)).toBe(false);
  });

  it("rejects paraphrases and invented text", () => {
    expect(quoteFound("Remote anywhere in Europe", TEXT)).toBe(false);
    expect(quoteFound("...", TEXT)).toBe(false);
  });
});

describe("verifyFacts", () => {
  it("keeps facts whose quotes are found", () => {
    const { facts, warnings } = verifyFacts(base(), TEXT);
    expect(warnings).toEqual([]);
    expect(facts).toEqual(base());
  });

  it("downgrades an eligibility claim with an invented quote to unknown", () => {
    const f = base();
    f.eligibility = { status: "named", quote: "Portugal welcome" };
    const { facts, warnings } = verifyFacts(f, TEXT);
    expect(facts.eligibility).toEqual({ status: "unknown", quote: null });
    expect(warnings[0]).toMatchObject({ field: "eligibility.quote", problem: "not_found" });
  });

  it("requires a quote for any non-unknown eligibility status", () => {
    const f = base();
    f.eligibility = { status: "excluded", quote: null };
    expect(verifyFacts(f, TEXT).facts.eligibility.status).toBe("unknown");
  });

  it("drops unverified reasons to reject (recall first)", () => {
    const f = base();
    f.usOnlySignals = [{ signal: "401k", quote: "401(k) matching" }];
    f.languages = { required: ["German"], quote: "Fluent German" };
    f.office = { requirement: "onsite", location: "Berlin", quote: "5 days in our Berlin office" };
    const { facts, warnings } = verifyFacts(f, TEXT);
    expect(facts.usOnlySignals).toEqual([]);
    expect(facts.languages.required).toEqual([]);
    expect(facts.office.requirement).toBe("unknown");
    expect(warnings).toHaveLength(3);
  });

  it("drops a remote scope that would reject but has no quote", () => {
    const f = base();
    f.remote = { scope: "americas", regions: [], quote: null };
    const { facts, warnings } = verifyFacts(f, TEXT);
    expect(facts.remote.scope).toBe("unknown");
    expect(warnings[0]).toMatchObject({ field: "remote.quote", problem: "missing" });
  });

  it("clears a stack whose quote isn't in the posting, so it can't reject", () => {
    const f = base();
    f.stack = { ...f.stack, primaryLanguages: ["Java"], quote: "Java and Spring Boot" };
    const { facts } = verifyFacts(f, TEXT);
    expect(facts.stack).toMatchObject({ primaryLanguages: [], quote: null });
    expect(decide(facts).reasons.join()).not.toMatch(/stack/);
  });

  it("drops why-fit points whose evidence isn't in the posting", () => {
    const f = base();
    f.whyFit.push({ point: "Payments", quote: "Stripe integration" });
    expect(verifyFacts(f, TEXT).facts.whyFit).toHaveLength(1);
  });
});

describe("decide", () => {
  it("makes an eligible, fitting role a lead with partial evidence when eligibility is implied", () => {
    expect(decide(base())).toMatchObject({ verdict: "lead", evidence: "partial" });
  });

  it("gives verified evidence when the home country is named", () => {
    const f = base();
    f.eligibility = { status: "named", quote: "x" };
    expect(decide(f).evidence).toBe("verified");
  });

  it.each([
    ["Portugal excluded", (f: Facts) => (f.eligibility = { status: "excluded", quote: "x" })],
    [
      "remote scope: us_only",
      (f: Facts) => {
        f.remote.scope = "us_only";
        f.eligibility = { status: "unknown", quote: null };
      },
    ],
    ["office required in Berlin", (f: Facts) => (f.office = { requirement: "required_days", location: "Berlin", quote: "x" })],
    ["German required", (f: Facts) => (f.languages.required = ["German"])],
    ["junior role", (f: Facts) => (f.seniority = "junior")],
    ["people-management role", (f: Facts) => (f.seniority = "manager")],
    [
      "stack: Go",
      (f: Facts) => (f.stack = { primaryLanguages: ["Go"], typescript: false, react: false, node: false, backendHeavy: true, quote: null }),
    ],
    [`low fit (${MIN_FIT - 1})`, (f: Facts) => (f.fit.score = MIN_FIT - 1)],
  ])("rejects: %s", (reason, change) => {
    const f = base();
    change(f);
    expect(decide(f)).toMatchObject({ verdict: "rejected", reasons: [reason] });
  });

  it("keeps a role open to the Americas and Europe when its quote implies eligibility", () => {
    // Real case: "fully remote, based in Americas or European timezones" came back as scope americas, eligibility implied.
    const f = base();
    f.remote.scope = "americas";
    expect(decide(f).verdict).toBe("lead");
  });

  it("doesn't reject a role whose posting never names its stack", () => {
    const f = base();
    f.stack = { primaryLanguages: [], typescript: false, react: false, node: false, backendHeavy: false, quote: null };
    expect(decide(f).verdict).toBe("lead");
  });

  it("doesn't take SQL or a shell for the role's stack", () => {
    const f = base();
    f.stack = { primaryLanguages: ["SQL"], typescript: false, react: false, node: false, backendHeavy: false, quote: null };
    expect(decide(f).verdict).toBe("lead");
    f.stack.primaryLanguages = ["Python", "Bash"];
    expect(decide(f).reasons).toEqual(["stack: Python, Bash"]);
  });

  it("reads one entry naming several languages as each of them", () => {
    // Found by the model eval: Opus writes "JavaScript/TypeScript" as one entry, and the role was rejected for its stack.
    const f = base();
    f.stack = { primaryLanguages: ["JavaScript/TypeScript"], typescript: false, react: false, node: false, backendHeavy: false, quote: null };
    expect(decide(f).verdict).toBe("lead");
    f.stack.primaryLanguages = ["Power Fx, JavaScript/Node.js"];
    expect(decide(f).verdict).toBe("lead");
    f.stack.primaryLanguages = ["JavaScript (Node.js)", "Go"];
    expect(decide(f).verdict).toBe("lead");
    f.stack.primaryLanguages = ["Go/Rust"];
    expect(decide(f).reasons).toEqual(["stack: Go/Rust"]);
  });

  it("judges a backend role by its stack and fit, not by being backend", () => {
    const f = base();
    f.stack = { primaryLanguages: ["TypeScript"], typescript: true, react: false, node: true, backendHeavy: true, quote: null };
    expect(decide(f).verdict).toBe("lead");
    f.fit.score = MIN_FIT - 1;
    expect(decide(f).reasons).toEqual([`low fit (${MIN_FIT - 1})`]);
    f.stack = { primaryLanguages: ["Python"], typescript: false, react: false, node: false, backendHeavy: true, quote: null };
    expect(decide(f).reasons[0]).toBe("stack: Python");
  });

  it.each(["Lisbon", "Lisboa, Portugal", "Porto", "Lisbon or Braga, Portugal"])(
    "allows office attendance in the configured office cities: %s",
    (location) => {
      const f = base();
      f.office = { requirement: "required_days", location, quote: "x" };
      expect(decide(f).verdict).toBe("lead");
    },
  );

  it.each(["Braga", "Coimbra", "Faro, Portugal"])("rejects office attendance elsewhere at home: %s", (location) => {
    // The example candidate goes to an office only in Lisbon or Porto; elsewhere it's fully remote or nothing.
    const f = base();
    f.office = { requirement: "onsite", location, quote: "x" };
    expect(decide(f)).toMatchObject({ verdict: "rejected", reasons: [`office required in ${location}`] });
  });

  it("rejects a required language only when the candidate doesn't speak it", () => {
    const f = base();
    f.languages = { required: ["Portuguese"], quote: "x" };
    expect(decide(f).verdict).toBe("lead");
    f.languages = { required: ["portuguese", "French"], quote: "x" };
    expect(decide(f).reasons).toEqual(["French required"]);
    f.languages = { required: ["Portuguese or Spanish", "German (fluent)"], quote: "x" };
    expect(decide(f).reasons).toEqual(["German (fluent) required"]);
  });

  it("rejects office attendance abroad", () => {
    const f = base();
    f.office = { requirement: "onsite", location: "Madrid", quote: "x" };
    expect(decide(f)).toMatchObject({ verdict: "rejected", reasons: ["office required in Madrid"] });
  });

  it("rejects on US-only signals only when there are several and nothing suggests the home country is eligible", () => {
    const f = base();
    f.usOnlySignals = [
      { signal: "401k", quote: "x" },
      { signal: "us_work_authorization", quote: "y" },
    ];
    expect(decide(f).verdict).toBe("lead"); // eligibility implied
    f.eligibility = { status: "unknown", quote: null };
    expect(decide(f).verdict).toBe("rejected");
  });

  it("sends unclear eligibility to Needs check instead of rejecting it", () => {
    const f = base();
    f.eligibility = { status: "unknown", quote: null };
    expect(decide(f)).toEqual({ verdict: "needs_check", reasons: ["eligibility from Portugal unclear"], evidence: "none" });
  });
});

describe("EvaluationSubmission", () => {
  it("rejects extra fields, so a misspelt key isn't silently ignored", () => {
    const result = EvaluationSubmission.safeParse({ results: [{ postingId: 1, snapshotId: 2, facts: { ...base(), eligibilityStatus: "named" } }] });
    expect(result.success).toBe(false);
  });
});

describe("localDate", async () => {
  const { localDate } = await import("../lib/dates.ts");
  it("uses the local calendar day, not the UTC one", () => {
    // 00:30 local time on 25 September: UTC may still be the 24th.
    const d = new Date(2026, 8, 25, 0, 30);
    expect(localDate(d)).toBe("2026-09-25");
  });
});

describe("roleKey", async () => {
  const { roleKey } = await import("./work.ts");
  it("treats one role posted per country as one role", () => {
    const k = roleKey(7, "Senior Full-Stack Engineer - AI Cost Visibility");
    expect(roleKey(7, " Senior Full-Stack Engineer - AI Cost Visibility- Ukraine(Remote)")).toBe(k);
    expect(roleKey(7, "Senior Full-Stack Engineer - AI Cost Visibility - Poland (Remote)")).toBe(k);
    for (const tag of ["(f/m/d)", "(M/W/D)", "(x/f/m)", "(H/F)", "(all genders)", "(gn)"]) {
      expect(roleKey(7, `Senior Applied AI Engineer, AI Platform ${tag}`)).toBe(roleKey(7, "Senior Applied AI Engineer, AI Platform"));
    }
  });
  it("treats one role posted per city as one role", () => {
    const k = roleKey(7, "Software Engineer, AI Data");
    expect(roleKey(7, "Software Engineer, AI Data - Phoenix, AZ, USA")).toBe(k);
    expect(roleKey(7, "Software Engineer, AI Data - Lisbon, Portugal")).toBe(k);
    expect(roleKey(7, "Software Engineer, AI Data - Luxembourg City, Luxembourg")).toBe(k);
  });
  it("keeps different roles and companies apart", () => {
    expect(roleKey(7, "Senior Frontend Engineer")).not.toBe(roleKey(7, "Senior Backend Engineer"));
    expect(roleKey(7, "Product Engineer")).not.toBe(roleKey(8, "Product Engineer"));
    expect(roleKey(7, "Engineer - Payments, Remote")).not.toBe(roleKey(7, "Engineer - Search, Remote"));
    expect(roleKey(7, "Full-Stack Engineer (Back-End Leaning)")).not.toBe(roleKey(7, "Full-Stack Engineer (Front-End Leaning)"));
    expect(roleKey(7, "Software Engineer (Python)")).not.toBe(roleKey(7, "Software Engineer (TypeScript)"));
  });
});

describe("re-evaluation requests", async () => {
  const { reevalPurpose } = await import("./submit.ts");
  const { reevalWorkItem, REEVAL_NOTE } = await import("./work.ts");

  it("makes a requested posting a queue candidate even when the screen rejected it", () => {
    expect(reevalPurpose("reject", true)).toBe("queue");
    expect(reevalPurpose("reject", false)).toBe("audit");
    expect(reevalPurpose("pass", false)).toBe("queue");
    expect(reevalPurpose(null, false)).toBe("queue");
  });

  it("never puts the candidate's note (the expected answer) into the work item", () => {
    const note = "Should be a lead: the footer names Lisbon as an eligible location";
    const posting = {
      postingId: 1,
      snapshotId: 2,
      companyId: 3,
      company: "Acme",
      title: "Senior Frontend Engineer",
      location: "Remote",
      workplace: null,
      url: "https://example.com/1",
      postedAt: null,
      text: TEXT,
    };
    const item = reevalWorkItem(posting, { note });
    expect(item).toMatchObject({ postingId: 1, snapshotId: 2, purpose: "queue", note: REEVAL_NOTE, text: TEXT });
    expect(JSON.stringify(item)).not.toContain("Lisbon");
  });
});
