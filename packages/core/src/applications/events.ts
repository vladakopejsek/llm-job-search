import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { applicationEvents, applications } from "../db/schema.ts";
import { CLOSED_STAGES, type EventSource, type Stage } from "./constants.ts";

/** A database handle or an open transaction: both run the same queries. */
export type Queryable = Pick<Db, "select" | "selectDistinct" | "insert" | "update" | "delete" | "execute">;
type NewEvent = typeof applicationEvents.$inferInsert;

export async function recordEvent(q: Queryable, e: NewEvent) {
  await q.insert(applicationEvents).values(e);
}

/**
 * Move an application to another stage and log it. Every stage change goes
 * through here, so `application_events` is a complete history and the tracker's
 * stats can be computed from it. `set` carries the columns that change with the
 * stage (dates, outcome). Returns false when the stage was already `to`.
 */
export async function transition(
  q: Queryable,
  app: { id: number; stage: Stage },
  to: Stage,
  opts: {
    on: string;
    source: EventSource;
    payload?: Record<string, unknown>;
    proposalId?: number;
    set?: Partial<typeof applications.$inferInsert>;
  },
) {
  if (app.stage === to) return false;
  const closes = (CLOSED_STAGES as readonly Stage[]).includes(to);
  await q
    .update(applications)
    .set({ ...opts.set, ...(closes ? { nextStepAt: null, nextStepKind: null, nextStepWith: null } : {}), stage: to, updatedAt: sql`now()` })
    .where(eq(applications.id, app.id));
  await recordEvent(q, {
    applicationId: app.id,
    type: "stage_changed",
    fromStage: app.stage,
    toStage: to,
    occurredOn: opts.on,
    payload: opts.payload ?? {},
    source: opts.source,
    proposalId: opts.proposalId,
  });
  return true;
}
