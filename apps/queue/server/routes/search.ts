/** ⌘K: one query across applications, postings, companies and the answers you sent. */
import { searchSentAnswers } from "@llm-job-search/core/applications/submission.ts";
import type { Db } from "@llm-job-search/core/db/client.ts";
import { searchPostings } from "@llm-job-search/core/postings/queries.ts";
import { pipeline } from "@llm-job-search/core/tracker/queries.ts";
import { listCompanies } from "@llm-job-search/core/watchlist/queries.ts";
import { Hono } from "hono";
import { z } from "zod";
import { query } from "../util.ts";

/** Results per group: enough to pick from, few enough to scan. */
const PER_GROUP = 5;

export const searchRoutes = (db: Db) =>
  new Hono().get("/search", query(z.object({ q: z.string().trim().min(2).max(200) })), async (c) => {
    const { q } = c.req.valid("query");
    const [applications, postings, active, paused, answers] = await Promise.all([
      pipeline(db, q),
      searchPostings(db, q, PER_GROUP),
      listCompanies(db, { status: "active", q, limit: PER_GROUP }),
      listCompanies(db, { status: "paused", q, limit: PER_GROUP }),
      searchSentAnswers(db, q, { limit: PER_GROUP }),
    ]);
    return c.json({
      applications: applications.slice(0, PER_GROUP),
      postings,
      companies: [...active, ...paused].slice(0, PER_GROUP),
      answers,
    });
  });
