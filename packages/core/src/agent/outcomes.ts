import { and, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { agentAttempts, applications, outcomeProposals } from "../db/schema.ts";
import { formatIssues } from "./submit.ts";

const OPEN_STAGES = ["applied", "screening", "interviewing", "no_response"] as const;

/**
 * Applications that can still receive a reply, and since when to search the mailbox: 3 days back,
 * or further, to a day before the last stored replies submission, when Gmail was out for longer.
 * (Every other run finishes several times a day, so anchoring on any run would never reach back.)
 */
export async function openApplications(db: Db) {
  const [last] = await db
    .select({ at: max(agentAttempts.createdAt) })
    .from(agentAttempts)
    .where(and(eq(agentAttempts.kind, "outcomes"), eq(agentAttempts.status, "stored")));
  const threeDaysAgo = new Date(Date.now() - 3 * 864e5);
  // A day of overlap: proposals are unique per Gmail message, so searching twice is harmless.
  const anchor = last?.at ? new Date(last.at.getTime() - 864e5) : null;
  const since = anchor && anchor < threeDaysAgo ? anchor : threeDaysAgo;

  const rows = await db
    .select({
      applicationId: applications.id,
      company: applications.company,
      role: applications.role,
      stage: applications.stage,
      appliedOn: applications.appliedOn,
      lastContact: applications.lastContact,
    })
    .from(applications)
    .where(inArray(applications.stage, [...OPEN_STAGES]));
  return { since: since.toISOString().slice(0, 10), applications: rows };
}

export const OutcomeSubmission = z
  .object({
    proposals: z.array(
      z
        .object({
          applicationId: z.number().int(),
          proposedStage: z.enum(["screening", "interviewing", "offer", "rejected"]),
          messageId: z.string().min(1).describe("The Gmail message id, so one email never creates two proposals."),
          from: z.string(),
          subject: z.string(),
          date: z.iso.datetime({ offset: true }).describe("When the email was received, as an ISO date-time."),
          snippet: z.string().max(400).describe("The sentence that shows the outcome, verbatim."),
        })
        .strict(),
    ),
  })
  .strict();

/** Store reply proposals; the candidate confirms or dismisses them in the queue. */
export async function submitOutcomes(db: Db, input: unknown, runId: number | null) {
  const parsed = OutcomeSubmission.safeParse(input);
  if (!parsed.success) return { schemaErrors: formatIssues(parsed.error), stored: 0, skipped: [] as string[] };

  let stored = 0;
  const skipped: string[] = [];
  for (const p of parsed.data.proposals) {
    const [app] = await db.select({ stage: applications.stage }).from(applications).where(eq(applications.id, p.applicationId));
    if (!app) {
      skipped.push(`application ${p.applicationId}: not found`);
      continue;
    }
    // A wrong id, or one closed during the run: confirming it would move a lead or a skipped role.
    if (!(OPEN_STAGES as readonly string[]).includes(app.stage)) {
      skipped.push(`application ${p.applicationId}: not open (${app.stage})`);
      continue;
    }
    if (app.stage === p.proposedStage) {
      skipped.push(`application ${p.applicationId}: already ${p.proposedStage}`);
      continue;
    }
    const inserted = await db
      .insert(outcomeProposals)
      .values({
        applicationId: p.applicationId,
        proposedStage: p.proposedStage,
        messageId: p.messageId,
        evidence: { from: p.from, subject: p.subject, date: p.date, snippet: p.snippet },
        runId,
      })
      .onConflictDoNothing()
      .returning({ id: outcomeProposals.id });
    if (inserted.length) stored++;
    else skipped.push(`message ${p.messageId}: already proposed`);
  }
  return { schemaErrors: [] as string[], stored, skipped };
}

/** What a proposal keeps from the email that prompted it (stored as jsonb). */
type ProposalEvidence = Pick<z.infer<typeof OutcomeSubmission>["proposals"][number], "from" | "subject" | "date" | "snippet">;

export async function pendingProposals(db: Db) {
  const rows = await db
    .select({
      id: outcomeProposals.id,
      applicationId: outcomeProposals.applicationId,
      company: applications.company,
      role: applications.role,
      currentStage: applications.stage,
      proposedStage: outcomeProposals.proposedStage,
      evidence: outcomeProposals.evidence,
      createdAt: outcomeProposals.createdAt,
    })
    .from(outcomeProposals)
    .innerJoin(applications, eq(applications.id, outcomeProposals.applicationId))
    .where(and(eq(outcomeProposals.status, "pending")))
    .orderBy(desc(outcomeProposals.createdAt));
  return rows.map((r) => ({ ...r, evidence: r.evidence as ProposalEvidence }));
}
