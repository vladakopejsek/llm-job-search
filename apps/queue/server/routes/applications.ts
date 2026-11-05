/** Applications: the pipeline, one application, and what you change on it (stage, next step, notes). */
import { IsoDate, Stage } from "@llm-job-search/core/applications/constants.ts";
import type { Db } from "@llm-job-search/core/db/client.ts";
import { addNote, NextStepInput, NoteInput, recordPastStep, setNextStep, setRejectionReason, setStage } from "@llm-job-search/core/queue/actions.ts";
import { applicationDetail, pipeline } from "@llm-job-search/core/tracker/queries.ts";
import { Hono } from "hono";
import { z } from "zod";
import { idParam, json, ok, query } from "../util.ts";

export const applicationsRoutes = (db: Db) =>
  new Hono()
    .get("/pipeline", query(z.object({ q: z.string().max(200).optional() })), async (c) => c.json(await pipeline(db, c.req.valid("query").q)))
    .get("/applications/:id", idParam, async (c) => {
      const detail = await applicationDetail(db, c.req.valid("param").id);
      return detail ? c.json(detail) : c.json({ error: "application not found" }, 404);
    })
    .post(
      "/applications/:id/stage",
      idParam,
      json(z.object({ stage: Stage, on: IsoDate.optional(), note: z.string().trim().optional() })),
      async (c) => {
        const { stage, on, note } = c.req.valid("json");
        await setStage(db, c.req.valid("param").id, stage, { on, note });
        return c.json(ok);
      },
    )
    .put("/applications/:id/next-step", idParam, json(z.object({ step: NextStepInput })), async (c) => {
      await setNextStep(db, c.req.valid("param").id, c.req.valid("json").step);
      return c.json(ok);
    })
    .put("/applications/:id/rejection-reason", idParam, json(z.object({ reason: z.string().max(2000).nullable() })), async (c) => {
      await setRejectionReason(db, c.req.valid("param").id, c.req.valid("json").reason);
      return c.json(ok);
    })
    .post(
      "/applications/:id/past-step",
      idParam,
      json(z.object({ stage: Stage, on: IsoDate, note: z.string().trim().max(500).optional() })),
      async (c) => {
        const { stage, on, note } = c.req.valid("json");
        await recordPastStep(db, c.req.valid("param").id, stage, on, note);
        return c.json(ok);
      },
    )
    .post("/applications/:id/notes", idParam, json(NoteInput), async (c) => {
      const { text, context } = c.req.valid("json");
      await addNote(db, c.req.valid("param").id, text, context);
      return c.json(ok);
    });
