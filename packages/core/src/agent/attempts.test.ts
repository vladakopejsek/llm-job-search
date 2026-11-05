import { describe, expect, it } from "vitest";
import {
  type AttemptRow,
  attemptStats,
  capProblems,
  evaluationDrafts,
  MAX_MESSAGE_CHARS,
  MAX_PROBLEMS_PER_ROW,
  numberAttempts,
  outcomeDrafts,
  prepDrafts,
  schemaErrorDrafts,
} from "./attempts.ts";

describe("schemaErrorDrafts", () => {
  it("files each error under the posting of the item it's about, the rest under the file", () => {
    const input = { results: [{ postingId: 11 }, { postingId: 12 }, { postingId: "x" }] };
    const drafts = schemaErrorDrafts(input, "results", [
      "results.1.facts.eligibility.status: Invalid option",
      "results.1.facts.fit.score: Too big",
      "results.2.facts: Required",
      '(root): Unrecognized key: "extra"',
    ]);
    expect(drafts).toEqual([
      {
        postingId: 12,
        status: "schema_error",
        problems: [
          { code: "schema", message: "results.1.facts.eligibility.status: Invalid option" },
          { code: "schema", message: "results.1.facts.fit.score: Too big" },
        ],
      },
      // A posting id that isn't a number can't be trusted: the error stays with the file.
      {
        postingId: null,
        status: "schema_error",
        problems: [
          { code: "schema", message: "results.2.facts: Required" },
          { code: "schema", message: '(root): Unrecognized key: "extra"' },
        ],
      },
    ]);
  });

  it("copes with input that isn't an object", () => {
    expect(schemaErrorDrafts(null, "packs", ["(root): Expected object"])).toEqual([
      { postingId: null, status: "schema_error", problems: [{ code: "schema", message: "(root): Expected object" }] },
    ]);
  });
});

describe("evaluationDrafts", () => {
  it("logs stored results, downgraded quotes and snapshot mismatches", () => {
    const drafts = evaluationDrafts(
      {},
      {
        schemaErrors: [],
        outcomes: [
          { postingId: 1, status: "stored", verdict: "lead", reasons: [], warnings: [] },
          {
            postingId: 2,
            status: "stored",
            verdict: "needs_check",
            reasons: [],
            warnings: [{ field: "eligibility.quote", quote: "EU only", problem: "not_found", downgraded: "eligibility.status yes → unknown" }],
          },
          { postingId: 3, status: "error", error: "snapshot 9 doesn't belong to posting 3" },
        ],
      },
    );
    expect(drafts.map((d) => [d.postingId, d.status, d.problems.map((p) => p.code)])).toEqual([
      [1, "stored", []],
      [2, "stored_with_warnings", ["quote_not_found"]],
      [3, "rejected", ["snapshot_mismatch"]],
    ]);
    expect(drafts[1]!.problems[0]!.message).toBe('quote not_found: eligibility.quote "EU only" → eligibility.status yes → unknown');
  });
});

describe("prepDrafts and outcomeDrafts", () => {
  it("keeps the pack's coded problems as they are", () => {
    const problems = [{ code: "unknown_fact_id" as const, message: 'whyFit[0]: unknown fact id "x"' }];
    expect(
      prepDrafts(
        {},
        {
          schemaErrors: [],
          outcomes: [
            { postingId: 5, status: "error", problems },
            { postingId: 6, status: "stored" },
          ],
        },
      ),
    ).toEqual([
      { postingId: 5, status: "rejected", problems },
      { postingId: 6, status: "stored", problems: [] },
    ]);
  });

  it("logs reply proposals as one row for the file", () => {
    expect(outcomeDrafts({ schemaErrors: [], stored: 2, skipped: ["application 4: already rejected"] })).toEqual([
      { postingId: null, status: "stored", problems: [{ code: "outcome_skipped", message: "application 4: already rejected" }] },
    ]);
  });
});

describe("numberAttempts", () => {
  it("counts on from what the run already logged, per posting and for the file", () => {
    const d = (postingId: number | null) => ({ postingId, status: "stored" as const, problems: [] });
    const numbered = numberAttempts(
      [d(1), d(2), d(null), d(1)],
      new Map([
        [1, 1],
        [null, 2],
      ]),
    );
    expect(numbered.map((n) => [n.postingId, n.attempt])).toEqual([
      [1, 2],
      [2, 1],
      [null, 3],
      [1, 3],
    ]);
  });
});

describe("attemptStats", () => {
  const row = (postingId: number | null, attempt: number, status: string, codes: string[] = [], kind = "prep"): AttemptRow => ({
    kind,
    postingId,
    attempt,
    status,
    problems: codes.map((code) => ({ code, message: code }) as AttemptRow["problems"][number]),
  });

  it("tells clean first tries from fixes and give-ups", () => {
    const s = attemptStats([
      row(1, 1, "stored"), // clean first time
      row(2, 1, "rejected", ["unknown_fact_id", "banned_phrase"]),
      row(2, 2, "stored"), // fixed on retry
      row(3, 1, "rejected", ["placeholder"]),
      row(3, 2, "rejected", ["placeholder"]), // gave up
      row(1, 1, "stored_with_warnings", ["quote_not_found"], "evaluation"), // same posting id, other kind: its own item
      row(null, 1, "bad_json", ["bad_json"]),
    ]);
    expect(s).toEqual({
      attempts: 7,
      items: 4,
      firstTryClean: 1,
      fixedOnRetry: 1,
      neverStored: 1,
      fileErrors: 1,
      problemsByCode: { unknown_fact_id: 1, banned_phrase: 1, placeholder: 2, quote_not_found: 1, bad_json: 1 },
    });
  });

  it("counts one posting in two runs as two items: attempt numbers restart each run", () => {
    const s = attemptStats([
      { ...row(5, 1, "rejected", ["placeholder"]), runId: 5 },
      { ...row(5, 2, "rejected", ["placeholder"]), runId: 5 },
      { ...row(5, 1, "stored"), runId: 9 },
    ]);
    expect(s).toMatchObject({ items: 2, neverStored: 1, firstTryClean: 1, fixedOnRetry: 0 });
  });
});

describe("capProblems", () => {
  it("keeps rows small but every problem counted", () => {
    const many = [
      { code: "source_quote_not_found" as const, message: `quote not found: ${"x".repeat(5000)}` },
      ...Array.from({ length: MAX_PROBLEMS_PER_ROW + 30 }, (_, i) => ({
        code: (i % 2 ? "schema" : "over_length") as "schema" | "over_length",
        message: `problem ${i}`,
      })),
    ];
    const capped = capProblems(many);
    expect(capped[0]!.message.length).toBe(MAX_MESSAGE_CHARS);
    expect(capped.length).toBe(MAX_PROBLEMS_PER_ROW + 2);
    const stats = attemptStats([{ kind: "prep", postingId: 1, attempt: 1, status: "rejected", problems: capped }]);
    expect(Object.values(stats.problemsByCode).reduce((a, b) => a + b, 0)).toBe(many.length);
  });
});
