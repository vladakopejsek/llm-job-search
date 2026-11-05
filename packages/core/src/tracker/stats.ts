/**
 * The tracker's numbers, computed from the event log. Pure: the queries load
 * applications and events (queries.ts `statsInput`), this turns them into
 * tiles, a funnel, weekly activity and breakdowns, so every rule is testable.
 *
 * Imported applications got their history rebuilt by the backfill, with guessed dates marked `inferred`: counted, and reported as guesses.
 */
import { CHANNEL_LABELS, type Channel, GHOST_AFTER_DAYS, isPreApply, PROGRESS, RESPONSE_STAGES, type Stage } from "../applications/constants.ts";
import { addDays, daysBetween, weekday } from "../lib/dates.ts";
import type { StatsRange } from "./filters.ts";

export interface StatsApp {
  id: number;
  company: string;
  role: string | null;
  stage: Stage;
  origin: string;
  channel: string | null;
  /** The column, which Undo clears and a re-apply sets again; the applied event's date only when it's empty (old imports). */
  appliedOn: string | null;
  ats: string | null;
  companySource: string | null;
  /** From the linked posting's latest evaluation; null when there is none. */
  fitScore: number | null;
  remoteScope: string | null;
  eligibility: string | null;
  hasSubmission: boolean;
  /** Only meaningful with a submission. */
  coverLetterSent: boolean;
}

export interface StatsEvent {
  id: number;
  applicationId: number;
  type: string;
  toStage: Stage | null;
  /** YYYY-MM-DD */
  occurredOn: string;
  inferred: boolean;
}

export interface StatsInput {
  apps: StatsApp[];
  events: StatsEvent[];
  /** YYYY-MM-DD */
  today: string;
  range: StatsRange;
}

export interface BreakdownRow {
  key: string;
  label: string;
  n: number;
  responded: number;
  /** null when n is 0. */
  rate: number | null;
}

type BreakdownKey = "ats" | "companySource" | "fitBucket" | "remoteScope" | "eligibility" | "coverLetter" | "channel";

// ---------- dates ----------

/** The Monday of the ISO week `iso` falls in. */
export function isoWeekStart(iso: string) {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** First day the range covers, or null for "all". */
function rangeStart(range: StatsRange, today: string) {
  if (range === "all") return null;
  return addDays(today, -(range === "30d" ? 30 : 90) + 1);
}

// ---------- per application ----------

const isResponseStage = (s: Stage | null) => s !== null && (RESPONSE_STAGES as readonly Stage[]).includes(s);
const progressIndex = (s: Stage | null) => (s === null ? -1 : (PROGRESS as readonly Stage[]).indexOf(s));

interface Derived<A = StatsApp> {
  app: A;
  applied: string;
  appliedInferred: boolean;
  responded: boolean;
  /** Date of the first reply, when one is dated (and not a guess we ignore). */
  replyOn: string | null;
  replyInferred: boolean;
  /** Furthest PROGRESS index reached (0 = applied). */
  reached: number;
}

function derive<A extends Pick<StatsApp, "stage" | "appliedOn">>(app: A, events: StatsEvent[]): Derived<A> | null {
  const sorted = [...events].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id - b.id);
  const appliedEvent = sorted.find((e) => e.type === "stage_changed" && e.toStage === "applied");
  // The column, not the first applied event: an applied event later undone stays in the log.
  const applied = app.appliedOn ?? appliedEvent?.occurredOn;
  if (!applied) return null;
  const reply = sorted.find(
    (e) => e.occurredOn >= applied && (e.type === "email_reply" || (e.type === "stage_changed" && isResponseStage(e.toStage))),
  );
  const reached = Math.max(0, progressIndex(app.stage), ...sorted.filter((e) => e.type === "stage_changed").map((e) => progressIndex(e.toStage)));
  return {
    app,
    applied,
    appliedInferred: appliedEvent?.inferred ?? false,
    // A reply event, or a stage the company must have replied to put it in.
    responded: !!reply || isResponseStage(app.stage) || reached > 0,
    replyOn: reply?.occurredOn ?? null,
    replyInferred: reply?.inferred ?? false,
    reached,
  };
}

/** How far an application got and whether the company answered: the rules the stats count by, for one application. */
export function progressOf(app: Pick<StatsApp, "stage" | "appliedOn">, events: StatsEvent[]) {
  const d = derive(app, events);
  return { reached: d?.reached ?? Math.max(0, progressIndex(app.stage)), responded: d?.responded ?? isResponseStage(app.stage) };
}

// ---------- breakdowns ----------

const ATS_LABELS: Record<string, string> = {
  ashby: "Ashby",
  greenhouse: "Greenhouse",
  lever: "Lever",
  workable: "Workable",
  recruitee: "Recruitee",
  teamtailor: "Teamtailor",
  personio: "Personio",
  smartrecruiters: "SmartRecruiters",
  startupjobs: "StartupJobs",
  workday: "Workday",
  bamboohr: "BambooHR",
  other: "Other board",
  none: "No board",
};
const SOURCE_LABELS: Record<string, string> = { import: "Notion import", discovery: "Discovery", manual: "Added by hand" };
const REMOTE_LABELS: Record<string, string> = {
  worldwide: "Worldwide",
  europe: "Europe",
  specific_countries: "Named countries",
  us_only: "US only",
  americas: "Americas",
  onsite_or_hybrid: "Onsite or hybrid",
  unknown: "Unclear",
};
const ELIGIBILITY_LABELS: Record<string, string> = { named: "Named", implied: "Implied", excluded: "Excluded", unknown: "Unclear" };
const UNKNOWN = "unknown";
/** Evaluation facts missing because there's no evaluated posting, not because the posting was unclear. */
const UNKNOWN_EVAL = "no_evaluation";

export function fitBucket(score: number | null) {
  if (score === null) return UNKNOWN;
  return score <= 5 ? "le5" : score <= 7 ? "6to7" : "8plus";
}

interface BreakdownSpec {
  key: (a: StatsApp) => string;
  label: (key: string) => string;
  /** Fixed row order (rows shown even when empty); otherwise by n, unknown last. */
  order?: string[];
}

const BREAKDOWNS: Record<BreakdownKey, BreakdownSpec> = {
  ats: { key: (a) => a.ats ?? UNKNOWN, label: (k) => ATS_LABELS[k] ?? "No company link" },
  companySource: { key: (a) => a.companySource ?? UNKNOWN, label: (k) => SOURCE_LABELS[k] ?? "Not recorded" },
  fitBucket: {
    key: (a) => fitBucket(a.fitScore),
    label: (k) => ({ "8plus": "8+", "6to7": "6–7", le5: "≤ 5" })[k] ?? "No fit score",
    order: ["8plus", "6to7", "le5", UNKNOWN],
  },
  remoteScope: { key: (a) => a.remoteScope ?? UNKNOWN_EVAL, label: (k) => REMOTE_LABELS[k] ?? "No evaluation" },
  eligibility: { key: (a) => a.eligibility ?? UNKNOWN_EVAL, label: (k) => ELIGIBILITY_LABELS[k] ?? "No evaluation" },
  coverLetter: {
    key: (a) => (!a.hasSubmission ? "not_logged" : a.coverLetterSent ? "sent" : "not_sent"),
    label: (k) => ({ sent: "Sent", not_sent: "Not sent" })[k] ?? "Not logged",
    order: ["sent", "not_sent", "not_logged"],
  },
  channel: { key: (a) => a.channel ?? UNKNOWN, label: (k) => CHANNEL_LABELS[k as Channel] ?? "Not recorded" },
};

function breakdown(rows: Derived[], spec: BreakdownSpec): BreakdownRow[] {
  const groups = new Map<string, { n: number; responded: number }>();
  for (const k of spec.order ?? []) groups.set(k, { n: 0, responded: 0 });
  for (const d of rows) {
    const k = spec.key(d.app);
    const g = groups.get(k) ?? { n: 0, responded: 0 };
    g.n++;
    if (d.responded) g.responded++;
    groups.set(k, g);
  }
  const out = [...groups].map(([key, g]) => ({ key, label: spec.label(key), ...g, rate: g.n ? g.responded / g.n : null }));
  if (spec.order) return out;
  const last = (k: string) => (k === UNKNOWN || k === UNKNOWN_EVAL ? 1 : 0);
  return out.sort((a, b) => last(a.key) - last(b.key) || b.n - a.n || a.label.localeCompare(b.label));
}

// ---------- the whole thing ----------

const FUNNEL_STEPS = ["applied", "replied", "screening", "interviewing", "offer"] as const;

export function computeTrackerStats({ apps, events, today, range }: StatsInput) {
  const tracked = apps.filter((a) => !isPreApply(a.stage));
  const trackedIds = new Set(tracked.map((a) => a.id));
  const relevant = events.filter((e) => trackedIds.has(e.applicationId));
  const inferredEvents = relevant.filter((e) => e.inferred).length;

  const byApp = new Map<number, StatsEvent[]>();
  for (const e of relevant) byApp.set(e.applicationId, [...(byApp.get(e.applicationId) ?? []), e]);

  // Every tracked application with an applied date.
  let undated = 0;
  const all: Derived[] = [];
  for (const app of tracked) {
    const d = derive(app, byApp.get(app.id) ?? []);
    if (d) all.push(d);
    else undated++;
  }

  const start = rangeStart(range, today);
  const inRange = start ? all.filter((d) => d.applied >= start && d.applied <= today) : all;
  const weekStart = isoWeekStart(today);

  // Tiles
  const responded = inRange.filter((d) => d.responded);
  const dated = inRange.filter((d) => d.replyOn);
  const replyDays = dated.map((d) => daysBetween(d.applied, d.replyOn!));
  const count = (stage: Stage) => all.filter((d) => d.app.stage === stage).length;
  const ghosted = all.filter(
    (d) => (d.app.stage === "applied" || d.app.stage === "no_response") && !d.responded && daysBetween(d.applied, today) >= GHOST_AFTER_DAYS,
  );

  const tiles = {
    applications: {
      n: inRange.length,
      thisWeek: inRange.filter((d) => d.applied >= weekStart).length,
      viaQueue: inRange.filter((d) => d.app.origin === "queue").length,
    },
    responseRate: {
      rate: inRange.length ? responded.length / inRange.length : null,
      responded: responded.length,
      n: inRange.length,
      rejections: responded.filter((d) => d.app.stage === "rejected").length,
    },
    medianDaysToFirstReply: {
      days: median(replyDays),
      n: dated.length,
      inferred: dated.filter((d) => d.replyInferred).length,
    },
    /** Where things stand now, whatever the range. */
    activePipeline: {
      n: count("screening") + count("interviewing") + count("offer"),
      screening: count("screening"),
      interviewing: count("interviewing"),
      offer: count("offer"),
    },
    /** Now, whatever the range: no reply GHOST_AFTER_DAYS or more after applying. */
    ghosted: { n: ghosted.length, inferred: ghosted.filter((d) => d.appliedInferred).length, afterDays: GHOST_AFTER_DAYS },
  };

  // Funnel: how far each application got. Replied comes between applied and screening.
  const reachedCounts = [
    inRange.length,
    responded.length,
    inRange.filter((d) => d.reached >= 1).length,
    inRange.filter((d) => d.reached >= 2).length,
    inRange.filter((d) => d.reached >= 3).length,
  ];
  const funnel = {
    steps: FUNNEL_STEPS.map((step, i) => ({
      step,
      n: reachedCounts[i]!,
      /** Share of the previous step that got here; null for the first step or an empty base. */
      conversion: i === 0 || !reachedCounts[i - 1] ? null : reachedCounts[i]! / reachedCounts[i - 1]!,
    })),
    outcomes: {
      rejected: inRange.filter((d) => d.app.stage === "rejected").length,
      noResponse: inRange.filter((d) => d.app.stage === "no_response").length,
      waiting: inRange.filter((d) => d.app.stage === "applied").length,
    },
  };

  // Rejections, by how far the application got first: "after the screen" is a
  // different signal from "at the CV".
  const rejected = inRange.filter((d) => d.app.stage === "rejected");
  const rejections = {
    n: rejected.length,
    /** At which stage: applied means "at the application", before any conversation. */
    byStage: PROGRESS.map((stage, i) => ({ stage, n: rejected.filter((d) => d.reached === i).length })),
  };

  // Weekly: applications by applied week, responses by reply week, Monday to Monday.
  const firstWeek = isoWeekStart(start ?? (all.length ? all.reduce((m, d) => (d.applied < m ? d.applied : m), today) : today));
  const weeks: { weekStart: string; applied: number; responses: number }[] = [];
  for (let w = firstWeek; w <= weekStart; w = addDays(w, 7)) weeks.push({ weekStart: w, applied: 0, responses: 0 });
  const week = (iso: string) => weeks[Math.floor(daysBetween(firstWeek, iso) / 7)];
  for (const d of inRange) {
    const w = week(d.applied);
    if (w) w.applied++;
  }
  // Responses are counted in the week they arrived, for every application, so a
  // reply this week to an old application still shows as activity this week.
  for (const d of all) {
    if (!d.replyOn || d.replyOn < firstWeek || d.replyOn > today) continue;
    const w = week(d.replyOn);
    if (w) w.responses++;
  }
  const firstRecord = all.length ? all.reduce((m, d) => (d.applied < m ? d.applied : m), all[0]!.applied) : null;

  const breakdowns = Object.fromEntries((Object.keys(BREAKDOWNS) as BreakdownKey[]).map((k) => [k, breakdown(inRange, BREAKDOWNS[k])])) as Record<
    BreakdownKey,
    BreakdownRow[]
  >;

  return {
    today,
    range,
    rangeStart: start,
    tiles,
    funnel,
    rejections,
    weekly: { weeks, firstRecord, currentWeek: weekStart },
    breakdowns,
    inferred: {
      /** Events in the log whose date was guessed. */
      events: inferredEvents,
      /** Applications in range whose applied date was guessed. */
      appliedDates: inRange.filter((d) => d.appliedInferred).length,
      /** Imported applications in range: the rows whose dates may be guesses. */
      imported: inRange.filter((d) => d.app.origin === "import").length,
    },
    /** Applications with no applied date at all, left out of everything. */
    undated,
  };
}
