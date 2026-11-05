/** The queue: what to apply to next, follow-ups, and replies to confirm. */

import type { Db } from "@llm-job-search/core/db/client.ts";
import { draftShortlistedPacks } from "@llm-job-search/core/llm/prep.ts";
import {
  ApplyInput,
  acceptProposal,
  confirmEligibility,
  dismissProposal,
  dropApplication,
  markApplied,
  markFollowedUp,
  reopen,
  SkipExtra,
  SkipReason,
  shortlist,
  skip,
  snooze,
} from "@llm-job-search/core/queue/actions.ts";
import {
  applyDraft,
  companyApplications,
  decideQueue,
  followUps,
  pendingProposals,
  postingLabel,
  queueStatus,
  shortlistQueue,
} from "@llm-job-search/core/queue/queries.ts";
import { upcomingSteps } from "@llm-job-search/core/tracker/queries.ts";
import { Hono } from "hono";
import { z } from "zod";
import { idParam, json, ok, query } from "../util.ts";

/**
 * The shortlist's packs being drafted, at most one run at a time, and why the last one stopped.
 * ponytail: in the server process, so a restart (a deploy) loses the pack in progress; the stored ones stay, press again.
 */
let drafting: Promise<void> | null = null;
let draftFailure: string | null = null;

export const queueRoutes = (db: Db) =>
  new Hono()
    .get("/overview", async (c) => {
      const [decide, shortlisted, follow, replies, status, upcoming] = await Promise.all([
        decideQueue(db),
        shortlistQueue(db),
        followUps(db),
        pendingProposals(db),
        queueStatus(db),
        upcomingSteps(db, 1),
      ]);
      return c.json({
        decide,
        shortlist: shortlisted,
        drafting: drafting !== null,
        draftFailure,
        followUps: follow,
        replies,
        status,
        upNext: upcoming[0] ?? null,
      });
    })
    // Answers at once; the packs appear in the overview as they're stored, on the API or the subscription.
    .post("/packs/draft", (c) => {
      if (!drafting) draftFailure = null;
      drafting ??= draftShortlistedPacks(db)
        .then((report) => console.log(`Packs: ${report}`))
        .catch((error) => {
          draftFailure = error instanceof Error ? error.message : String(error);
          console.error(`Packs failed: ${draftFailure}`);
        })
        .finally(() => {
          drafting = null;
        });
      return c.json(ok);
    })
    // ?drafts=0: the no-pack arm of the timing experiment, the form's questions without the pack's answers.
    .get("/postings/:id/apply-draft", idParam, query(z.object({ drafts: z.literal("0").optional() })), async (c) =>
      c.json(await applyDraft(db, c.req.valid("param").id, { drafts: c.req.valid("query").drafts !== "0" })),
    )
    .get("/postings/:id/company-applications", idParam, async (c) => c.json(await companyApplications(db, c.req.valid("param").id)))
    .post("/postings/:id/applied", idParam, json(ApplyInput), async (c) =>
      c.json(await markApplied(db, c.req.valid("param").id, c.req.valid("json"))),
    )
    .post("/postings/:id/shortlist", idParam, async (c) => {
      const { id } = c.req.valid("param");
      await shortlist(db, id);
      return c.json({ ...ok, ...(await postingLabel(db, id)) });
    })
    // Shortlist, skip and snooze answer with the posting's name, for the Undo toast.
    .post("/postings/:id/skip", idParam, json(SkipExtra.extend({ reason: SkipReason })), async (c) => {
      const { id } = c.req.valid("param");
      const { reason, ...extra } = c.req.valid("json");
      const result = await skip(db, id, reason, extra);
      return c.json({ ...result, ...(await postingLabel(db, id)) });
    })
    .post("/postings/:id/snooze", idParam, json(z.object({ until: z.string() })), async (c) => {
      const { id } = c.req.valid("param");
      await snooze(db, id, c.req.valid("json").until);
      return c.json({ ...ok, ...(await postingLabel(db, id)) });
    })
    .post("/postings/:id/eligible", idParam, json(z.object({ note: z.string().max(500).optional() })), async (c) => {
      await confirmEligibility(db, c.req.valid("param").id, c.req.valid("json").note);
      return c.json(ok);
    })
    .post("/postings/:id/reopen", idParam, async (c) => {
      await reopen(db, c.req.valid("param").id);
      return c.json(ok);
    })
    .post("/applications/:id/followed-up", idParam, async (c) => {
      await markFollowedUp(db, c.req.valid("param").id);
      return c.json(ok);
    })
    .post("/applications/:id/drop", idParam, async (c) => {
      await dropApplication(db, c.req.valid("param").id);
      return c.json(ok);
    })
    .post("/proposals/:id/accept", idParam, async (c) => {
      await acceptProposal(db, c.req.valid("param").id);
      return c.json(ok);
    })
    .post("/proposals/:id/dismiss", idParam, async (c) => {
      await dismissProposal(db, c.req.valid("param").id);
      return c.json(ok);
    });
