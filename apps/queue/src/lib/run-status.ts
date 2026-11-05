/** The last daily run in one line, for the logo's dot and Today's header. */
import { formatDate, formatTime, todayIso } from "./format.ts";
import type { Overview } from "./queries.ts";

export function lastRun(status: Overview["status"]) {
  const run = status.agentRun;
  if (!run) return { tone: "muted", label: "No daily run yet" } as const;
  if (!run.finishedAt) return { tone: "live", label: `Run in progress since ${formatTime(run.startedAt)}` } as const;

  const finishedToday = new Date(run.finishedAt).toLocaleDateString("sv-SE") === todayIso();
  const evaluated = Object.values(run.stats?.evaluated ?? {}).reduce((sum, n) => sum + n, 0);
  const leads = run.stats?.evaluated["queue:lead"] ?? 0;
  const failing = run.stats?.collectErrors.length ?? 0;
  const label = [
    `Run finished ${finishedToday ? formatTime(run.finishedAt) : formatDate(run.finishedAt)}`,
    `${evaluated} evaluated`,
    `${leads} ${leads === 1 ? "lead" : "leads"}`,
    failing ? `${failing} feeds failing` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tone = failing ? "warning" : finishedToday ? "live" : "muted";
  return { tone, label } as const;
}
