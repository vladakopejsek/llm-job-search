/** When "Later" brings a lead back. Pure and bundled by the app, so both sides offer the same dates. */
import { addDays, weekday } from "../lib/dates.ts";

export function snoozePresets(today: string) {
  // Next Monday is never today: on a Monday it's a week away.
  const toMonday = (8 - weekday(today)) % 7 || 7;
  return [
    { label: "3 days", until: addDays(today, 3) },
    { label: "1 week", until: addDays(today, 7) },
    { label: "Next Monday", until: addDays(today, toMonday) },
  ];
}
