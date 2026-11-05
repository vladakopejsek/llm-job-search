/**
 * Serves the app's API (server/app.ts) and, after `vite build`, its web page,
 * on 127.0.0.1 only.
 *
 *   pnpm queue            # build, serve on http://127.0.0.1:5175 and open the browser
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createDb } from "@llm-job-search/core/db/client.ts";
import { env } from "@llm-job-search/core/env.ts";
import { createApp } from "./app.ts";

const PORT = Number(process.env.QUEUE_PORT ?? 5175);
const { db } = createDb();
// Ask's tools read through a role that can't write (DATABASE_URL_READONLY).
const readonlyUrl = env().DATABASE_URL_READONLY;
const app = createApp(db, readonlyUrl ? createDb(readonlyUrl).db : null);

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// The built page (vite build → dist/). Any other path is a page of the app
// (/postings/12, /tracker/...), so it gets index.html and the router takes over.
const dist = path.relative(process.cwd(), path.resolve(import.meta.dirname, "../dist"));
app.use("/*", serveStatic({ root: dist }));
app.get("*", serveStatic({ path: path.join(dist, "index.html") }));

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Job search at ${url}  (Ctrl+C to stop)`);
  if (process.argv.includes("--open") && process.platform === "darwin") execFile("open", [url]);
});
