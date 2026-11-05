import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeStartupJobsOffer, offerCompany } from "../../ats/startupjobs.ts";
import { CollectorError, type NormalizedPosting } from "../../ats/types.ts";
import { namesStack, withinReach } from "../../postings/signals.ts";
import { isBoardMatch, isSoftwareSlug, isStrongMatch } from "./match.ts";
import { sitemapOffers } from "./startupjobs.ts";

const offerPage = readFileSync(path.join(import.meta.dirname, "../../ats/__fixtures__/startupjobs-offer.html"), "utf8");

const posting = (overrides: Partial<NormalizedPosting>): NormalizedPosting => ({
  externalId: "1",
  url: "https://www.startupjobs.cz/nabidka/1/x",
  title: "Senior Full-stack Developer",
  locationRaw: "Lisboa, Portugal",
  workplaceRaw: null,
  department: null,
  descriptionText: "We build our product in TypeScript, React and Node.js.",
  compensationRaw: null,
  postedAt: null,
  raw: {},
  ...overrides,
});

describe("StartupJobs board scan", () => {
  it("reads every open offer from the sitemap", () => {
    const xml = `<urlset><url><loc>https://www.startupjobs.cz/nabidka/108681/ai-fullstack-developer</loc></url>
      <url><loc>https://www.startupjobs.cz/nabidka/39169/ppc-specialist-at-taste</loc></url></urlset>`;
    expect(sitemapOffers(xml)).toEqual([
      { id: "108681", slug: "ai-fullstack-developer" },
      { id: "39169", slug: "ppc-specialist-at-taste" },
    ]);
  });

  it("reads offers whose title slug looks like software, in English or a local title word", () => {
    expect(isSoftwareSlug("ai-fullstack-developer")).toBe(true);
    expect(isSoftwareSlug("procuramos-programador-a-na-globex")).toBe(true);
    expect(isSoftwareSlug("desenvolvedora-frontend-senior")).toBe(true);
    expect(isSoftwareSlug("node-js-developer-medior-senior-full-remote-greenfield-projekty")).toBe(true);
    expect(isSoftwareSlug("ppc-specialist-at-taste")).toBe(false);
    expect(isSoftwareSlug("business-development-representative-bdr")).toBe(false);
  });

  it("names the company that posted an offer", () => {
    expect(offerCompany(offerPage)).toEqual({ slug: "smartsupp", name: "Smartsupp" });
    expect(offerCompany("<html><body>Nabídka již není aktivní</body></html>")).toBeNull();
  });
});

describe("board matches", () => {
  it("keeps software roles the screen lets through, local titles included", () => {
    expect(isBoardMatch(normalizeStartupJobsOffer(offerPage, "smartsupp")!)).toBe(true);
    expect(isBoardMatch(posting({ title: "Procuramos Programador(a) na Globex", locationRaw: "Portugal", descriptionText: "PHP e Vue" }))).toBe(true);
  });

  it("drops what the screen drops, and roles with neither a software title nor the stack", () => {
    expect(isBoardMatch(posting({ title: "Software QA Tester" }))).toBe(false);
    expect(isBoardMatch(posting({ locationRaw: "Austin, TX", workplaceRaw: "onsite", descriptionText: "React in our Austin office" }))).toBe(false);
    expect(isBoardMatch(posting({ title: "Account Manager", descriptionText: "Sell our CRM" }))).toBe(false);
  });

  it("watches a company right away only when the role names the stack", () => {
    expect(isStrongMatch(posting({}))).toBe(true);
    expect(isStrongMatch(posting({ title: "Java Engineer", descriptionText: "Java 21 and Spring" }))).toBe(false);
  });
});

describe("worth-a-look signals", () => {
  it("needs the stack and a place within reach from home", () => {
    expect(namesStack("Frontend Engineer", "We use Next.js")).toBe(true);
    expect(withinReach("Évora, Portugal", "")).toBe(true);
    expect(withinReach(null, "Escritório em Lisboa")).toBe(true);
    expect(withinReach("Remote", "Open to candidates across Europe")).toBe(true);
    expect(withinReach("Remote", "US only, 401k")).toBe(false);
    // The location decides when it rules home out, whatever the text mentions.
    expect(withinReach("Latin America - Remote", "Our teams across Europe and the Americas")).toBe(false);
  });
});

describe("EU Remote Jobs", async () => {
  const { applyLink, euRemoteJobsRole, sitemapJobs } = await import("./euremotejobs.ts");
  const page = (countries: string[], apply: string) => `<html><head>
    <script type="application/ld+json" class="aioseo-schema">{"@graph":[{"@type":"WebPage"}]}</script>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Senior Frontend Engineer",
      description: "<p>React and TypeScript, remote across Europe.</p>",
      datePosted: "2026-10-26T14:12:15+01:00",
      hiringOrganization: { name: "Globex" },
      jobLocation: { address: "Europe, Lithuania" },
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: countries.map((name) => ({ name })),
    })}</script></head>
    <body><a href="${apply}" target="_blank" class="application_button_link button">Apply</a></body></html>`;

  it("reads job URLs and their last change from the sitemap", () => {
    const xml = `<url><loc><![CDATA[https://euremotejobs.com/job/senior-typescript-developer/]]></loc>
      <lastmod><![CDATA[2026-10-26T13:13:30+00:00]]></lastmod></url>`;
    expect(sitemapJobs(xml)).toEqual([
      {
        url: "https://euremotejobs.com/job/senior-typescript-developer/",
        slug: "senior-typescript-developer",
        lastmod: new Date("2026-10-26T13:13:30Z"),
      },
    ]);
  });

  it("follows the apply button to the company's ATS, without the board's tracking", () => {
    const apply = "https://job-boards.greenhouse.io/globex/jobs/4012345678?utm_source=jobs&#038;utm_medium=euremotejobs";
    expect(applyLink(page([], apply))).toBe("https://job-boards.greenhouse.io/globex/jobs/4012345678");
    const role = euRemoteJobsRole(page(["Portugal", "Lithuania"], apply), "https://euremotejobs.com/job/x/", "x");
    expect(role).toMatchObject({ company: "Globex", board: { ats: "greenhouse", token: "globex" }, postingKey: "euremotejobs:x" });
  });

  it("skips roles whose country list leaves the home country out, and counts apply links we can't collect", () => {
    const apply = "https://job-boards.greenhouse.io/globex/jobs/1";
    expect(euRemoteJobsRole(page(["Spain", "France"], apply), "u", "x")).toBeNull();
    expect(euRemoteJobsRole(page([], "https://example.com/careers/some-role"), "u", "x")).toBe("uncollectable");
  });
});

describe("name-only boards", async () => {
  const { himalayasLocation } = await import("./himalayas.ts");
  const { jobicyRole } = await import("./jobicy.ts");
  const job = {
    id: 1,
    url: "https://jobicy.com/jobs/1-x",
    jobTitle: "Senior Software Engineer",
    companyName: "Umbrella",
    jobDescription: "<p>Node.js</p>",
    pubDate: "2026-10-26T10:51:46+00:00",
  };

  it("says where a Himalayas role is open", () => {
    expect(himalayasLocation([])).toBe("Worldwide");
    expect(himalayasLocation(["Portugal", "Spain"])).toBe("Portugal, Spain");
    expect(himalayasLocation(Array.from({ length: 43 }, (_, i) => `C${i}`))).toBe("43 countries incl. Portugal");
  });

  it("keeps Jobicy roles open to Europe, anywhere or the home country, not another country", () => {
    expect(jobicyRole({ ...job, jobGeo: "Europe" })).toMatchObject({ company: "Umbrella", board: null, postingKey: "jobicy:1" });
    expect(jobicyRole({ ...job, jobGeo: "Anywhere" })).not.toBeNull();
    expect(jobicyRole({ ...job, jobGeo: "Portugal" })).not.toBeNull();
    expect(jobicyRole({ ...job, jobGeo: "Spain" })).toBeNull();
  });
});

describe("ATS lookup", async () => {
  const { likelyTokens, sameRole } = await import("./resolve.ts");

  it("tries the board's slug, the name squashed and the name dashed", () => {
    expect(likelyTokens("Stark Industries", "starkind")).toEqual(["starkind", "starkindustries", "stark-industries"]);
    expect(likelyTokens("Hoolí Group")).toEqual(["hooligroup", "hooli", "hooli-group"]);
  });

  it("accepts a board only if it lists the same role", () => {
    expect(sameRole("Senior Frontend Engineer", "Senior Frontend Engineer (Remote, EU)")).toBe(true);
    expect(sameRole("Senior Frontend Engineer - Remote Europe", "Senior Frontend Engineer")).toBe(true);
    expect(sameRole("Engineer", "Senior Frontend Engineer")).toBe(false);
    expect(sameRole("Senior Engineer", "Senior Engineering Manager")).toBe(false);
  });
});

describe("HN Who is hiring", async () => {
  const { parseHnPost, siteToken } = await import("./hn.ts");
  const post =
    'Acme (YC W21) | Senior Full-Stack Engineer | Remote (EU, CET ±2) | Full-time<p>We build logistics software in TypeScript and React. Apply: <a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme&#x2F;92085ccf-568e-42ed-b707-3f08cce890a7" rel="nofollow">here</a>, or see <a href="https:&#x2F;&#x2F;www.acme.io" rel="nofollow">acme.io</a>';

  it("reads company, role and location from a post's header", () => {
    expect(parseHnPost(post)).toMatchObject({
      company: "Acme",
      title: "Senior Full-Stack Engineer",
      header: "Acme (YC W21) | Senior Full-Stack Engineer | Remote (EU, CET ±2) | Full-time",
    });
    expect(parseHnPost(post)?.links).toEqual(["https://jobs.ashbyhq.com/acme/92085ccf-568e-42ed-b707-3f08cce890a7", "https://www.acme.io"]);
  });

  it("skips posts with no engineering role in the header", () => {
    expect(parseHnPost("Acme | Account Executive | NYC<p>Sell things")).toBeNull();
  });

  it("takes the company's website name as a likely ATS token, not the ATS link", () => {
    expect(siteToken(["https://jobs.ashbyhq.com/acme/1", "https://www.acme.io"])).toBe("acme");
    expect(siteToken(["https://news.ycombinator.com/item?id=1"])).toBeUndefined();
    expect(siteToken(["https://airtable.com/appX/form", "https://careers.acme.io/jobs"])).toBe("acme");
  });
});

describe("ATS lookup results", async () => {
  const { findAtsBoard } = await import("./resolve.ts");
  const { vi } = await import("vitest");
  const index = await import("../../ats/index.ts");

  it("confirms a board that lists the role, and returns a board found by name alone unconfirmed", async () => {
    const titles = ["Senior Frontend Engineer"];
    const spy = vi
      .spyOn(index, "collectorFor")
      .mockImplementation((ats) =>
        ats === "greenhouse"
          ? { ats, fetchPostings: async () => [posting({ title: "Customer Support Engineer" })] }
          : { ats, fetchPostings: async () => Promise.reject(new CollectorError("HTTP 404", 404)) },
      );
    expect(await findAtsBoard("Initech", undefined, titles)).toMatchObject({ board: { ats: "greenhouse", token: "initech" }, confirmed: false });
    spy.mockImplementation((ats) =>
      ats === "lever"
        ? { ats, fetchPostings: async () => [posting({ title: "Senior Frontend Engineer (Remote)" })] }
        : { ats, fetchPostings: async () => [] },
    );
    expect(await findAtsBoard("Acme", undefined, titles)).toMatchObject({ board: { ats: "lever", token: "acme" }, confirmed: true });
    spy.mockRestore();
  });

  it("fails on a network error or a 5xx instead of reporting no board", async () => {
    for (const error of [new CollectorError("Request failed: https://…", null), new CollectorError("HTTP 503 from …", 503)]) {
      const spy = vi.spyOn(index, "collectorFor").mockImplementation((ats) => ({ ats, fetchPostings: async () => Promise.reject(error) }));
      await expect(findAtsBoard("Acme", undefined, ["Senior Frontend Engineer"])).rejects.toBe(error);
      spy.mockRestore();
    }
  });
});

describe("Czech boards that name only the company", async () => {
  const { jobstackOffers, jobstackRole } = await import("./jobstack.ts");
  const { cocumaJobs, cocumaRole } = await import("./cocuma.ts");

  it("reads Jobstack's offers and an offer page", () => {
    expect(jobstackOffers("<loc>https://www.jobstack.it/it-job/react-developer/5c0f96ef19d1c</loc>")).toEqual([
      { category: "react-developer", id: "5c0f96ef19d1c" },
    ]);
    const page = `<div class="jobpost-2023"><h1 class="jobpost-h1-2023">NEXT.js developer (Medior)</h1>
      <ul class="jobpost-values-2023"><li>Senior</li></ul><h6 class="jobpost-label-2023">Informace</h6>
      <ul class="jobpost-values-2023"><li><span><a href="/company-profile/1-web-it-s-r-o/5bd1b304e9d0d">1. Web IT s.r.o.</a></span></li>
      <li><span>Drtinova 10, Praha 5</span></li></ul><p>Stavíme aplikace v Next.js a TypeScriptu.</p></div>
      <div class="jobposts jobposts--next"><p>Senior Java Developer</p></div>`;
    const role = jobstackRole(page, "5c0f96ef19d1c", "https://www.jobstack.it/it-job/react-developer/5c0f96ef19d1c");
    expect(role).toMatchObject({ company: "1. Web IT s.r.o.", companySlug: "1-web-it-s-r-o", board: null, postingKey: "jobstack:5c0f96ef19d1c" });
    expect(role?.posting.title).toBe("NEXT.js developer (Medior)");
    expect(role?.posting.locationRaw).toBe("Drtinova 10, Praha 5, Česko");
    expect(role?.posting.descriptionText).toContain("TypeScriptu");
    expect(role?.posting.descriptionText).not.toContain("Senior Java Developer"); // other offers listed below aren't this role
  });

  it("reads Cocuma's jobs and a job page", () => {
    const xml = "<url><loc>https://www.cocuma.cz/job/js-fullstack-developer/10016/</loc><lastmod>2026-07-22</lastmod></url>";
    expect(cocumaJobs(xml)).toEqual([
      {
        url: "https://www.cocuma.cz/job/js-fullstack-developer/10016/",
        slug: "js-fullstack-developer",
        id: "10016",
        lastmod: new Date("2026-07-22"),
      },
    ]);
    const page = `<title>⚡JS Fullstack Developer⚡ – Práce v INVENTI | Cocuma</title>
      <section id="jobDetail"><h1 class="job-title mb-3">⚡JS Fullstack Developer⚡</h1>
      <dl class="dl-inline"><dt>Adresa</dt><dd>Plynární 1617/10, Holešovice</dd></dl><p>React a Node.js</p></section>
      <div class="job-sidebar"><a class="company-thumbnail-header" href="https://www.cocuma.cz/company/inventi/">INVENTI</a></div>`;
    expect(cocumaRole(page, "10016", "https://www.cocuma.cz/job/js-fullstack-developer/10016/")).toMatchObject({
      company: "INVENTI",
      companySlug: "inventi",
      postingKey: "cocuma:10016",
      posting: { title: "⚡JS Fullstack Developer⚡", locationRaw: "Plynární 1617/10, Holešovice, Česko" },
    });
  });
});
