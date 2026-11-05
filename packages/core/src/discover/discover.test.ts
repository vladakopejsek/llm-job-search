import { describe, expect, it } from "vitest";
import { isDiscoverable } from "./filter.ts";
import { titleKey } from "./rank.ts";
import type { SnapshotJob } from "./snapshot.ts";

const job = (overrides: Partial<SnapshotJob>): SnapshotJob => ({
  company: "acme",
  title: "Senior Frontend Engineer",
  location: "Lisbon, Portugal",
  url: "https://jobs.ashbyhq.com/acme/92085ccf-568e-42ed-b707-3f08cce890a7",
  ats: "Ashby",
  first_seen: "2026-09-01T00:00:00Z",
  skill_level: "senior",
  is_recruiter: false,
  ...overrides,
});

describe("isDiscoverable", () => {
  it("keeps software roles on supported ATSs with a European or remote location", () => {
    expect(isDiscoverable(job({}))).toBe(true);
    expect(isDiscoverable(job({ title: "AI Engineer", location: "Remote - EMEA" }))).toBe(true);
  });

  it("needs a positive software signal: 'engineer' alone isn't enough outside watched boards", () => {
    expect(isDiscoverable(job({ title: "Facade Engineer", location: "London" }))).toBe(false);
    expect(isDiscoverable(job({ title: "Component Engineer", location: "Bristol, UK" }))).toBe(false);
  });

  it("drops recruiters, aggregators, juniors and ATSs we can't collect", () => {
    expect(isDiscoverable(job({ is_recruiter: true }))).toBe(false);
    expect(isDiscoverable(job({ company: "jobgether" }))).toBe(false);
    expect(isDiscoverable(job({ skill_level: "entry" }))).toBe(false);
    expect(isDiscoverable(job({ ats: "iCIMS" }))).toBe(false);
  });

  it("drops roles without a European or remote location, since there's no text to check", () => {
    expect(isDiscoverable(job({ location: null }))).toBe(false);
    expect(isDiscoverable(job({ location: "Austin, TX" }))).toBe(false);
  });
});

describe("isDiscoverable on Workday and BambooHR", () => {
  // Snapshot rows, 2026-10-26, moved to the example config's home country.
  const workday = (overrides: Partial<SnapshotJob>) =>
    job({
      company: "thermofisher",
      title: "Software Engineer",
      location: "Porto, Portugal",
      url: "https://thermofisher.wd5.myworkdayjobs.com/thermofishercareers/job/Porto-Portugal/Software-Engineer_R-01334567",
      ats: "Workday",
      ...overrides,
    });

  it("keeps Workday roles in the configured countries, the only ones its collector reads", () => {
    expect(isDiscoverable(workday({}))).toBe(true);
    expect(isDiscoverable(workday({ location: "PRT - Lisbon (Campus)" }))).toBe(true);
    expect(isDiscoverable(workday({ location: "Braga" }))).toBe(true);
    expect(isDiscoverable(workday({ location: "Oeiras, PT" }))).toBe(true);
    expect(isDiscoverable(workday({ location: "Madrid, Spain" }))).toBe(false);
    expect(isDiscoverable(workday({ location: "Remote, Germany" }))).toBe(false);
    expect(isDiscoverable(workday({ location: "Warsaw, Poland" }))).toBe(false);
  });

  it("skips Workday sites for employees and confidential searches", () => {
    for (const site of ["nonpublic_postings", "internal_employees_not_on_workday", "displacedemployees", "jci_confidential", "inviteonly"]) {
      expect(isDiscoverable(workday({ url: `https://pwc.wd3.myworkdayjobs.com/${site}/job/Lisbon/Software-Engineer_763290WD` })), site).toBe(false);
    }
    // myworkdaysite.com puts the tenant in the path; the site is still the second part of the board.
    expect(
      isDiscoverable(workday({ url: "https://wd3.myworkdaysite.com/en-US/recruiting/abb/external_career_page/job/Porto/Software-Engineer_JR1" })),
    ).toBe(true);
  });

  it("keeps BambooHR roles anywhere in Europe or remote, like the other ATSs", () => {
    const bamboohr = (location: string) =>
      job({ company: "officernd", ats: "BambooHR", url: "https://officernd.bamboohr.com/careers/123", location });
    expect(isDiscoverable(bamboohr("Sofia"))).toBe(true);
    expect(isDiscoverable(bamboohr("Lisboa, Lisboa"))).toBe(true);
    expect(isDiscoverable(bamboohr("Austin, Texas"))).toBe(false);
  });
});

describe("titleKey", () => {
  it("treats one role posted per city as one role", () => {
    const a = titleKey("Senior Software Engineer, Core Experiences - Aarhus, Denmark", "Aarhus, Denmark");
    const b = titleKey("Senior Software Engineer, Core Experiences - Amsterdam, Netherlands", "Amsterdam, Netherlands");
    const c = titleKey("Senior Software Engineer, Core Experiences (Remote)", "Remote");
    expect(a).toBe("senior software engineer, core experiences");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("keeps genuinely different titles apart", () => {
    expect(titleKey("Frontend Engineer", "Berlin")).not.toBe(titleKey("Backend Engineer", "Berlin"));
  });
});
