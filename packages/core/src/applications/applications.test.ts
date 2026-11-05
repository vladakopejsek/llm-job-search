import { describe, expect, it } from "vitest";
import { splitHighlights } from "../lib/highlight.ts";
import { isBehind } from "./constants.ts";
import { diffAnswers } from "./submission.ts";

describe("diffAnswers", () => {
  it("counts added, edited and removed questions, ignoring case and spacing in questions", () => {
    const prev = [
      { question: "Why us?", answer: "Because." },
      { question: "Notice period", answer: "One month" },
      { question: "Salary", answer: "x" },
    ];
    const next = [
      { question: "why  us?", answer: "Because." },
      { question: "Notice period", answer: "Two weeks" },
      { question: "Visa?", answer: "No" },
    ];
    expect(diffAnswers(prev, next)).toEqual({ added: 1, edited: 1, removed: 1 });
  });
});

describe("splitHighlights", () => {
  it("splits marked hits from plain text", () => {
    expect(splitHighlights("strong ⟦TypeScript⟧ and ⟦React⟧")).toEqual([
      { text: "strong ", hit: false },
      { text: "TypeScript", hit: true },
      { text: " and ", hit: false },
      { text: "React", hit: true },
    ]);
  });

  it("treats an unclosed marker as text", () => {
    expect(splitHighlights("a ⟦b")).toEqual([{ text: "a b", hit: false }]);
  });

  it("never produces HTML", () => {
    expect(
      splitHighlights("<b>x</b> ⟦y⟧")
        .map((s) => s.text)
        .join(""),
    ).toBe("<b>x</b> y");
  });
});

describe("isBehind", () => {
  it("is an older reply: a stage the application is past, or anything but a rejection once rejected", () => {
    expect(isBehind("screening", "interviewing")).toBe(true);
    expect(isBehind("screening", "rejected")).toBe(true);
    expect(isBehind("offer", "rejected")).toBe(true);
  });

  it("moves forward, confirms the same stage, rejects, or revives one given up on", () => {
    expect(isBehind("interviewing", "screening")).toBe(false);
    expect(isBehind("screening", "screening")).toBe(false);
    expect(isBehind("rejected", "offer")).toBe(false);
    expect(isBehind("screening", "no_response")).toBe(false);
  });
});
