import { describe, expect, it } from "vitest";
import { withoutDescription } from "../collect/raw.ts";
import { postingKey, postingKeyFromUrl } from "../screen/posting-key.ts";
import facetsFixture from "./__fixtures__/workday-facets.json" with { type: "json" };
import jobFixture from "./__fixtures__/workday-job.json" with { type: "json" };
import remoteTypeJobFixture from "./__fixtures__/workday-job-remote-type.json" with { type: "json" };
import searchFixture from "./__fixtures__/workday-search.json" with { type: "json" };
import czskFixture from "./__fixtures__/workday-search-czsk.json" with { type: "json" };
import czskPage2Fixture from "./__fixtures__/workday-search-czsk-20.json" with { type: "json" };
import { CollectorError } from "./types.ts";
import { collectWorkday, normalizeWorkdayJob, workdayFilter } from "./workday.ts";

// Trimmed real responses, captured 2026-10-26: ESET's search (unfiltered, then
// filtered to Czechia + Slovakia, two pages), one ESET and one Kyndryl job, and
// the location facets of Thermo Fisher, Barclays, Valeo and Red Hat. So the
// configured countries here are those, not the example config's.
const CZSK = {
  countries: ["Czechia", "Czech Republic", "Slovakia", "Slovak Republic"],
  places: [
    "cze",
    "svk",
    "prague",
    "praha",
    "brno",
    "ostrava",
    "plzeň",
    "pilsen",
    "olomouc",
    "pardubice",
    "hradec králové",
    "zlín",
    "bratislava",
    "košice",
    "žilina",
    "nitra",
    "trnava",
    "banská bystrica",
    "prešov",
    "trenčín",
    "česko",
    "česká republika",
    "slovensko",
  ],
};

const eset = { ats: "workday", token: "eset/ESET_External", host: "eset.wd3.myworkdayjobs.com" } as const;
const ESET_COUNTRIES = ["cefa4adabe07100204b7ece2e81b0000", "b37b51fe8a261000752d344a49010000"];

describe("workdayFilter", () => {
  it("uses the country facet, found inside ESET's nested location group", () => {
    expect(workdayFilter(searchFixture.facets, CZSK)).toEqual({ parameter: "locationHierarchy2", ids: ESET_COUNTRIES, count: 52 });
  });

  it("falls back to the locations facet when there's no country facet (Thermo Fisher)", () => {
    const filter = workdayFilter(facetsFixture.thermofisher, CZSK);
    expect(filter?.parameter).toBe("locations");
    // Brno, Pardubice, Prague, Remote Czechia, Remote Slovakia, Samorin: not Bangalore or Eindhoven.
    expect(filter?.ids).toHaveLength(6);
    expect(filter?.count).toBe(115);
  });

  it("reads a location named by its city alone (Barclays' Prague offices)", () => {
    expect(workdayFilter(facetsFixture.barclays, CZSK)).toEqual({
      parameter: "locations",
      ids: ["1ab48a98eb7c100163431b19e4110000", "112c054282011001637b42605aba0000"],
      count: 11,
    });
  });

  it("prefers the country facet, and doesn't take Czechowice (Poland) for Czechia", () => {
    const filter = workdayFilter(facetsFixture.valeo, CZSK);
    expect(filter).toMatchObject({ parameter: "locationCountry", count: 33 });
    expect(filter?.ids).toHaveLength(2);
  });

  it("returns null for a board with no jobs in the configured countries (Red Hat today)", () => {
    expect(workdayFilter(facetsFixture.redhat, CZSK)).toBeNull();
  });
});

describe("normalizeWorkdayJob", () => {
  const listing = czskFixture.jobPostings[1]!;
  const posting = normalizeWorkdayJob(eset, listing, jobFixture);

  it("keys the posting by tenant + the posting id from its path, which keeps its first title", () => {
    expect(posting).toMatchObject({
      externalId: "eset/AI-Enablement-Software-Engineer_JR-06088",
      title: "Senior AI Enablement Software Engineer (m/f/n)",
      url: "https://eset.wd3.myworkdayjobs.com/ESET_External/job/Bratislava/AI-Enablement-Software-Engineer_JR-06088",
    });
    expect(postingKeyFromUrl(posting.url)).toBe(postingKey("workday", posting.externalId));
  });

  it("adds the country to a bare city and joins the additional locations", () => {
    expect(posting.locationRaw).toBe("Bratislava, Slovakia; Brno");
  });

  it("reads the description and the start date, not 'Posted 3 Days Ago'", () => {
    expect(posting.descriptionText).toContain("AI is reshaping how software gets built");
    expect(posting.descriptionText).not.toMatch(/<[a-z]|&#39;/i);
    expect(posting.postedAt?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("leaves the workplace unknown without a remoteType, and maps the tenant's own labels", () => {
    expect(posting.workplaceRaw).toBeNull();
    const kyndryl = { ats: "workday", token: "kyndryl/KyndrylProfessionalCareers", host: "kyndryl.wd5.myworkdayjobs.com" } as const;
    const path = "/job/Brno-Jihomoravsk-kraj-Czechia/Regional-AI-Deployment-Leader---EMEA_R-70423-1";
    const other = normalizeWorkdayJob(kyndryl, { title: "x", externalPath: path }, remoteTypeJobFixture);
    expect(other).toMatchObject({ workplaceRaw: "hybrid", locationRaw: "Brno, Jihomoravský kraj, Czechia" }); // "Partially Remote"
  });

  it("keeps the job object as raw, stored without its description", () => {
    expect(posting.raw).toBe(jobFixture.jobPostingInfo);
    expect(withoutDescription("workday", posting.raw)).not.toHaveProperty("jobDescription");
    expect(withoutDescription("workday", posting.raw)).toHaveProperty("jobReqId", "JR-06088");
  });
});

describe("collectWorkday", () => {
  /** Serves the fixtures as ESET's API did, and records every call. */
  const fakeApi = (overrides: { detail?: (path: string) => unknown; filtered?: unknown } = {}) => {
    const calls: { path: string; json?: unknown }[] = [];
    const api = async (path: string, json?: unknown) => {
      calls.push({ path, json });
      if (path !== "/jobs") {
        if (overrides.detail) return overrides.detail(path);
        if (path === czskFixture.jobPostings[1]!.externalPath) return jobFixture;
        throw new CollectorError("HTTP 403 from …", 403); // closed since the search
      }
      const { appliedFacets, offset } = json as { appliedFacets: Record<string, string[]>; offset: number };
      if (!Object.keys(appliedFacets).length) return searchFixture;
      if (overrides.filtered) return overrides.filtered;
      return offset === 0 ? czskFixture : offset === 20 ? czskPage2Fixture : { total: 0, jobPostings: [], facets: [] };
    };
    return { api, calls };
  };

  it("searches with the country facet, pages through it, and fetches details only for engineering titles", async () => {
    const { api, calls } = fakeApi();
    const postings = await collectWorkday(eset, api, CZSK);

    expect(calls.map((c) => c.path)).toEqual([
      "/jobs",
      "/jobs",
      "/jobs",
      "/jobs",
      czskFixture.jobPostings[1]!.externalPath,
      czskFixture.jobPostings[2]!.externalPath,
    ]);
    expect(calls[1]?.json).toEqual({ appliedFacets: { locationHierarchy2: ESET_COUNTRIES }, limit: 20, offset: 0, searchText: "" });
    expect(calls.slice(1, 4).map((c) => (c.json as { offset: number }).offset)).toEqual([0, 20, 40]);

    // Everything listed comes back, so collect doesn't close it; the job that 403'd is left out.
    expect(postings.map((p) => p.externalId)).toEqual([
      "eset/Senior-Legal-Counsel--m-f-n-_JR-06158",
      "eset/AI-Enablement-Software-Engineer_JR-06088",
      "eset/Koordintor-ka-kancelskho-provozu-pro-ESET_JR-06101",
      "eset/Senior-AI-Machine-Learning-Researcher_JR-06053",
      "eset/Head-of-Enterprise-SW-Architecture_JR-05913",
    ]);
    expect(postings.filter((p) => p.descriptionText).map((p) => p.title)).toEqual(["Senior AI Enablement Software Engineer (m/f/n)"]);
    expect(postings[0]).toMatchObject({
      url: "https://eset.wd3.myworkdayjobs.com/ESET_External/job/Bratislava/Senior-Legal-Counsel--m-f-n-_JR-06158",
      locationRaw: "Bratislava",
      descriptionText: "",
    });
  });

  it("makes one request for a board with no jobs in the configured countries", async () => {
    const calls: string[] = [];
    const postings = await collectWorkday(
      eset,
      async (path) => {
        calls.push(path);
        return { ...searchFixture, facets: facetsFixture.redhat };
      },
      CZSK,
    );
    expect(postings).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("fails rather than read the whole board when the facet isn't applied", async () => {
    const { api } = fakeApi({ filtered: { ...searchFixture, total: 3008 } });
    await expect(collectWorkday(eset, api, CZSK)).rejects.toThrow(/ignored the locationHierarchy2 facet/);
  });

  it("fails when every job detail is refused, instead of closing them all", async () => {
    const { api } = fakeApi({
      detail: () => {
        throw new CollectorError("HTTP 403 from …", 403);
      },
    });
    await expect(collectWorkday(eset, api, CZSK)).rejects.toThrow(/refused all 2 job details/);
  });

  it("fails on a search without facets", async () => {
    await expect(collectWorkday(eset, async () => ({ total: 72, jobPostings: [] }), CZSK)).rejects.toThrow(CollectorError);
  });
});
