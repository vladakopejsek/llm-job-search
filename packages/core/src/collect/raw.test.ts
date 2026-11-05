import { describe, expect, it } from "vitest";
import greenhouseFixture from "../ats/__fixtures__/greenhouse.json" with { type: "json" };
import leverFixture from "../ats/__fixtures__/lever.json" with { type: "json" };
import recruiteeFixture from "../ats/__fixtures__/recruitee.json" with { type: "json" };
import { withoutDescription } from "./raw.ts";

describe("withoutDescription", () => {
  it("drops the description fields and keeps the rest", () => {
    const job = greenhouseFixture.jobs[0]!;
    const slim = withoutDescription("greenhouse", job) as Record<string, unknown>;
    expect(slim).not.toHaveProperty("content");
    expect(slim).toMatchObject({ id: job.id, title: job.title, absolute_url: job.absolute_url });
  });

  it("drops every section of a Lever posting and Recruitee's translations", () => {
    const lever = withoutDescription("lever", leverFixture[0]) as Record<string, unknown>;
    for (const field of ["description", "descriptionPlain", "lists", "additional", "opening", "descriptionBody"]) {
      expect(lever).not.toHaveProperty(field);
    }
    expect(lever).toHaveProperty("hostedUrl");

    const offer = recruiteeFixture.offers[0]!;
    const slim = withoutDescription("recruitee", offer);
    expect(slim).not.toHaveProperty("translations");
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(offer).length / 2);
  });

  it("leaves anything that isn't a plain object alone", () => {
    expect(withoutDescription("greenhouse", null)).toBeNull();
    expect(withoutDescription("greenhouse", ["x"])).toEqual(["x"]);
  });
});
