import { describe, expect, it } from "vitest";
import { parseFeedUrl } from "./feed-url.ts";

describe("parseFeedUrl", () => {
  it.each([
    ["https://api.ashbyhq.com/posting-api/job-board/globex", "ashby", "globex", "api.ashbyhq.com"],
    ["https://api.ashbyhq.com/posting-api/job-board/globex?includeCompensation=true", "ashby", "globex", "api.ashbyhq.com"],
    ["https://jobs.ashbyhq.com/globex", "ashby", "globex", "api.ashbyhq.com"],
    ["https://boards-api.greenhouse.io/v1/boards/hooli/jobs", "greenhouse", "hooli", "boards-api.greenhouse.io"],
    ["https://job-boards.greenhouse.io/hooli", "greenhouse", "hooli", "boards-api.greenhouse.io"],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/123", "greenhouse", "acme", "boards-api.greenhouse.io"],
    ["https://api.lever.co/v0/postings/initech?mode=json", "lever", "initech", "api.lever.co"],
    ["https://jobs.eu.lever.co/acme", "lever", "acme", "api.eu.lever.co"],
    ["  https://jobs.lever.co/initech/  ", "lever", "initech", "api.lever.co"],
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=123", "greenhouse", "acme", "boards-api.greenhouse.io"],
  ])("%s", (input, ats, token, host) => {
    expect(parseFeedUrl(input)).toEqual({ ats, token, host });
  });

  it.each([
    [null],
    [""],
    ["not a url"],
    ["https://urbantz.breezy.hr/json"],
    ["https://jobs.ashbyhq.com/"],
    ["https://example.com/careers"],
    ["https://jobs.lever.co/acme%"],
    ["https://boards.greenhouse.io/embed/job_app"],
  ])("returns null for %s", (input) => {
    expect(parseFeedUrl(input)).toBeNull();
  });
});

describe("parseFeedUrl for Workday", () => {
  // The board is tenant + site: 248 boards in the snapshot are a site named "External".
  it.each([
    ["https://redhat.wd5.myworkdayjobs.com/jobs", "redhat/jobs", "redhat.wd5.myworkdayjobs.com"],
    ["https://procore.wd12.myworkdayjobs.com/en-US/Procore_External_Careers", "procore/Procore_External_Careers", "procore.wd12.myworkdayjobs.com"],
    ["https://browserstack.wd3.myworkdayjobs.com/External?locations=abc", "browserstack/External", "browserstack.wd3.myworkdayjobs.com"],
    // A job URL names its board too; discovery reads boards from job URLs.
    [
      "https://abb.wd3.myworkdayjobs.com/external_career_page/job/Lisbon-Portugal/R-D-Engineer_JR00044029",
      "abb/external_career_page",
      "abb.wd3.myworkdayjobs.com",
    ],
    ["https://eset.wd3.myworkdayjobs.com/wday/cxs/eset/ESET_External/jobs", "eset/ESET_External", "eset.wd3.myworkdayjobs.com"],
    ["https://wd3.myworkdaysite.com/en-US/recruiting/eset/ESET_External", "eset/ESET_External", "wd3.myworkdaysite.com"],
    [
      "https://wd3.myworkdaysite.com/recruiting/eset/ESET_External/job/Lisbon/DevOps-Engineer--m-f-n-_JR-06095",
      "eset/ESET_External",
      "wd3.myworkdaysite.com",
    ],
  ])("%s", (input, token, host) => {
    expect(parseFeedUrl(input)).toEqual({ ats: "workday", token, host });
  });

  it.each([
    ["https://redhat.wd5.myworkdayjobs.com/"],
    ["https://redhat.wd5.myworkdayjobs.com/en-US"],
    ["https://wd3.myworkdaysite.com/en-US/eset/ESET_External"],
    ["https://redhat.wd5.myworkdayjobs-impl.com/jobs"],
  ])("returns null for %s", (input) => {
    expect(parseFeedUrl(input)).toBeNull();
  });
});
