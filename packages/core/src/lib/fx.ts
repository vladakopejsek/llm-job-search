/**
 * Exchange rates from the European Central Bank's daily reference feed: free,
 * no key, updated every working day around 16:00 CET. Rates are units of a
 * currency per 1 EUR.
 */
import { fetchText } from "./http.ts";

export interface Rates {
  /** Units per 1 EUR; EUR itself is 1. */
  perEur: Record<string, number>;
  date: string;
  /** True when the feed couldn't be read and the fallback rates below were used. */
  approximate: boolean;
}

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** Used only when the ECB feed can't be reached; close enough for a pay target, and flagged as approximate. */
const FALLBACK_RATES: Rates = {
  perEur: { EUR: 1, USD: 1.14, GBP: 0.86, CZK: 24.3, PLN: 4.37, CHF: 0.94, SEK: 11, DKK: 7.46, NOK: 11.5, HUF: 390, RON: 5, CAD: 1.57 },
  date: "fallback",
  approximate: true,
};

export function parseEcbRates(xml: string): Rates {
  const perEur: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) perEur[m[1]!] = Number(m[2]);
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1] ?? "unknown";
  if (Object.keys(perEur).length < 5) throw new Error("ECB feed had no rates");
  return { perEur, date, approximate: false };
}

let cached: { rates: Rates; at: number } | null = null;
const TTL_MS = 12 * 60 * 60 * 1000;

/** Today's rates, fetched at most twice a day per process. Never throws: falls back to FALLBACK_RATES. */
export async function eurRates(): Promise<Rates> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rates;
  try {
    const { body } = await fetchText(ECB_URL, "application/xml");
    cached = { rates: parseEcbRates(body), at: Date.now() };
  } catch {
    cached = { rates: FALLBACK_RATES, at: Date.now() - TTL_MS + 10 * 60 * 1000 }; // retry in 10 minutes
  }
  return cached.rates;
}

export function convert(amount: number, from: string, to: string, rates: Rates) {
  const a = rates.perEur[from];
  const b = rates.perEur[to];
  if (a === undefined || b === undefined) return null;
  return (amount / a) * b;
}
