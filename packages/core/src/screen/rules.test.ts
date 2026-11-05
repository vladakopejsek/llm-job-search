import { describe, expect, it } from "vitest";
import { mentionsEuropeOrRemote, namesHome, placeNames, screenLocation, screenPosting, screenTitle, textNamesHome } from "./rules.ts";

// Titles are real ones from collected postings and the old pipeline's verdicts.

describe("screenTitle keeps", () => {
  it.each([
    "Senior Full Stack Engineer, Shopify",
    "Staff Frontend Engineer (TypeScript, React)",
    "Product Engineer",
    "Design Engineer - AI Clips Team",
    "Senior Software Engineer - AI Platform",
    "Staff Applied AI Engineer",
    "Lead Software Engineer - Frontend",
    "Senior Software Engineer - Kibana",
    // Domain words, overridden by a web signal:
    "Senior Full Stack Engineer (Realtime & Voice) Customer Experience Platform",
    "Full Stack Engineer, ML Platform",
    "Senior Product Engineer, Robotics",
    "Senior Full Stack Engineer, Embedded Finance",
    "Senior Backend Engineer, Embedded Payments",
    "Senior Full Stack Engineer, Go-to-Market",
    "Product Engineer, Support",
    // A mixed stack with a TypeScript side: the evaluator reads which side the role is on.
    "Senior Software Engineer (TypeScript/Go)",
    "Senior TypeScript Engineer (Node.js, some Python)",
    "Design Engineer, Technical Designer, or PM",
    "Platform Engineer, Frontend Infrastructure",
    // Backend work is in the profile: the evaluator reads the stack and scores the fit.
    "Senior Backend Engineer, Discovery",
    "Backend Developer",
    // Builders for customers, and hands-on leads: the evaluator reads what the role is.
    "Senior Solutions Engineer",
    "Forward Deployed Engineer - Software Engineer - Poland",
    "Tech Lead, Payments",
    "Frontend Team Lead",
  ])("%s", (title) => expect(screenTitle(title)).toEqual({ pass: true }));
});

describe("screenTitle rejects", () => {
  it.each([
    ["Engineering Manager - Consumer Product", "title.management"],
    ["Head of Engineering, Supply Chain", "title.management"],
    ["Software Engineering Intern - Summer '27", "title.junior"],
    ["Junior DevOps Engineer", "title.junior"],
    ["Senior iOS Engineer", "title.mobile"],
    ["Senior Software Engineer - Golang", "title.language"],
    ["Backend Engineer (.NET) (f/m/d)", "title.language"],
    ["Senior Ruby Engineer - Remote Europe", "title.language"],
    ["Staff Engineer, Go", "title.language"],
    ["Senior Java Developer", "title.language"],
    ["Software Engineer (Machine Learning)", "title.data_ml"],
    ["Senior Fullstack Data Analyst (Commercial Analytics)", "title.non_engineering"],
    ["Senior Platform Engineer - Observability", "title.infra"],
    ["Senior Software Engineer, Distributed Systems", "title.infra"],
    ["Principal Security Engineer", "title.security"],
    ["Senior QA Engineer", "title.qa"],
    ["Senior GTM Engineer", "title.customer_facing"],
    ["Software Engineer, Go-to-Market", "title.customer_facing"],
    ["Embedded Software Engineer", "title.hardware"],
    ["Business Developer for Poland – e-commerce agentic PaaS", "title.customer_facing"],
    ["Senior Software Engineer - Search Algorithms - Elasticsearch", "title.search_engine"],
    // Non-software engineering, common in the aggregator snapshot:
    ["Medior Controls Engineer", "title.hardware"],
    ["Medior Electronics / PCB Design Engineer", "title.hardware"],
    ["Medior Industrial Design CAD Engineer", "title.hardware"],
    ["Facade Engineer", "title.hardware"],
    ["Medior RAI Reinforcement Learning Engineer", "title.data_ml"],
    ["Engineering Operations Specialist - Consumer", "title.non_engineering"],
    ["Release Engineer", "title.infra"],
  ])("%s → %s", (title, rule) => {
    const result = screenTitle(title);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe(rule);
  });

  it("doesn't mistake JavaScript for Java, or 'go' in prose for Go", () => {
    expect(screenTitle("Senior JavaScript Engineer").pass).toBe(true);
    expect(screenTitle("Software Engineer, Ready to go").pass).toBe(true);
  });
});

describe("screenLocation", () => {
  it("keeps European, worldwide, home and unspecified locations", () => {
    for (const location of ["Remote (Europe)", "EMEA - Remote", "Anywhere", "Portugal", "Braga", "Remote", ""]) {
      expect(screenLocation(location, null)).toEqual({ pass: true });
    }
    expect(screenLocation("Canada; Spain; USA", "Remote")).toEqual({ pass: true });
  });

  it("rejects locations only outside Europe", () => {
    expect(screenLocation("Remote US", null)).toMatchObject({ pass: false, rule: "location.outside_europe" });
    expect(screenLocation("Remote - APAC", null)).toMatchObject({ pass: false, rule: "location.outside_europe" });
  });

  it("rejects office-based roles abroad, but not at home", () => {
    expect(screenLocation("Berlin", "OnSite")).toMatchObject({ pass: false, rule: "location.office_abroad" });
    expect(screenLocation("Hybrid - London", null)).toMatchObject({ pass: false, rule: "location.office_abroad" });
    expect(screenLocation("Portugal", "Hybrid")).toEqual({ pass: true });
  });

  // The screen checks only the home country: whether the candidate would go to a Braga office is agent/rules.ts's call (officeCities).
  it.each([
    ["Lisbon, PT", "hybrid"],
    ["PRT - Porto", "onsite"],
    ["Porto-PRT", "OnSite"],
    ["LISBOA", "onsite"],
    ["Évora, Portugal", "Hybrid"],
    ["Setubal", "onsite"],
    ["Hybrid - Guimarães", null],
    ["Braga", "hybrid"],
  ])("keeps an office role anywhere at home: %s (%s)", (location, workplace) => {
    expect(screenLocation(location, workplace)).toEqual({ pass: true });
  });

  it.each([
    ["Madrid, Spain", "hybrid"],
    ["Berlin", "onsite"],
    ["Portugalete, Spain", "Hybrid"],
    ["Regina, SK", "OnSite"],
  ])("still rejects an office role abroad: %s (%s)", (location, workplace) => {
    expect(screenLocation(location, workplace)).toMatchObject({ pass: false, rule: "location.office_abroad" });
  });

  it("counts a European or home place as Europe next to one outside it", () => {
    expect(screenLocation("New York", null)).toMatchObject({ pass: false, rule: "location.outside_europe" });
    expect(screenLocation("Bratislava; New York", null)).toEqual({ pass: true });
    expect(screenLocation("New York; Coimbra", null)).toEqual({ pass: true });
  });

  it("lets the posting text overrule the structured fields", () => {
    // Listed under North America, text opens it to Europe.
    expect(screenLocation("North America", "Remote", "This role is open to candidates based in the US and Europe.")).toEqual({ pass: true });
    expect(screenLocation("North America", "Remote", "We also hire in Portugal.")).toEqual({ pass: true });
    // Marked Hybrid, text allows working from anywhere.
    expect(
      screenLocation("Vilnius; Kaunas", "Hybrid", "Work on your terms: from modern offices, the comfort of home, or anywhere in the world."),
    ).toEqual({ pass: true });
  });

  it("reads where an office role is from the text when the location names no place", () => {
    expect(screenLocation(null, "hybrid", "Join our team at the Lisbon office.")).toEqual({ pass: true });
    expect(screenLocation("HQ", "onsite", "Join our team at the Lisbon office.")).toEqual({ pass: true });
    expect(screenLocation("EMEA", "hybrid", "Three days a week in our Lisbon office.")).toEqual({ pass: true });
    expect(screenLocation(null, "hybrid", "Join our team at the Berlin office.")).toMatchObject({ pass: false, rule: "location.office_abroad" });
    // A location naming a place still decides: the text mentioning home doesn't move a Berlin or San Francisco office.
    for (const location of ["Berlin", "San Francisco, CA"]) {
      expect(screenLocation(location, "hybrid", "We also have an office in Lisbon.")).toMatchObject({ pass: false, rule: "location.office_abroad" });
    }
  });
});

// Locations as ATSes, local boards and the discovery snapshot write them, for the example config (Lisbon).
describe("namesHome", () => {
  it.each([
    "Portugal",
    "Lisbon, Portugal",
    "Lisboa",
    "LISBOA",
    "Oporto",
    // With and without diacritics
    "Évora",
    "Evora",
    "Setúbal",
    "Setubal",
    "Guimarães",
    "Guimaraes",
    "Açores",
    "Acores",
    "Funchal, Madeira",
    // ISO codes, as whole tokens
    "Oeiras, PT",
    "PRT - Amadora",
    "Matosinhos-PRT",
  ])("%s", (location) => expect(namesHome(location)).toBe(true));

  it.each([
    // Lookalikes: a home name inside another word, a code in lower case or inside another token
    "Portugalete, Spain",
    "Bragança Paulista, Brazil",
    "Faroe Islands",
    "Unlimited PTO",
    "Remote (pt)",
    "Regina, SK",
    "Madrid, Spain",
    "Remote (most of Europe)",
    "Berlin",
    "",
  ])("not: %s", (location) => expect(namesHome(location)).toBe(false));

  it("is false for no location", () => expect(namesHome(null)).toBe(false));
});

describe("textNamesHome", () => {
  it("reads place names in free text, but not ISO codes: 'PT' there is usually part-time", () => {
    expect(textNamesHome("Our team works from Lisboa and Porto.")).toBe(true);
    expect(textNamesHome("Full-time or PT, remote")).toBe(false);
    expect(textNamesHome(null)).toBe(false);
  });
});

describe("placeNames", () => {
  it("matches whole names, a space or a hyphen alike, and keeps diacritics on exact names", () => {
    const pattern = placeNames(["Vila Real"], ["Ílhavo"]);
    expect(pattern.test("Vila-Real")).toBe(true);
    expect(pattern.test("Ílhavo")).toBe(true);
    expect(pattern.test("Ilhavo")).toBe(false);
    expect(pattern.test("Vila Realista")).toBe(false);
  });

  it("matches nothing for no names", () => {
    expect(placeNames([]).test("Lisbon")).toBe(false);
    expect(placeNames([]).test("")).toBe(false);
  });
});

describe("mentionsEuropeOrRemote", () => {
  it.each([
    "Évora, Portugal",
    "Oeiras, PT",
    "Setubal",
    "Açores",
    // Slovakia and Czechia are in the generic European list, by country and capital
    "Bratislava",
    "Kosice, Slovakia",
    "Tbilisi, Georgia",
    "Cardiff, Wales",
  ])("%s", (location) => expect(mentionsEuropeOrRemote(location)).toBe(true));

  // The snapshot's "Georgia" is mostly the US state ("Atlanta, Georgia": 606 listings, against 56 in Tbilisi).
  it.each(["Regina, SK", "Bragança Paulista, Brazil", "Unlimited PTO", "Atlanta, Georgia", "Alpharetta, Georgia", "Sydney, New South Wales"])(
    "not: %s",
    (location) => expect(mentionsEuropeOrRemote(location)).toBe(false),
  );
});

describe("screenPosting", () => {
  it("reports the title rule before the location rule", () => {
    expect(screenPosting({ title: "Engineering Manager", locationRaw: "Remote US", workplaceRaw: null })).toMatchObject({
      rule: "title.management",
    });
  });
});
