import { describe, expect, it } from "vitest";
import ashbyFixture from "./__fixtures__/ashby.json" with { type: "json" };
import greenhouseFixture from "./__fixtures__/greenhouse.json" with { type: "json" };
import leverFixture from "./__fixtures__/lever.json" with { type: "json" };
import { normalizeAshby } from "./ashby.ts";
import { normalizeGreenhouse } from "./greenhouse.ts";
import { normalizeLever } from "./lever.ts";
import { CollectorError } from "./types.ts";

// Fixtures are trimmed real responses from public boards on Ashby, Greenhouse and Lever,
// with the company names replaced.

describe("normalizeAshby", () => {
  const postings = normalizeAshby(ashbyFixture);

  it("drops unlisted jobs", () => {
    expect(postings).toHaveLength(2);
    expect(postings.map((p) => p.externalId)).not.toContain("00000000-unlisted-example");
  });

  it("maps the fields we rely on", () => {
    const [first] = postings;
    expect(first).toMatchObject({
      externalId: "d3bc1ced-3ce4-4086-a050-555055dbb1ff",
      title: "Senior / Staff Fullstack Engineer",
      url: "https://jobs.ashbyhq.com/acme/d3bc1ced-3ce4-4086-a050-555055dbb1ff",
      workplaceRaw: "Remote",
    });
    expect(first?.postedAt?.toISOString()).toBe("2021-04-27T20:13:45.158Z");
    expect(first?.descriptionText).toMatch(/^At Acme, we're building/);
    expect(first?.descriptionText).not.toMatch(/<[a-z]/i);
  });

  it("joins primary and secondary locations", () => {
    expect(postings[1]?.locationRaw).toContain("; ");
  });

  it("keeps the original job object", () => {
    expect(postings[0]?.raw).toBe(ashbyFixture.jobs[0]);
  });
});

describe("normalizeGreenhouse", () => {
  const postings = normalizeGreenhouse(greenhouseFixture);

  it("unescapes the HTML before converting it to text", () => {
    for (const p of postings) {
      expect(p.descriptionText.length).toBeGreaterThan(200);
      expect(p.descriptionText).not.toMatch(/<[a-z]|&lt;|&amp;|&nbsp;|&quot;/i);
    }
    expect(postings[0]?.descriptionText).toMatch(/About Remote/);
  });

  it("uses first_published as the posting date and stringifies the id", () => {
    expect(postings[0]).toMatchObject({ externalId: "7835639003", locationRaw: "Remote- Romania", workplaceRaw: null });
    expect(postings[0]?.postedAt?.toISOString()).toBe("2026-08-07T14:21:09.000Z");
  });
});

describe("normalizeLever", () => {
  const postings = normalizeLever(leverFixture);

  it("assembles the description from its sections", () => {
    const text = postings[0]?.descriptionText ?? "";
    expect(text).toMatch(/^We design Globex/);
    expect(text).toContain("What You'll Do\n");
    expect(text).toContain("Who You Are\n");
    expect(text).toMatch(/equal opportunity employer/);
  });

  it("puts bare <li> list items on lines of their own", () => {
    expect(postings[1]?.descriptionText).toContain(
      "* Maintain positive partnerships across artist and label communities within Vietnam.\n * Support our key partners",
    );
  });

  it("maps locations, workplace type and the millisecond timestamp", () => {
    expect(postings[0]).toMatchObject({
      title: "Android Engineer - Experience",
      locationRaw: "London; Stockholm",
      workplaceRaw: "hybrid",
    });
    expect(postings[0]?.postedAt?.getTime()).toBe(1782214185805);
  });
});

describe("unexpected shapes", () => {
  it("throws a CollectorError instead of returning bad data", () => {
    expect(() => normalizeAshby({ results: [] })).toThrow(CollectorError);
    expect(() => normalizeGreenhouse({ jobs: [{ id: "not-a-number" }] })).toThrow(CollectorError);
    expect(() => normalizeLever({ ok: false, error: "Document not found" })).toThrow(CollectorError);
  });
});
