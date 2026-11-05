import { and, desc, eq, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import { evaluations, postingSnapshots, postings, reevaluationRequests } from "../db/schema.ts";
import { EvaluationSubmission } from "./facts.ts";
import { decide, type Verdict } from "./rules.ts";
import { type QuoteWarning, verifyFacts } from "./verify.ts";

type SubmitOutcome =
  | { postingId: number; status: "stored"; verdict: Verdict; reasons: string[]; warnings: QuoteWarning[] }
  | { postingId: number; status: "error"; error: string };

export interface SubmitReport {
  /** Problems with the file itself; nothing was stored. */
  schemaErrors: string[];
  outcomes: SubmitOutcome[];
}

/** Zod issues as short "path: message" lines the agent can act on. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/**
 * What an evaluation is for. A posting the screen rejected is evaluated to
 * audit the rules, unless the candidate asked for it to be evaluated again:
 * then it is a real candidate, and a lead reaches the queue.
 */
export function reevalPurpose(screen: "pass" | "reject" | null, requested: boolean): "queue" | "audit" {
  return screen === "reject" && !requested ? "audit" : "queue";
}

/**
 * Whether this result answers a re-evaluation request: one still pending, or
 * one an earlier submission of the same snapshot already resolved (a corrected
 * resubmission must stay a queue evaluation).
 */
async function reevalRequest(db: Db, postingId: number, snapshotId: number) {
  const [row] = await db
    .select({ id: reevaluationRequests.id, status: reevaluationRequests.status })
    .from(reevaluationRequests)
    .leftJoin(evaluations, eq(evaluations.id, reevaluationRequests.resolvedEvaluationId))
    .where(
      and(
        eq(reevaluationRequests.postingId, postingId),
        or(eq(reevaluationRequests.status, "pending"), and(eq(reevaluationRequests.status, "done"), eq(evaluations.snapshotId, snapshotId))),
      ),
    )
    .orderBy(desc(reevaluationRequests.requestedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Store the agent's evaluations. For each result: check the posting and
 * snapshot, verify every quote against that snapshot's text, derive the
 * verdict with the rules, and upsert (one evaluation per snapshot, so a
 * corrected resubmission replaces the earlier one). A pending re-evaluation
 * request for the posting is resolved with the stored evaluation.
 */
export async function submitEvaluations(db: Db, input: unknown, runId: number | null): Promise<SubmitReport> {
  const parsed = EvaluationSubmission.safeParse(input);
  if (!parsed.success) return { schemaErrors: formatIssues(parsed.error), outcomes: [] };

  const outcomes: SubmitOutcome[] = [];
  for (const result of parsed.data.results) {
    const [row] = await db
      .select({
        text: postingSnapshots.descriptionText,
        snapshotPosting: postingSnapshots.postingId,
        screen: postings.screenStatus,
      })
      .from(postingSnapshots)
      .innerJoin(postings, eq(postings.id, postingSnapshots.postingId))
      .where(eq(postingSnapshots.id, result.snapshotId))
      .limit(1);
    if (!row || row.snapshotPosting !== result.postingId) {
      outcomes.push({
        postingId: result.postingId,
        status: "error",
        error: `snapshot ${result.snapshotId} doesn't belong to posting ${result.postingId}`,
      });
      continue;
    }

    const { facts, warnings } = verifyFacts(result.facts, row.text);
    const decision = decide(facts);
    const request = await reevalRequest(db, result.postingId, result.snapshotId);
    const purpose = reevalPurpose(row.screen, request !== null);
    await db.transaction(async (tx) => {
      const [stored] = await tx
        .insert(evaluations)
        .values({
          postingId: result.postingId,
          snapshotId: result.snapshotId,
          runId,
          facts,
          verdict: decision.verdict,
          reasons: decision.reasons,
          fitScore: facts.fit.score,
          evidence: decision.evidence,
          warnings,
          purpose,
        })
        .onConflictDoUpdate({
          target: [evaluations.postingId, evaluations.snapshotId],
          set: {
            runId,
            facts,
            verdict: decision.verdict,
            reasons: decision.reasons,
            fitScore: facts.fit.score,
            evidence: decision.evidence,
            warnings,
            // A re-evaluated audit posting becomes a queue candidate.
            ...(request ? { purpose } : {}),
            createdAt: sql`now()`,
          },
        })
        .returning({ id: evaluations.id });
      if (request?.status === "pending") {
        await tx
          .update(reevaluationRequests)
          .set({ status: "done", resolvedEvaluationId: stored!.id, resolvedRunId: runId, resolvedAt: sql`now()` })
          .where(eq(reevaluationRequests.id, request.id));
      }
    });
    outcomes.push({ postingId: result.postingId, status: "stored", verdict: decision.verdict, reasons: decision.reasons, warnings });
  }
  return { schemaErrors: [], outcomes };
}
