/** "Sep": en-GB now abbreviates it "Sept", which is wider than every other month. */
const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });

/** "29 Sep" */
export const formatDate = (iso: string | null | undefined) => (iso ? `${new Date(iso).getDate()} ${month(new Date(iso))}` : "?");
export const daysSince = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
/** Today as YYYY-MM-DD in local time (toISOString would be UTC). */
export const todayIso = () => new Date().toLocaleDateString("sv-SE");
export const percent = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
/** "07:12" */
export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
/** "Tue 29 Sep" */
export const formatDay = (date: Date = new Date()) => `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${date.getDate()} ${month(date)}`;
/** "Thu 1 Oct · 14:00" */
export const formatWhen = (iso: string) => `${formatDay(new Date(iso))} · ${formatTime(iso)}`;
/** Whole days from one YYYY-MM-DD to another. */
export const daysBetweenIso = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
