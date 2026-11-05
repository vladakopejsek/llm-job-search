/**
 * What pay to ask for, computed by code from the candidate's targets
 * (data/pay.md) and what the posting says. The model never picks the number:
 * a pay ask is a lever that sets the level of the whole process, so it follows
 * fixed rules the candidate wrote down:
 *
 * - A published band: ask in its top third, and never below your own target
 *   (capped at the band's top). A band below your floor is flagged.
 * - No band: your target to stretch range, in the currency relevant to the job.
 * - A contract role: a day rate instead of a yearly salary.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ApplicationForm } from "../ats/forms.ts";
import { convert, eurRates, type Rates } from "../lib/fx.ts";
import { namesHome } from "../screen/rules.ts";
import { searchConfig } from "../search-config.ts";
import type { Facts } from "./facts.ts";

export type Period = "year" | "month" | "day" | "hour";

interface Amount {
  amount: number;
  currency: string;
  period: Period;
}

export interface PayConfig {
  employment: { floor: Amount; target: Amount; stretch: Amount };
  contract: { floor: Amount; target: Amount; stretch: Amount };
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const payConfigPath = () => path.resolve(REPO_ROOT, process.env.PAY_PATH ?? "data/pay.md");

/**
 * Lines like `- employment.target: 75,000 EUR / year`. Missing contract
 * floor/stretch default to the contract target; a missing employment floor or
 * stretch defaults to the employment target.
 */
export function parsePayConfig(markdown: string): PayConfig {
  const found = new Map<string, Amount>();
  for (const m of markdown.matchAll(
    /^\s*-\s*(employment|contract)\.(floor|target|stretch)\s*:\s*([\d][\d\s.,]*)\s*([A-Z]{3})\s*\/\s*(year|month|day|hour)\b/gim,
  )) {
    const amount = Number(m[3]!.replace(/[\s,]/g, ""));
    // "1.800.000" would be NaN: dots aren't stripped, since "1.500" could mean either.
    if (!Number.isFinite(amount)) throw new Error(`pay config: can't read the amount in "${m[0].trim()}" (write it like 75,000)`);
    found.set(`${m[1]!.toLowerCase()}.${m[2]!.toLowerCase()}`, { amount, currency: m[4]!.toUpperCase(), period: m[5]!.toLowerCase() as Period });
  }
  const need = (k: string) => {
    const v = found.get(k);
    if (!v) throw new Error(`pay config: "${k}" is missing (expected a line like "- ${k}: 75,000 EUR / year")`);
    return v;
  };
  const employmentTarget = need("employment.target");
  const contractTarget = need("contract.target");
  return {
    employment: {
      floor: found.get("employment.floor") ?? employmentTarget,
      target: employmentTarget,
      stretch: found.get("employment.stretch") ?? employmentTarget,
    },
    contract: {
      floor: found.get("contract.floor") ?? contractTarget,
      target: contractTarget,
      stretch: found.get("contract.stretch") ?? contractTarget,
    },
  };
}

/** The candidate's targets, or null when data/pay.md doesn't exist (then no pay target is shown). */
async function loadPayConfig(file = payConfigPath()): Promise<PayConfig | null> {
  try {
    return parsePayConfig(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------

const SYMBOLS: [RegExp, string][] = [
  [/^(€|eur|euros?)$/i, "EUR"],
  [/^(\$|usd|us\$|dollars?)$/i, "USD"],
  [/^(£|gbp|pounds?)$/i, "GBP"],
  [/^(kč|czk)$/i, "CZK"],
  [/^(zł|pln)$/i, "PLN"],
  [/^(chf|fr\.?)$/i, "CHF"],
];
function normalizeCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  for (const [re, code] of SYMBOLS) if (re.test(s)) return code;
  return /^[A-Z]{3}$/i.test(s) ? s.toUpperCase() : null;
}

/**
 * Places whose jobs are paid in something other than EUR. Anything else in
 * Europe, or remote, is EUR. Home places (the search config's) are paid in its
 * currency, so the screen and pay agree on what is home.
 */
const LOCAL_CURRENCY: [RegExp, string][] = [
  [/\b(united kingdom|uk|england|scotland|wales|london|manchester|edinburgh)\b/i, "GBP"],
  [/\b(switzerland|zurich|zürich|geneva|basel|lausanne)\b/i, "CHF"],
  [/\b(poland|warsaw|krakow|kraków|wroclaw|wrocław|gdansk|gdańsk|poznan)\b/i, "PLN"],
  [/\b(united states|usa|us|u\.s\.|america|americas|new york|san francisco|seattle|austin|boston|chicago|canada|toronto|vancouver)\b/i, "USD"],
];

/**
 * The currency to talk pay in: the band's, if the posting states one;
 * otherwise the local currency when every place the job names shares one
 * (a home office → the home currency, "London" → GBP); otherwise EUR.
 */
export function currencyFor(facts: Pick<Facts, "pay" | "remote" | "office">, locationRaw: string | null): string {
  const stated = normalizeCurrency(facts.pay.currency);
  if (stated) return stated;
  const places = [...(locationRaw ?? "").split(/[;|/]| - |,(?=\s*[A-Z])/), facts.office.location ?? "", ...facts.remote.regions]
    .map((p) => p.trim())
    .filter((p) => p && !/^(remote|anywhere|hybrid|on-?site|worldwide|global)$/i.test(p));
  const currencies = new Set(
    places.map((p) => (namesHome(p) ? searchConfig().home.currency : (LOCAL_CURRENCY.find(([re]) => re.test(p))?.[1] ?? "EUR"))),
  );
  if (facts.remote.scope === "us_only" || facts.remote.scope === "americas") return "USD";
  return currencies.size === 1 ? [...currencies][0]! : "EUR";
}

/** A salary question's own terms: "(In USD monthly)", "in Euros per month", "expected yearly salary". */
export function askedTerms(question: string): { currency: string | null; period: Period | null } {
  const currency = /\b(usd|dollars?)\b|\$/i.test(question)
    ? "USD"
    : /\b(eur|euros?)\b|€/i.test(question)
      ? "EUR"
      : /\b(gbp|pounds?)\b|£/i.test(question)
        ? "GBP"
        : /\b(czk|crowns?)\b|kč/i.test(question) // "č" isn't a word character, so \b can't follow it
          ? "CZK"
          : /\b(pln|złoty|zloty)\b/i.test(question)
            ? "PLN"
            : /\bchf\b/i.test(question)
              ? "CHF"
              : null;
  const period = /\b(month|monthly)\b/i.test(question)
    ? "month"
    : /\b(year|yearly|annual|annually|per annum)\b/i.test(question)
      ? "year"
      : /\b(day|daily|day rate)\b/i.test(question)
        ? "day"
        : /\b(hour|hourly)\b/i.test(question)
          ? "hour"
          : null;
  return { currency, period };
}

// Working time used to move between periods: 12 months, ~220 billable days, 8-hour days.
const PER_YEAR: Record<Period, number> = { year: 1, month: 12, day: 220, hour: 1760 };
const toPeriod = (amount: number, from: Period, to: Period) => (amount * PER_YEAR[from]) / PER_YEAR[to];

function roundNice(amount: number, currency: string, period: Period, mode: "round" | "floor" = "round") {
  const big = currency === "CZK" || currency === "HUF";
  const step =
    period === "year"
      ? big
        ? 50_000
        : currency === "PLN"
          ? 10_000
          : 5_000
      : period === "month"
        ? big
          ? 5_000
          : 500
        : period === "day"
          ? big
            ? 500
            : 10
          : big
            ? 50
            : 5;
  return Math[mode](amount / step) * step;
}

export interface PayTarget {
  basis: "salary" | "contract";
  currency: string;
  period: Period;
  /** Ask at least this… */
  low: number;
  /** …up to this (null: a single number). */
  high: number | null;
  /** e.g. "EUR 95,000–110,000 gross / year" */
  text: string;
  /** Why this number: the rule applied, the band, the conversion. */
  notes: string[];
  warning: string | null;
  ratesDate: string;
  approximateRates: boolean;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The pay to ask for in one posting. `askedIn` is the form's salary question,
 * if it names a currency or period ("in USD monthly"), which overrides both.
 */
export function payTargetFor(
  facts: Pick<Facts, "pay" | "remote" | "office" | "contract">,
  locationRaw: string | null,
  config: PayConfig,
  rates: Rates,
  askedIn?: string | null,
): PayTarget | null {
  const band = facts.pay.min !== null || facts.pay.max !== null ? facts.pay : null;
  const contract = facts.pay.basis === "contract_rate" || (!band && facts.contract.b2bMentioned && !facts.contract.eorMentioned);
  const mine = contract ? config.contract : config.employment;
  const basePeriod: Period = contract ? "day" : "year";

  const asked = askedIn ? askedTerms(askedIn) : { currency: null, period: null };
  const currency = asked.currency ?? currencyFor(facts, locationRaw);
  const inCurrency = (a: Amount) => {
    const converted = convert(a.amount, a.currency, currency, rates);
    return converted === null ? null : toPeriod(converted, a.period, basePeriod);
  };
  const floor = inCurrency(mine.floor);
  const target = inCurrency(mine.target);
  const stretch = inCurrency(mine.stretch);
  if (floor === null || target === null || stretch === null) return null;

  const notes: string[] = [];
  let warning: string | null = null;
  let low: number;
  let high: number | null;
  let bandTop: number | null = null;

  const bandCurrency = normalizeCurrency(facts.pay.currency);
  if (band && bandCurrency) {
    const bandPeriod = (facts.pay.period ?? basePeriod) as Period;
    const conv = (n: number) => {
      const c = convert(n, bandCurrency, currency, rates);
      return c === null ? null : toPeriod(c, bandPeriod, basePeriod);
    };
    const min = conv(band.min ?? band.max!);
    const max = conv(band.max ?? band.min!);
    if (min === null || max === null) return null;
    bandTop = max;
    notes.push(
      `Their band: ${bandCurrency} ${fmt(band.min ?? band.max!)}${band.min !== null && band.max !== null && band.max !== band.min ? `–${fmt(band.max)}` : ""} / ${bandPeriod}.`,
    );
    if (max === min) {
      low = Math.max(max, target);
      high = null;
      notes.push(
        max >= target
          ? "A single figure at or above your target: ask for it."
          : "Their figure is below your target: ask for your target and see how they respond.",
      );
    } else {
      const topThird = min + ((max - min) * 2) / 3;
      low = Math.min(Math.max(topThird, target), max);
      high = max;
      notes.push(
        target > max
          ? "Your target is above their band: ask for the top of it."
          : target > topThird
            ? "Your target is inside their band, above its top third."
            : "Never below the top third of a published band.",
      );
    }
    if (max < floor) warning = `Their band tops out below your floor (${currency} ${fmt(roundNice(floor, currency, basePeriod))} / ${basePeriod}).`;
  } else {
    low = target;
    high = stretch > target ? stretch : null;
    notes.push(
      contract ? "No rate stated; contract role: your day rate." : "No pay stated: your target, up to your stretch for a high-paying company.",
    );
  }

  // Present it in the period the form asks for, if it asks.
  const period = asked.period ?? basePeriod;
  // Rounding never goes past the top of a published band.
  const show = (n: number) => roundNice(toPeriod(n, basePeriod, period), currency, period, bandTop !== null && n >= bandTop ? "floor" : "round");
  const highShown = high !== null ? show(high) : null;
  const lowShown = Math.min(show(low), highShown ?? Infinity);
  const range = highShown !== null && highShown > lowShown ? `${fmt(lowShown)}–${fmt(highShown)}` : fmt(lowShown);
  const text = `${currency} ${range} ${contract ? "" : "gross "}/ ${period}`;

  if (currency !== mine.target.currency) {
    notes.push(
      `Converted from your ${mine.target.currency} targets at the ECB rate of ${rates.date}${rates.approximate ? " (approximate: the feed was unreachable)" : ""}.`,
    );
  }
  notes.push(
    contract
      ? "Confirm the engagement model (B2B or EOR) before naming a number."
      : "Ask whether a figure is gross to you or their total cost: they differ by about a third.",
  );

  return {
    basis: contract ? "contract" : "salary",
    currency,
    period,
    low: lowShown,
    high: highShown,
    text,
    notes,
    warning,
    ratesDate: rates.date,
    approximateRates: rates.approximate,
  };
}

/** The candidate's targets and today's rates, or null when there's no data/pay.md. */
export async function payContext() {
  const config = await loadPayConfig();
  return config ? { config, rates: await eurRates() } : null;
}
export type PayContext = Awaited<ReturnType<typeof payContext>>;

const SALARY_QUESTION = /\b(salary|compensation|pay\b|rate|remuneration)/i;

/** The pay target for a posting, in the terms of its form's salary question when it has one. */
export function payTargetForPosting(
  ctx: PayContext,
  facts: Pick<Facts, "pay" | "remote" | "office" | "contract">,
  locationRaw: string | null,
  form: ApplicationForm | null,
) {
  if (!ctx) return null;
  const salaryQuestion = form?.questions.find((q) => q.kind === "personal" && SALARY_QUESTION.test(q.question))?.question ?? null;
  return payTargetFor(facts, locationRaw, ctx.config, ctx.rates, salaryQuestion);
}
