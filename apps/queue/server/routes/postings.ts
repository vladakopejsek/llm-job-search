/** One posting (the posting sheet), a version of its text, and asking for it to be evaluated again. */
import type { Db } from "@llm-job-search/core/db/client.ts";
import { postingDetail, snapshotText } from "@llm-job-search/core/postings/queries.ts";
import { cancelReevaluation, requestReevaluation } from "@llm-job-search/core/postings/reeval.ts";
import { Hono } from "hono";
import { z } from "zod";
import { idParam, json, ok, param } from "../util.ts";

export const postingsRoutes = (db: Db) =>
  new Hono()
    .get("/postings/:id", idParam, async (c) => c.json(await postingDetail(db, c.req.valid("param").id)))
    .get("/postings/:id/snapshots/:sid", param(z.object({ id: z.coerce.number().int(), sid: z.coerce.number().int() })), async (c) => {
      const { id, sid } = c.req.valid("param");
      return c.json(await snapshotText(db, id, sid));
    })
    // "Wrong verdict?": the next run evaluates it again. The note is for the candidate; the agent never sees it.
    .post("/postings/:id/reevaluate", idParam, json(z.object({ note: z.string().trim().max(2000).optional() })), async (c) => {
      const { requested } = await requestReevaluation(db, [c.req.valid("param").id], c.req.valid("json").note);
      if (!requested.length) throw new Error("already requested, or the posting is closed");
      return c.json(ok);
    })
    .delete("/postings/:id/reevaluate", idParam, async (c) => {
      await cancelReevaluation(db, c.req.valid("param").id);
      return c.json(ok);
    });
