import { describe, expect, it } from "vitest";
import { postingKey, postingKeyFromUrl } from "./posting-key.ts";

describe("postingKeyFromUrl", () => {
  const ashbyId = "5b0e7c2a-1d34-4f6b-9a8e-2c7d4e1f0b63";

  it("gives every URL form of one posting the same key", () => {
    const key = postingKey("ashby", ashbyId);
    expect(postingKeyFromUrl(`https://jobs.ashbyhq.com/globex/${ashbyId}`)).toBe(key);
    expect(postingKeyFromUrl(`https://jobs.ashbyhq.com/globex/${ashbyId}/application`)).toBe(key);
    expect(postingKeyFromUrl(`https://jobs.ashbyhq.com/globex/${ashbyId.toUpperCase()}?utm_source=x`)).toBe(key);
  });

  it("reads Greenhouse ids from board URLs, EU hosts and embedded ?gh_jid=", () => {
    const key = "greenhouse:4012345678";
    expect(postingKeyFromUrl("https://job-boards.greenhouse.io/hooli/jobs/4012345678")).toBe(key);
    expect(postingKeyFromUrl("https://job-boards.eu.greenhouse.io/hooli/jobs/4012345678")).toBe(key);
    expect(postingKeyFromUrl("https://boards.greenhouse.io/hooli/jobs/4012345678?gh_src=abc")).toBe(key);
    expect(postingKeyFromUrl("https://www.example.com/careers/job?gh_jid=4012345678")).toBe(key);
  });

  it("reads Lever ids", () => {
    const id = "8c3f1e9d-4a72-4b05-b6d1-7e2a9c0f5d48";
    expect(postingKeyFromUrl(`https://jobs.lever.co/initech/${id}/apply`)).toBe(postingKey("lever", id));
  });

  it("reads Workday postings by tenant, whatever the site, locale or domain in the URL", () => {
    const key = "workday:abb/r-d-engineer_jr00044029";
    expect(postingKeyFromUrl("https://abb.wd3.myworkdayjobs.com/external_career_page/job/Lisbon-Portugal/R-D-Engineer_JR00044029")).toBe(key);
    expect(postingKeyFromUrl("https://abb.wd3.myworkdayjobs.com/en-US/External_Career_Page/job/Lisbon/R-D-Engineer_JR00044029/apply")).toBe(key);
    expect(postingKeyFromUrl("https://abb.wd3.myworkdayjobs.com/en-US/broadbean_external/details/R-D-Engineer_JR00044029?q=x")).toBe(key);
    expect(postingKeyFromUrl("https://wd3.myworkdaysite.com/recruiting/abb/External_Career_Page/job/Lisbon/R-D-Engineer_JR00044029")).toBe(key);
    expect(postingKeyFromUrl("https://abb.wd3.myworkdayjobs.com/wday/cxs/abb/external_career_page/job/Lisbon/R-D-Engineer_JR00044029")).toBe(key);
    // Req ids can hold underscores, and some job URLs have no location part.
    expect(
      postingKeyFromUrl("https://2020companies.wd1.myworkdayjobs.com/external_careers/job/Southlake-TX/Accounts-Payable-Coordinator_REQ_113804"),
    ).toBe("workday:2020companies/accounts-payable-coordinator_req_113804");
    expect(postingKeyFromUrl("https://9dot.wd503.myworkdayjobs.com/ofl_careers/job/Substitute-Teacher--25-26-Pool-_R014398")).toBe(
      "workday:9dot/substitute-teacher--25-26-pool-_r014398",
    );
    // A board URL isn't a posting.
    expect(postingKeyFromUrl("https://redhat.wd5.myworkdayjobs.com/en-US/jobs")).toBe("url:redhat.wd5.myworkdayjobs.com/en-us/jobs");
  });

  it("falls back to a normalised URL for other sites", () => {
    expect(postingKeyFromUrl("https://www.Example.com/jobs/senior-full-stack-engineer/?ref=x")).toBe(
      "url:example.com/jobs/senior-full-stack-engineer",
    );
    expect(postingKeyFromUrl("not a url")).toBeNull();
  });
});
