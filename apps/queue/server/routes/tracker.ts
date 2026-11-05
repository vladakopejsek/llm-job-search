/** Pipeline numbers: tiles, funnel and rejections, computed from the application event log. */
import type { Db } from "@llm-job-search/core/db/client.ts";
import { localDate } from "@llm-job-search/core/lib/dates.ts";
import { STATS_RANGES } from "@llm-job-search/core/tracker/filters.ts";
import { statsInput } from "@llm-job-search/core/tracker/queries.ts";
import { computeTrackerStats } from "@llm-job-search/core/tracker/stats.ts";
import { Hono } from "hono";
import { z } from "zod";
import { query } from "../util.ts";

export const trackerRoutes = (db: Db) =>
  new Hono().get("/tracker/stats", query(z.object({ range: z.enum(STATS_RANGES).default("90d") })), async (c) =>
    c.json(computeTrackerStats({ ...(await statsInput(db)), today: localDate(), range: c.req.valid("query").range })),
  );
