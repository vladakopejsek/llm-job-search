import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { fetchJson } from "../lib/http.ts";

/**
 * The daily snapshot published by job-board-aggregator
 * (github.com/Feashliaa/job-board-aggregator, MIT; data in Feashliaa/job-board-data,
 * CC BY-NC per its author, so personal, non-commercial use only). About 1.4M
 * listings from ~29k companies: title, location, URL, ATS, first seen. No
 * descriptions; those come from our own collectors.
 */
const BASE = "https://raw.githubusercontent.com/Feashliaa/job-board-data/HEAD/data/chunks/";

export const SnapshotJob = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  url: z.string(),
  ats: z.string(),
  first_seen: z.string().nullish(),
  skill_level: z.string().nullish(),
  is_recruiter: z.boolean().nullish(),
});
export type SnapshotJob = z.infer<typeof SnapshotJob>;

/**
 * Stream the snapshot chunk by chunk (~60 gzipped JSON files), keeping only
 * the jobs `keep` accepts, so the full 1.4M records never sit in memory at once.
 */
export async function scanSnapshot(
  keep: (job: SnapshotJob) => boolean,
  concurrency = 8,
): Promise<{ total: number; invalid: number; kept: SnapshotJob[] }> {
  const manifest = z.object({ chunks: z.array(z.string()) }).parse(await fetchJson(`${BASE}jobs_manifest.json`));
  const result = { total: 0, invalid: 0, kept: [] as SnapshotJob[] };

  for (let i = 0; i < manifest.chunks.length; i += concurrency) {
    const batch = manifest.chunks.slice(i, i + concurrency);
    const chunks = await Promise.all(
      batch.map(async (name) => {
        const response = await fetch(BASE + name, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`Snapshot chunk ${name}: HTTP ${response.status}`);
        return JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()) as unknown[];
      }),
    );
    for (const records of chunks) {
      for (const record of records) {
        result.total++;
        const parsed = SnapshotJob.safeParse(record);
        if (!parsed.success) result.invalid++;
        else if (keep(parsed.data)) result.kept.push(parsed.data);
      }
    }
  }
  return result;
}
