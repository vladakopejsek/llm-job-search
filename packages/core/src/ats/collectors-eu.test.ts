import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { postingKey, postingKeyFromUrl } from "../screen/posting-key.ts";
import recruiteeFixture from "./__fixtures__/recruitee.json" with { type: "json" };
import workableFixture from "./__fixtures__/workable.json" with { type: "json" };
import { parseFeedUrl } from "./feed-url.ts";
import { normalizePersonio } from "./personio.ts";
import { normalizeRecruitee } from "./recruitee.ts";
import { normalizeStartupJobsOffer, offerIds } from "./startupjobs.ts";
import { normalizeTeamtailor } from "./teamtailor.ts";
import { CollectorError } from "./types.ts";
import { normalizeWorkable } from "./workable.ts";

// Trimmed real responses, captured September 2026: Skin + Me (Workable), Sellpy
// (Teamtailor RSS), JTL-Software (Personio XML), Auditdata (Recruitee); October 2026:
// Smartsupp and Emorfiq (StartupJobs pages, cut down to their offer links and JSON-LD).
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("normalizeWorkable", () => {
  const postings = normalizeWorkable(workableFixture);

  it("maps shortcode, location and the remote flag", () => {
    expect(postings[0]).toMatchObject({
      title: "Controls and Automation Engineer",
      locationRaw: "Park Royal, England, United Kingdom",
      workplaceRaw: null, // not telecommuting: unknown, not "on-site"
    });
    expect(postings[1]?.workplaceRaw).toBe("remote");
    expect(postings[0]?.externalId).toMatch(/^[A-Z0-9]+$/);
  });

  it("reads the description from the details=true response", () => {
    for (const p of postings) {
      expect(p.descriptionText.length).toBeGreaterThan(200);
      expect(p.descriptionText).not.toMatch(/<[a-z]/i);
    }
  });

  it("gives the posting the same key as its URL", () => {
    const p = postings[0]!;
    expect(postingKeyFromUrl(p.url)).toBe(postingKey("workable", p.externalId));
  });
});

describe("normalizeTeamtailor", () => {
  const postings = normalizeTeamtailor(fixture("teamtailor.rss"));

  it("parses RSS items, unescaping the HTML description once", () => {
    expect(postings.map((p) => p.title)).toEqual(["Fullstack Engineer", "Warehouse Associate - Rosersberg"]);
    const text = postings[1]?.descriptionText ?? "";
    expect(text).toContain("Picking customer orders");
    expect(text).not.toMatch(/<[a-z]|&lt;|&nbsp;/i);
  });

  it("maps remoteStatus, treating 'none' as unknown rather than on-site", () => {
    expect(postings[0]?.workplaceRaw).toBe("hybrid");
    expect(postings[1]?.workplaceRaw).toBeNull();
  });

  it("uses the numeric id from the link and joins tt:locations", () => {
    expect(postings[1]).toMatchObject({ externalId: "7979084", locationRaw: "Rosersberg, Sweden", department: "Operations Sweden" });
    expect(postings[1]?.postedAt?.toISOString()).toBe("2026-06-26T12:43:25.000Z");
  });

  it("parses a feed with no jobs", () => {
    expect(normalizeTeamtailor('<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>')).toEqual([]);
  });
});

describe("normalizePersonio", () => {
  const postings = normalizePersonio(fixture("personio.xml"), { host: "jtl-software-gmbh.jobs.personio.de" });

  it("joins the description sections and builds the job URL", () => {
    expect(postings[0]?.title).toBe("Engineering Manager (f/m/d)");
    expect(postings[0]?.descriptionText.length).toBeGreaterThan(200);
    expect(postings[0]?.url).toMatch(/^https:\/\/jtl-software-gmbh\.jobs\.personio\.de\/job\/\d+\?language=en$/);
    expect(postingKeyFromUrl(postings[0]!.url)).toBe(postingKey("personio", postings[0]!.externalId));
  });

  it("handles positions without descriptions and with additional offices", () => {
    expect(postings[1]).toMatchObject({ descriptionText: "", locationRaw: "Mobil; Eindhoven" });
  });

  it("rejects something that isn't a Personio feed", () => {
    expect(() => normalizePersonio("<html><body>Vercel Security Checkpoint</body></html>", { host: "x" })).toThrow(CollectorError);
  });
});

describe("normalizeRecruitee", () => {
  const postings = normalizeRecruitee(recruiteeFixture, { token: "auditdata" });

  it("keeps the location note, which carries the eligibility rule", () => {
    expect(postings[0]?.descriptionText).toContain("Location notes: This is remote position. Candidate should be based in EU.");
    expect(postings[0]).toMatchObject({ title: "System Architect", workplaceRaw: "remote" });
  });

  it("parses Recruitee's non-ISO timestamps and keys by board + slug", () => {
    expect(postings[0]?.postedAt?.toISOString()).toBe("2026-09-14T12:21:25.000Z");
    expect(postings[0]?.externalId).toBe("auditdata/system-architect-3");
    expect(postingKeyFromUrl(postings[0]!.url)).toBe(postingKey("recruitee", postings[0]!.externalId));
  });
});

describe("StartupJobs", () => {
  it("reads each offer id once from the company page, which links offers twice", () => {
    expect(offerIds(fixture("startupjobs-company.html"))).toEqual(["108069", "108033"]);
  });

  it("maps the offer's JobPosting: office location, Czech description, no remote flag", () => {
    const posting = normalizeStartupJobsOffer(fixture("startupjobs-offer.html"), "smartsupp");
    expect(posting).toMatchObject({
      externalId: "108033",
      title: "Tech Lead (Node.js / TypeScript)",
      locationRaw: "Brno, Česko",
      workplaceRaw: null, // not marked remote: unknown, not on-site
    });
    expect(posting?.descriptionText.length).toBeGreaterThan(200);
    expect(posting?.descriptionText).not.toMatch(/<[a-z]/i);
    expect(postingKeyFromUrl(posting!.url)).toBe(postingKey("startupjobs", "108033"));
  });

  it("maps a remote offer: the eligible country and the salary", () => {
    const posting = normalizeStartupJobsOffer(fixture("startupjobs-offer-remote.html"), "webtown-autonomni-e-shopy");
    expect(posting).toMatchObject({ externalId: "40052", workplaceRaw: "remote", locationRaw: "Česko" });
    expect(posting?.compensationRaw).toMatchObject({ currency: "CZK", value: { minValue: 130000, maxValue: 160000 } });
  });

  it("skips an offer of another company and a page without a JobPosting", () => {
    expect(normalizeStartupJobsOffer(fixture("startupjobs-offer.html"), "someone-else")).toBeNull();
    expect(normalizeStartupJobsOffer("<html><body>Nabídka již není aktivní</body></html>", "smartsupp")).toBeNull();
  });
});

describe("parseFeedUrl for the new ATSs", () => {
  it.each([
    ["https://apply.workable.com/api/v1/widget/accounts/mixam", "workable", "mixam", "apply.workable.com"],
    ["https://apply.workable.com/neutreeno-1/", "workable", "neutreeno-1", "apply.workable.com"],
    ["https://sellpy.teamtailor.com/jobs.rss", "teamtailor", "sellpy", "sellpy.teamtailor.com"],
    ["https://ownr.jobs.personio.de/xml", "personio", "ownr", "ownr.jobs.personio.de"],
    ["https://everstox.jobs.personio.de/xml?language=en", "personio", "everstox", "everstox.jobs.personio.de"],
    ["https://tether.recruitee.com/api/offers/", "recruitee", "tether", "tether.recruitee.com"],
    ["https://www.startupjobs.cz/startup/smartsupp", "startupjobs", "smartsupp", "www.startupjobs.cz"],
    ["https://www.startupjobs.com/startup/excalidraw-s-r-o", "startupjobs", "excalidraw-s-r-o", "www.startupjobs.cz"],
  ])("%s", (input, ats, token, host) => {
    expect(parseFeedUrl(input)).toEqual({ ats, token, host });
  });

  it("recognises Teamtailor on a company's own domain only with a hint", () => {
    expect(parseFeedUrl("https://careers.swappie.com/jobs.rss")).toBeNull();
    expect(parseFeedUrl("https://careers.swappie.com/jobs.rss", "teamtailor")).toEqual({
      ats: "teamtailor",
      token: "careers.swappie.com",
      host: "careers.swappie.com",
    });
  });

  it("doesn't take a single job URL for a board", () => {
    expect(parseFeedUrl("https://apply.workable.com/j/0BB49FD6DD")).toBeNull();
    expect(parseFeedUrl("https://www.startupjobs.cz/nabidka/108033/tech-lead-node-js-typescript")).toBeNull();
  });
});
