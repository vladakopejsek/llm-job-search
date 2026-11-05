import { eq, ilike } from "drizzle-orm";
import pLimit from "p-limit";
import { CollectorError, collectorFor } from "../ats/index.ts";
import type { Db } from "../db/client.ts";
import { collectRuns, companies, companyFetches } from "../db/schema.ts";
import { isEngineeringTitle } from "./filter.ts";
import { withoutDescription } from "./raw.ts";
import { savePostings, type UpsertStats } from "./upsert.ts";

const CONCURRENCY = 6;

type Company = typeof companies.$inferSelect;

interface CompanyResult {
  company: string;
  status: "ok" | "error" | "unsupported";
  error?: string;
  total: number;
  kept: number;
  stats?: UpsertStats;
}

export interface RunSummary {
  runId: number;
  durationMs: number;
  companies: { ok: number; error: number; unsupported: number };
  postings: { seen: number; kept: number } & UpsertStats;
  results: CompanyResult[];
}

/** One collection run: fetch every active company's board and save what's there. */
export async function runCollect(db: Db, options: { only?: string } = {}): Promise<RunSummary> {
  const started = Date.now();
  const [run] = await db.insert(collectRuns).values({}).returning({ id: collectRuns.id });
  if (!run) throw new Error("Could not create a collect run");

  // --only matches by name and ignores status, so a paused company can be tested on its own.
  const targets = await db
    .select()
    .from(companies)
    .where(options.only ? ilike(companies.name, options.only) : eq(companies.status, "active"));

  const limit = pLimit(CONCURRENCY);
  const results = await Promise.all(targets.map((company) => limit(() => collectCompany(db, run.id, company))));

  const summary: RunSummary = {
    runId: run.id,
    durationMs: Date.now() - started,
    companies: { ok: 0, error: 0, unsupported: 0 },
    postings: { seen: 0, kept: 0, new: 0, changed: 0, reopened: 0, closed: 0 },
    results,
  };
  for (const r of results) {
    summary.companies[r.status]++;
    summary.postings.seen += r.total;
    summary.postings.kept += r.kept;
    for (const key of ["new", "changed", "reopened", "closed"] as const) summary.postings[key] += r.stats?.[key] ?? 0;
  }

  const { results: _, ...stats } = summary;
  await db.update(collectRuns).set({ finishedAt: new Date(), stats }).where(eq(collectRuns.id, run.id));
  return summary;
}

async function collectCompany(db: Db, runId: number, company: Company): Promise<CompanyResult> {
  const started = Date.now();
  const collector = collectorFor(company.ats);

  const record = async (result: CompanyResult, httpStatus: number | null = null) => {
    await db.insert(companyFetches).values({
      runId,
      companyId: company.id,
      status: result.status,
      httpStatus,
      error: result.error ?? null,
      postingsTotal: result.total,
      postingsKept: result.kept,
      durationMs: Date.now() - started,
    });
    return result;
  };

  if (!collector || !company.boardToken || !company.boardHost) {
    return record({ company: company.name, status: "unsupported", total: 0, kept: 0 });
  }

  try {
    const fetched = await collector.fetchPostings({ ats: company.ats, token: company.boardToken, host: company.boardHost });
    const kept = fetched.filter((p) => isEngineeringTitle(p.title)).map((p) => ({ ...p, raw: withoutDescription(company.ats, p.raw) }));
    const stats = await savePostings(
      db,
      company.id,
      kept,
      fetched.map((p) => p.externalId),
    );
    return record({ company: company.name, status: "ok", total: fetched.length, kept: kept.length, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const httpStatus = error instanceof CollectorError ? error.httpStatus : null;
    return record({ company: company.name, status: "error", error: message, total: 0, kept: 0 }, httpStatus);
  }
}
