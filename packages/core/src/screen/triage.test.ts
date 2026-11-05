import { describe, expect, it } from "vitest";
import { companyKeys } from "./company-key.ts";
import { buildTriageContext, triage } from "./triage.ts";

describe("companyKeys", () => {
  const matches = (a: string, b: string) => companyKeys(a).some((k) => companyKeys(b).includes(k));

  it.each([
    ["Hoolí Group", "hooli"],
    ["INITECH'S LAB", "initechslab"],
    ["Acme.com", "acme"],
    ["Umbrella (umbrella.com)", "umbrella.com"],
    ["GlobexOne", "globexone"],
    ["Wayne (Wayne Enterprises)", "wayne"],
    ["Globex s.r.o.", "globex"],
    ["Umbrella GmbH", "umbrella-gmbh"],
  ])("%s matches %s", (a, b) => expect(matches(a, b)).toBe(true));

  it("doesn't merge different companies", () => {
    expect(matches("Acme", "Acmeb")).toBe(false);
    expect(matches("Wayne", "Dwayne")).toBe(false);
    expect(matches("AG Grid", "Grid")).toBe(false);
    expect(matches("SE Ranking", "Ranking")).toBe(false);
  });
});

describe("triage", () => {
  const ctx = buildTriageContext(
    [
      { company: "GlobexOne", stage: "applied", postingKey: "greenhouse:111" },
      { company: "INITECH'S LAB", stage: "applied", postingKey: null },
      { company: "Hooli", stage: "rejected", postingKey: "ashby:aaa" },
      { company: "Umbrella", stage: "lead", postingKey: "ashby:lead-role" },
      { company: "Stark.io", stage: "no_response", postingKey: "ashby:old-app" },
    ],
    [
      { postingKey: "ashby:judged", verdict: "rejected" },
      { postingKey: "ashby:old-lead", verdict: "lead" },
      { postingKey: "ashby:open-question", verdict: "needs_check" },
    ],
  );
  const posting = (postingKey: string, companyName: string, boardToken: string | null = null) => ({
    postingKey,
    companyName,
    boardToken,
  });

  it("recognises a role already decided in the tracker", () => {
    expect(triage(posting("greenhouse:111", "GlobexOne"), ctx)).toMatchObject({ category: "tracked", detail: "in the tracker as applied" });
  });

  it("keeps a tracker lead (never applied to) as a candidate", () => {
    expect(triage(posting("ashby:lead-role", "Umbrella"), ctx)).toEqual({ category: "new", detail: "a lead in your tracker" });
  });

  it("drops roles at companies that rejected the candidate", () => {
    expect(triage(posting("ashby:other", "Hooli"), ctx)).toMatchObject({ category: "company_rejected" });
  });

  it("flags other roles at companies already contacted, matching by board token too", () => {
    expect(triage(posting("greenhouse:222", "GlobexOne"), ctx)).toMatchObject({ category: "company_in_process" });
    expect(triage(posting("ashby:x", "initechslab", "initechslab"), ctx)).toMatchObject({ category: "company_in_process" });
  });

  it("lets a company's roles back once its application went nowhere", () => {
    expect(triage(posting("ashby:new-role", "Stark.io"), ctx)).toEqual({
      category: "new",
      detail: "an earlier application there got no response",
    });
  });

  it("skips roles the old pipeline decided, but not its open questions", () => {
    expect(triage(posting("ashby:judged", "Acme"), ctx)).toMatchObject({ category: "judged" });
    expect(triage(posting("ashby:open-question", "Acme"), ctx)).toMatchObject({ category: "new" });
  });

  it("re-evaluates the old pipeline's leads instead of skipping them", () => {
    expect(triage(posting("ashby:old-lead", "Acme"), ctx)).toMatchObject({ category: "new" });
  });

  it("keeps new roles, noting when the company is already a lead", () => {
    expect(triage(posting("ashby:new", "Acme"), ctx)).toEqual({ category: "new", detail: "" });
    expect(triage(posting("ashby:another", "Umbrella"), ctx)).toEqual({ category: "new", detail: "company is a Lead in the tracker" });
  });
});
