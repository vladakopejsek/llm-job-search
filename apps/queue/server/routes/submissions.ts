/** Correcting what was sent with an application, and search across everything sent. */

import { SubmissionInput, searchSentAnswers } from "@llm-job-search/core/applications/submission.ts";
import type { Db } from "@llm-job-search/core/db/client.ts";
import { updateSubmission } from "@llm-job-search/core/queue/actions.ts";
import { Hono } from "hono";
import { z } from "zod";
import { idParam, json, ok, query } from "../util.ts";

export const submissionRoutes = (db: Db) =>
  new Hono()
    .put("/applications/:id/submission", idParam, json(SubmissionInput), async (c) => {
      await updateSubmission(db, c.req.valid("param").id, c.req.valid("json"));
      return c.json(ok);
    })
    .get("/answers/search", query(z.object({ q: z.string().default("") })), async (c) =>
      c.json(await searchSentAnswers(db, c.req.valid("query").q, { limit: 10 })),
    );
