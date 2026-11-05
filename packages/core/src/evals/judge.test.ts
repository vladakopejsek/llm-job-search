import { describe, expect, it } from "vitest";
import { claimParts } from "../llm/judge.ts";
import { acceptPlant, overlaps } from "./judge.ts";

const CLEAN = "I moved the invoice exports to a background queue; finance valued it at about €40k.";

describe("acceptPlant", () => {
  it("keeps a plant whose new phrase is in the changed text", () => {
    const planted = CLEAN.replace("€40k", "€150k");
    expect(acceptPlant(CLEAN, JSON.stringify({ modified: planted, changed: "about €150k" }))).toEqual({ planted, plantedPhrase: "about €150k" });
  });

  it("drops a plant that changed nothing, names a phrase that isn't new, rewrote the text, or isn't JSON", () => {
    expect(acceptPlant(CLEAN, JSON.stringify({ modified: CLEAN, changed: "€40k" }))).toBeNull();
    expect(acceptPlant(CLEAN, JSON.stringify({ modified: `${CLEAN} More.`, changed: "background queue" }))).toBeNull();
    expect(acceptPlant(CLEAN, JSON.stringify({ modified: "x".repeat(600), changed: "xx" }))).toBeNull();
    expect(acceptPlant(CLEAN, "not json")).toBeNull();
  });
});

describe("overlaps", () => {
  it("counts a flag that covers most of the planted phrase, in either length", () => {
    expect(overlaps("valued it at about €150k", "about €150k")).toBe(true);
    expect(overlaps("€150k", "about €150k")).toBe(true);
    expect(overlaps("six years of React", "about €150k")).toBe(false);
  });
});

describe("claimParts", () => {
  it("takes why-fit points, every answer (a choice with its why) and the cover letter", () => {
    const parts = claimParts({
      whyFit: [{ text: "A", factIds: ["fact.a"], sources: [], postingQuote: "x" }],
      applicationAnswers: [
        { question: "Why?", answer: "B", factIds: [], sources: [] },
        { question: "Remote?", answer: "Yes", why: "It's remote", factIds: [], sources: [] },
      ],
      coverLetter: "C",
      coverLetterFactIds: [],
      coverLetterSources: [],
    });
    expect(parts.map((p) => `${p.section}:${p.text}`)).toEqual(["whyFit:A", "answer:B", "answer:Yes. It's remote", "coverLetter:C"]);
  });
});
