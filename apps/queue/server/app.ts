/**
 * The app's API: each area's routes (server/routes/<area>.ts) under /api.
 * Built as one chain, so its type carries every route's path, input and
 * output; `AppType` is the contract the typed client (src/lib/api.ts) reads.
 */
import type { Db } from "@llm-job-search/core/db/client.ts";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { applicationsRoutes } from "./routes/applications.ts";
import { askRoutes } from "./routes/ask.ts";
import { labRoutes } from "./routes/lab.ts";
import { postingsRoutes } from "./routes/postings.ts";
import { queueRoutes } from "./routes/queue.ts";
import { searchRoutes } from "./routes/search.ts";
import { submissionRoutes } from "./routes/submissions.ts";
import { timingRoutes } from "./routes/timing.ts";
import { trackerRoutes } from "./routes/tracker.ts";
import { watchlistRoutes } from "./routes/watchlist.ts";

export const createApp = (db: Db, readonlyDb: Db | null) =>
  new Hono()
    .onError((error, c) => c.json({ error: error.message }, 400))
    // The API has no login: refuse state changes another site's page sends from the browser (form posts, no-cors fetches).
    .use("/api/*", csrf())
    .route("/api", queueRoutes(db))
    .route("/api", submissionRoutes(db))
    .route("/api", postingsRoutes(db))
    .route("/api", watchlistRoutes(db))
    .route("/api", trackerRoutes(db))
    .route("/api", applicationsRoutes(db))
    .route("/api", timingRoutes(db))
    .route("/api", searchRoutes(db))
    .route("/api", labRoutes(db))
    .route("/api", askRoutes(db, readonlyDb));

export type AppType = ReturnType<typeof createApp>;
