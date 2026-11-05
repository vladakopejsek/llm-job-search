/** The Lab: the tool's own numbers (docs/metrics.md). */
import type { Db } from "@llm-job-search/core/db/client.ts";
import { labData } from "@llm-job-search/core/lab/queries.ts";
import { Hono } from "hono";

export const labRoutes = (db: Db) => new Hono().get("/lab", async (c) => c.json(await labData(db)));
