import { describe, expect, it } from "vitest";
import { parseEcbRates } from "../lib/fx.ts";
import type { Facts } from "./facts.ts";
import { askedTerms, currencyFor, parsePayConfig, payTargetFor } from "./pay.ts";

const config = parsePayConfig(`
- employment.floor: 60,000 EUR / year
- employment.target: 75,000 EUR / year
- employment.stretch: 90,000 EUR / year
- contract.target: 450 EUR / day
`);
const rates = parseEcbRates(
  "<Cube time='2026-09-25'><Cube currency='USD' rate='1.1'/><Cube currency='GBP' rate='0.85'/><Cube currency='CZK' rate='25'/><Cube currency='PLN' rate='4.4'/><Cube currency='CHF' rate='0.95'/></Cube>",
);

type PayFacts = Pick<Facts, "pay" | "remote" | "office" | "contract">;
const facts = (over: Partial<Facts["pay"]> = {}, rest: Partial<PayFacts> = {}): PayFacts => ({
  pay: { min: null, max: null, currency: null, period: null, basis: "unknown", quote: null, ...over },
  remote: { scope: "europe", regions: [], quote: null },
  office: { requirement: "none", location: null, quote: null },
  contract: { b2bMentioned: false, eorMentioned: false, quote: null },
  ...rest,
});

describe("pay targets", () => {
  it("reads the config, defaulting contract floor/stretch to the target", () => {
    expect(config.employment.target).toEqual({ amount: 75_000, currency: "EUR", period: "year" });
    expect(config.contract.floor).toEqual(config.contract.target);
    expect(() => parsePayConfig("- employment.target: 1 EUR / year")).toThrow(/contract.target/);
    expect(() => parsePayConfig("- employment.target: 1.250.000 HUF / year")).toThrow(/can't read the amount/);
  });

  it("no band: target to stretch in the job's currency (EUR for remote Europe)", () => {
    const t = payTargetFor(facts(), "Remote - Europe", config, rates)!;
    expect(t).toMatchObject({ currency: "EUR", period: "year", low: 75_000, high: 90_000, basis: "salary" });
    expect(t.text).toBe("EUR 75,000–90,000 gross / year");
  });

  it("a band: never below its top third, and not below your target", () => {
    // €75–110k: top third starts at 98,333 > 75k target.
    expect(
      payTargetFor(facts({ min: 75_000, max: 110_000, currency: "EUR", period: "year", basis: "salary" }), "Warsaw", config, rates),
    ).toMatchObject({
      currency: "EUR",
      low: 100_000,
      high: 110_000,
    });
    // $80–120k: top third 106.7k USD; target 75k EUR = 82.5k USD → top third wins.
    expect(payTargetFor(facts({ min: 80_000, max: 120_000, currency: "USD", period: "year", basis: "salary" }), "Remote", config, rates)!.low).toBe(
      105_000,
    );
  });

  it("rounding never goes past the band's top", () => {
    // PLN 272–408k: target 75k EUR = 330k PLN, so the top third (362.7k); the top (408k) rounds down to 400k, not up to 410k.
    const t = payTargetFor(facts({ min: 272_000, max: 408_000, currency: "PLN", period: "year", basis: "salary" }), "Remote, Poland", config, rates)!;
    expect(t).toMatchObject({ low: 360_000, high: 400_000 });
  });

  it("a band above you: flags nothing; a band below your floor: warns", () => {
    const low = payTargetFor(facts({ min: 40_000, max: 55_000, currency: "EUR", period: "year", basis: "salary" }), "Berlin", config, rates)!;
    expect(low.low).toBe(55_000); // capped at their top
    expect(low.warning).toMatch(/below your floor/);
    expect(low.notes.join(" ")).not.toMatch(/inside their band/);
  });

  it("prints a band with only a top as that one figure", () => {
    const t = payTargetFor(facts({ min: null, max: 80_000, currency: "EUR", period: "year", basis: "salary" }), "Berlin", config, rates)!;
    expect(t.notes[0]).toBe("Their band: EUR 80,000 / year.");
  });

  it("a contract role: a day rate", () => {
    const t = payTargetFor(facts({}, { contract: { b2bMentioned: true, eorMentioned: false, quote: null } }), "Remote", config, rates)!;
    expect(t).toMatchObject({ basis: "contract", currency: "EUR", period: "day", low: 450, high: null });
  });

  it("the form's own terms win: 'salary expectation in USD monthly'", () => {
    const t = payTargetFor(facts(), "Remote - Europe", config, rates, "What is your salary expectation? (In USD monthly)")!;
    // 75,000 EUR * 1.1 = 82,500 USD / 12 = 6,875 → 7,000; stretch 90k*1.1/12 = 8,250 → 8,500.
    expect(t).toMatchObject({ currency: "USD", period: "month", low: 7_000, high: 8_500 });
  });

  it("currency by location when no band is stated", () => {
    const f = facts();
    expect(currencyFor(f, "Porto, PT")).toBe("EUR"); // home: the search config's currency
    expect(currencyFor(f, "Bratislava, Slovakia")).toBe("EUR");
    expect(currencyFor(f, "London, United Kingdom")).toBe("GBP");
    expect(currencyFor(f, "Remote, Poland")).toBe("PLN");
    expect(currencyFor(f, "Zurich")).toBe("CHF");
    expect(currencyFor(f, "Berlin; London")).toBe("EUR");
    expect(currencyFor(f, "Remote")).toBe("EUR");
    expect(currencyFor(facts({}, { remote: { scope: "americas", regions: [], quote: null } }), "Remote")).toBe("USD");
    expect(currencyFor(facts({ currency: "£" }), "Lisbon")).toBe("GBP");
  });

  it("reads a salary question's terms", () => {
    expect(askedTerms("Monthly Salary expectation in Euros per month")).toEqual({ currency: "EUR", period: "month" });
    expect(askedTerms("What is your expected yearly salary for the role?")).toEqual({ currency: null, period: "year" });
    expect(askedTerms("Salary expectation in Kč, monthly").currency).toBe("CZK");
    expect(askedTerms("Expected salary (CHF)").currency).toBe("CHF");
  });
});
