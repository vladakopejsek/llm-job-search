import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withoutDescription } from "../collect/raw.ts";
import { postingKey, postingKeyFromUrl } from "../screen/posting-key.ts";
import recorded from "./__fixtures__/bamboohr.json" with { type: "json" };
import { bamboohr } from "./bamboohr.ts";
import { parseFeedUrl } from "./feed-url.ts";

// Trimmed real responses of Draslovka's and AfterNow's boards, captured
// 2026-10-26 and keyed by URL. They're served in place of the network, since
// what the collector requests is part of what's tested. Draslovka's job 357 has
// no recorded detail: it answers 404, like a job closed since the list was read.
const responses: Record<string, unknown> = recorded;
let requested: string[] = [];

beforeEach(() => {
  requested = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    requested.push(url);
    if (url in responses) return Response.json(responses[url]);
    return Response.json({ type: "not_found", title: "Resource not found." }, { status: 404 });
  });
});
afterEach(() => vi.restoreAllMocks());

const collect = (company: string) => bamboohr.fetchPostings(parseFeedUrl(`https://${company}.bamboohr.com/careers`)!);
const byId = async (company: string, id: string) => (await collect(company)).find((p) => p.externalId === `${company}/${id}`)!;

describe("BambooHR", () => {
  it("reads the text of engineering titles only, and still returns every listed job", async () => {
    const postings = await collect("draslovka");
    expect(requested).toEqual([
      "https://draslovka.bamboohr.com/careers/list",
      "https://draslovka.bamboohr.com/careers/357/detail",
      "https://draslovka.bamboohr.com/careers/361/detail",
      "https://draslovka.bamboohr.com/careers/362/detail",
    ]);
    // 357 closed between the two requests, so it's left out and collect closes it.
    expect(postings.map((p) => p.externalId)).toEqual(["draslovka/360", "draslovka/361", "draslovka/362", "draslovka/368"]);
    expect(postings[0]).toMatchObject({ title: "Business Analyst (FP&A analyst)", descriptionText: "", locationRaw: "Prague", workplaceRaw: null });
  });

  it("maps a hybrid job: the office with its country, the department, the date and the text", async () => {
    const posting = await byId("draslovka", "362");
    expect(posting).toMatchObject({
      url: "https://draslovka.bamboohr.com/careers/362",
      title: "Senior Back-End Engineer (Czech Republic)",
      locationRaw: "Prague, Czech Republic",
      workplaceRaw: "hybrid",
      department: "Engineering",
      compensationRaw: null,
    });
    expect(posting.postedAt?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(posting.descriptionText).toContain("Choose how you work with hybrid options");
    expect(posting.descriptionText).not.toMatch(/<[a-z]/i);
    expect(postingKeyFromUrl(posting.url)).toBe(postingKey("bamboohr", posting.externalId));
  });

  it("maps a remote job to the remote location it names instead of an office", async () => {
    expect(await byId("draslovka", "361")).toMatchObject({ workplaceRaw: "remote", locationRaw: "South Africa" });
  });

  it("treats locationType 0 as unknown, since fully remote roles carry it too", async () => {
    const posting = await byId("afternow", "62");
    expect(posting).toMatchObject({
      workplaceRaw: null,
      locationRaw: "Europe, Remote, Croatia (Hrvatska)",
      compensationRaw: "Gross (B2B) 3000€ ~ 4000€ / month",
    });
    expect(posting.descriptionText).toContain("Fully remote");
  });

  it("keeps the list entry merged with the detail, stored without the description", async () => {
    const raw = (await byId("draslovka", "362")).raw as Record<string, unknown>;
    expect(raw).toMatchObject({ id: "362", locationType: "2", jobOpeningShareUrl: "https://draslovka.bamboohr.com/careers/362" });
    expect(withoutDescription("bamboohr", raw)).not.toHaveProperty("description");
  });

  it("fails when every engineering detail is refused, instead of closing them all", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).endsWith("/list") ? Response.json(responses["https://draslovka.bamboohr.com/careers/list"]) : new Response(null, { status: 404 }),
    );
    await expect(collect("draslovka")).rejects.toThrow(/refused all 3 job details/);
  });

  it("reports a subdomain that isn't a BambooHR company as not found", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://www.bamboohr.com/" } }));
    await expect(collect("no-such-company")).rejects.toMatchObject({ name: "CollectorError", httpStatus: 404 });
  });
});

describe("BambooHR URLs", () => {
  it.each([
    "https://voucherify.bamboohr.com/careers",
    "https://voucherify.bamboohr.com/careers/list",
    "https://voucherify.bamboohr.com/careers/82",
    "https://voucherify.bamboohr.com/careers/82/detail",
    "https://voucherify.bamboohr.com/jobs/",
    "https://Voucherify.bamboohr.com/jobs/view.php?id=82",
  ])("%s is Voucherify's board", (url) => {
    expect(parseFeedUrl(url)).toEqual({ ats: "bamboohr", token: "voucherify", host: "voucherify.bamboohr.com" });
  });

  it("doesn't take BambooHR's own hosts for a company's board", () => {
    expect(parseFeedUrl("https://www.bamboohr.com/careers")).toBeNull();
    expect(parseFeedUrl("https://api.bamboohr.com/api/gateway.php/acme/v1/applicant_tracking/jobs")).toBeNull();
  });

  it("gives every URL form of a job the same key, which includes the company", () => {
    const key = postingKey("bamboohr", "voucherify/82");
    expect(postingKeyFromUrl("https://voucherify.bamboohr.com/careers/82")).toBe(key);
    expect(postingKeyFromUrl("https://voucherify.bamboohr.com/careers/82/detail")).toBe(key);
    expect(postingKeyFromUrl("https://voucherify.bamboohr.com/jobs/view.php?id=82")).toBe(key);
    expect(postingKeyFromUrl("https://draslovka.bamboohr.com/careers/82")).not.toBe(key);
  });
});
