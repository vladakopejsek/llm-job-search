/** Companies: which are collected, their priority, and promoting discovered ones. Feeds are fixed with `pnpm company`. */
import type { Db } from "@llm-job-search/core/db/client.ts";
import { promote, setPriority, setWatched } from "@llm-job-search/core/watchlist/actions.ts";
import { COMPANY_TABS } from "@llm-job-search/core/watchlist/filters.ts";
import { companiesSummary, listCompanies } from "@llm-job-search/core/watchlist/queries.ts";
import { Hono } from "hono";
import { z } from "zod";
import { idParam, json, ok, query } from "../util.ts";

export const watchlistRoutes = (db: Db) =>
  new Hono()
    .get("/companies", query(z.object({ status: z.enum(COMPANY_TABS).default("active"), q: z.string().max(100).optional() })), async (c) => {
      const f = c.req.valid("query");
      const [rows, summary] = await Promise.all([listCompanies(db, f), companiesSummary(db, f.q)]);
      return c.json({ rows, ...summary });
    })
    .post("/companies/:id/watch", idParam, json(z.object({ watched: z.boolean() })), async (c) =>
      c.json(await setWatched(db, c.req.valid("param").id, c.req.valid("json").watched)),
    )
    .put("/companies/:id/priority", idParam, json(z.object({ priority: z.enum(["A", "B", "C"]) })), async (c) => {
      await setPriority(db, c.req.valid("param").id, c.req.valid("json").priority);
      return c.json(ok);
    })
    .post("/companies/:id/promote", idParam, async (c) => {
      const [promoted] = await promote(db, [c.req.valid("param").id]);
      if (!promoted) throw new Error("Only a discovered company can be promoted.");
      return c.json(ok);
    });
