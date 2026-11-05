/**
 * Calendar dates (YYYY-MM-DD) in the machine's local time zone. toISOString()
 * is UTC, so east of Greenwich anything done just after midnight would be
 * dated the day before.
 */
export function localDate(date = new Date()): string {
  return date.toLocaleDateString("sv-SE"); // the sv-SE locale formats as YYYY-MM-DD
}

export function localDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDate(d);
}

// Arithmetic on YYYY-MM-DD dates, done at UTC midnight so a daylight-saving change can't shift a day.
const DAY = 864e5;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export const addDays = (iso: string, days: number) => new Date(toMs(iso) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (iso: string) => new Date(toMs(iso)).getUTCDay();
