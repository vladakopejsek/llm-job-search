import { describe, expect, it } from "vitest";
import { editDistance, rewriteShare, rewriteSummary } from "./rewrite-share.ts";

describe("editDistance", () => {
  it("counts insertions, deletions and substitutions", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("rewriteShare", () => {
  it("is 0 for a draft sent as written, ignoring surrounding whitespace", () => {
    expect(rewriteShare("I built it.", "  I built it.\n")).toBe(0);
  });

  it("divides by the longer text, so it stays between 0 and 1", () => {
    expect(rewriteShare("abcd", "abcdefgh")).toBe(0.5);
    expect(rewriteShare("abc", "xyz")).toBe(1);
  });
});

describe("rewriteSummary", () => {
  it("gives the median share and how many were sent almost as drafted", () => {
    const s = rewriteSummary([
      { draft: "0123456789", sent: "0123456789" },
      { draft: "0123456789", sent: "0123456780" },
      { draft: "0123456789", sent: "abcdefghij" },
    ]);
    expect(s.n).toBe(3);
    expect(s.median).toBeCloseTo(0.1);
    expect(s.lightlyEdited).toBeCloseTo(1 / 3);
  });

  it("has nothing to say without data", () => {
    expect(rewriteSummary([])).toEqual({ n: 0, median: null, lightlyEdited: null });
  });
});
