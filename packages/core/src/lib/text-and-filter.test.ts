import { describe, expect, it } from "vitest";
import { isEngineeringTitle } from "../collect/filter.ts";
import { screenLocation } from "../screen/rules.ts";
import { contentHash, htmlToText, unescapeHtml } from "./text.ts";

describe("text helpers", () => {
  it("unescapes one level of HTML, leaving real entities for htmlToText", () => {
    const escaped = "&lt;p&gt;Tom&amp;#39;s &amp;amp; Jerry&amp;nbsp;Ltd&lt;/p&gt;";
    expect(unescapeHtml(escaped)).toBe("<p>Tom&#39;s &amp; Jerry&nbsp;Ltd</p>");
    expect(htmlToText(unescapeHtml(escaped))).toBe("Tom's & Jerry Ltd");
  });

  it("keeps list items and headings readable", () => {
    const text = htmlToText("<h2>What you'll do</h2><ul><li>Build things</li><li>Ship them</li></ul>");
    expect(text).toContain("What you'll do");
    expect(text).toContain("* Build things");
  });

  it("keeps table and definition cells apart, so the location rules can read them", () => {
    const text = htmlToText("<table><tr><th>Eligible locations</th><td>EU, UK</td></tr></table><dl><dt>Team</dt><dd>Platform</dd></dl>");
    expect(text).toBe("Eligible locations\nEU, UK\n\nTeam\nPlatform");
    expect(screenLocation("New York, NY; Remote", null, text)).toEqual({ pass: true });
  });

  it("hashes text ignoring whitespace differences", () => {
    expect(contentHash("Senior  engineer\n\nRemote")).toBe(contentHash("Senior engineer Remote"));
    expect(contentHash("Senior engineer")).not.toBe(contentHash("Staff engineer"));
  });
});

describe("isEngineeringTitle", () => {
  it.each([
    "Senior Software Engineer",
    "Staff Frontend Engineer",
    "Full-stack Developer",
    "Fullstack Engineer (TypeScript)",
    "Product Engineer",
    "Engineering Manager",
    "Senior Programmer",
    "Front End Lead",
    "Desenvolvedora Frontend",
    "Programador Sénior",
    "Cofundador técnico – Node.js & JavaScript Builder",
    "Tech Lead, Payments",
    "Technical Lead - Platform",
    "Technical Leader",
    "Tech-Lead",
    "Member of Technical Staff",
    "Dev Team Lead",
    "Product Builder",
  ])("keeps %s", (title) => expect(isEngineeringTitle(title)).toBe(true));

  it.each([
    "Accountant",
    "Account Executive",
    "Product Designer",
    "Head of Marketing",
    "Data Scientist",
    "Gestor de Desenvolvimento de Negócio",
    "Sales Team Lead",
    "Community Builder",
  ])("drops %s", (title) => expect(isEngineeringTitle(title)).toBe(false));
});
