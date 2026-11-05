import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { applications, companies, evaluations, postingSnapshots, postings, reevaluationRequests } from "../db/schema.ts";
import { ensureSnapshots } from "../postings/snapshots.ts";
import { funnel } from "../screen/funnel.ts";
import { namesHome, textNamesHome } from "../screen/rules.ts";

export interface WorkItem {
  postingId: number;
  snapshotId: number;
  /** "queue": a candidate for the queue. "audit": a posting the screen rejected, evaluated to check the rules. */
  purpose: "queue" | "audit";
  company: string;
  title: string;
  location: string | null;
  workplace: string | null;
  url: string;
  postedAt: Date | null;
  /** Context from triage, e.g. "company is applied". Never the candidate's re-evaluation note. */
  note: string;
  text: string;
}

/**
 * One role posted once per country ("… - Poland (Remote)", "… - Romania (Remote)")
 * is one role: the same title once gender tags, location words and punctuation
 * are gone. Only one of them gets evaluated. Other parentheses stay: "(Backend focused)"
 * and "(Frontend focused)" are two roles.
 */
const GENDER_TAG = /\((?:[mfwdxh]\s*\/\s*)+[mfwdxh]\)|\((?:all genders|gn)\)/g;
const COUNTRIES =
  "uk|us|usa|poland|romania|ukraine|germany|spain|portugal|france|italy|netherlands|ireland|czechia|czech republic|slovakia|slovenia|hungary|bulgaria|croatia|serbia|greece|sweden|denmark|norway|finland|estonia|latvia|lithuania|austria|switzerland|belgium|luxembourg|united kingdom|united states|canada|brazil|mexico|india|israel";
const LOCATION_WORDS = new RegExp(
  `\\b(remote|hybrid|onsite|on-site|europe|emea|eu|apac|latam|americas|worldwide|global|${COUNTRIES}|berlin|london|paris|madrid|lisbon|warsaw|prague|amsterdam|dublin)\\b`,
  "gi",
);
/**
 * Or once per city: "… - Phoenix, AZ, USA", "… - Kaunas, Lithuania". The part after the
 * last dash is a place when it ends in a country, so "… - Payments, Remote" keeps its team.
 */
const CITY_AFTER_DASH = new RegExp(`\\s[-–]\\s[^-–]*,\\s*(${COUNTRIES})\\s*$`, "i");
/** Role keys of postings the candidate has decided on (applied, skipped…): their copies are settled too. */
export async function decidedRoleKeys(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ companyId: postings.companyId, title: postings.title })
    .from(applications)
    .innerJoin(postings, eq(postings.id, applications.postingId))
    .where(sql`${applications.stage} <> 'lead'`);
  return new Set(rows.map((r) => roleKey(r.companyId, r.title)));
}

export function roleKey(companyId: number, title: string): string {
  const base = title
    .replace(CITY_AFTER_DASH, " ")
    .toLowerCase()
    .replace(GENDER_TAG, " ")
    .replace(LOCATION_WORDS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${companyId}:${base}`;
}

const TS_SIGNAL = /\b(typescript|react|next\.?js|node\.?js)\b/i;
const EUROPE_SIGNAL = /\b(europe|emea|european union|eu|eea|cet|worldwide|anywhere in the world)\b/i;

/**
 * Postings with no evaluation of their current text yet. The snapshot of that
 * text may not exist yet (snapshotId null): nextWork takes it for the postings
 * it hands out. Its text is the posting's own, identical by content hash.
 */
function unevaluated(db: Db) {
  return db
    .select({
      postingId: postings.id,
      snapshotId: postingSnapshots.id,
      companyId: companies.id,
      company: companies.name,
      title: postings.title,
      location: postings.locationRaw,
      workplace: postings.workplaceRaw,
      url: postings.url,
      postedAt: postings.postedAt,
      text: postings.descriptionText,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .leftJoin(postingSnapshots, and(eq(postingSnapshots.postingId, postings.id), eq(postingSnapshots.contentHash, postings.contentHash)))
    .leftJoin(evaluations, and(eq(evaluations.postingId, postings.id), eq(evaluations.snapshotId, postingSnapshots.id)))
    .$dynamic();
}

type Candidate = Awaited<ReturnType<ReturnType<typeof unevaluated>["execute"]>>[number];

/** A work item whose snapshot may not be taken yet. */
type DraftItem = Omit<WorkItem, "snapshotId"> & { snapshotId: number | null; companyId: number };

export const REEVAL_NOTE = "re-evaluation requested";

/**
 * A posting the candidate asked to have evaluated again. Their note is the
 * expected answer of an eval case, so it never reaches the agent: the item
 * reads like any other queue item.
 */
export function reevalWorkItem(p: Candidate, _request: { note: string | null }): DraftItem {
  return { ...p, purpose: "queue", note: REEVAL_NOTE };
}

/** Open postings with a pending re-evaluation request, oldest request first, on their current text. */
async function requestedWork(db: Db, limit: number) {
  const rows = await db
    .select({
      postingId: postings.id,
      snapshotId: postingSnapshots.id,
      companyId: companies.id,
      company: companies.name,
      title: postings.title,
      location: postings.locationRaw,
      workplace: postings.workplaceRaw,
      url: postings.url,
      postedAt: postings.postedAt,
      text: postings.descriptionText,
      note: reevaluationRequests.note,
    })
    .from(reevaluationRequests)
    .innerJoin(postings, eq(postings.id, reevaluationRequests.postingId))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .leftJoin(postingSnapshots, and(eq(postingSnapshots.postingId, postings.id), eq(postingSnapshots.contentHash, postings.contentHash)))
    .where(and(eq(reevaluationRequests.status, "pending"), isNull(postings.closedAt)))
    .orderBy(asc(reevaluationRequests.requestedAt))
    .limit(limit);
  return rows.map(({ note, ...p }) => reevalWorkItem(p, { note }));
}

/**
 * The next postings for the agent to read. Re-evaluation requests come first
 * and skip every filter below (screen, triage, already evaluated, same role
 * elsewhere): the candidate asked for them. Queue items are postings that
 * passed the screen and triage (new, or another role at a company already
 * contacted), best companies and newest first. Audit items are a random few
 * the screen rejected: if the agent finds leads among them, a rule is too strict.
 * With `postingIds`, exactly those open postings that have no evaluation of their current text, as queue items.
 * With `within`, the same choice of queue items made among those postings only, and no re-evaluation requests.
 */
export async function nextWork(db: Db, options: { limit: number; audit: number; postingIds?: number[]; within?: number[] }): Promise<WorkItem[]> {
  if (options.postingIds?.length) {
    const chosen = await unevaluated(db).where(and(inArray(postings.id, options.postingIds), isNull(postings.closedAt), isNull(evaluations.id)));
    return withSnapshots(
      db,
      chosen.map((p) => ({ ...p, purpose: "queue" as const, note: "" })),
    );
  }
  const requested = options.within ? [] : await requestedWork(db, options.limit);
  const requestedIds = requested.map((r) => r.postingId);

  // Other roles at a company with an active application wait until it ends (company_in_process).
  const triaged = (await funnel(db)).postings.filter(
    (p) => p.triage.category === "new" && !requestedIds.includes(p.id) && (!options.within || options.within.includes(p.id)),
  );
  const notes = new Map(triaged.map((p) => [p.id, p.triage.detail]));

  // Most promising first, so the queue fills with likely leads before long shots:
  // a TypeScript/React/Node mention and a Europe/remote signal in the text, then
  // the company's priority, then recency. A cheap text check, no model call.
  const candidates = triaged.length ? await unevaluated(db).where(and(inArray(postings.id, [...notes.keys()]), isNull(evaluations.id))) : [];
  const priority = new Map(triaged.map((p) => [p.id, p.priority]));
  const PRIORITY_BONUS: Record<string, number> = { A: 2, B: 1 };
  const promise = (p: (typeof candidates)[number]) =>
    2 * Number(TS_SIGNAL.test(p.text)) +
    Number(EUROPE_SIGNAL.test(p.text) || textNamesHome(p.text) || /europe|emea|remote/i.test(p.location ?? "") || namesHome(p.location)) +
    (PRIORITY_BONUS[priority.get(p.postingId) ?? ""] ?? 0);
  // Roles already evaluated under another open posting (a sibling country variant) are skipped.
  // Only an evaluation of a posting's current text counts: a candidate's own evaluation of an
  // older text doesn't, so an edited posting is evaluated again.
  const evaluatedRoles = new Set([
    ...(
      await db
        .select({ companyId: postings.companyId, title: postings.title })
        .from(evaluations)
        .innerJoin(postings, eq(postings.id, evaluations.postingId))
        .innerJoin(postingSnapshots, and(eq(postingSnapshots.id, evaluations.snapshotId), eq(postingSnapshots.contentHash, postings.contentHash)))
        .where(and(isNull(postings.closedAt), eq(evaluations.purpose, "queue")))
    ).map((r) => roleKey(r.companyId, r.title)),
    ...(await decidedRoleKeys(db)),
  ]);
  const seen = new Set<string>();
  const queue = candidates
    .map((p) => ({ p, score: promise(p) }))
    .sort((a, b) => b.score - a.score || (b.p.postedAt?.getTime() ?? 0) - (a.p.postedAt?.getTime() ?? 0))
    .filter(({ p }) => {
      const key = roleKey(p.companyId, p.title);
      if (evaluatedRoles.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.limit - requested.length)
    .map((x) => x.p);

  const audit = options.audit
    ? await unevaluated(db)
        .where(
          and(
            isNull(postings.closedAt),
            eq(companies.status, "active"),
            eq(postings.screenStatus, "reject"),
            isNull(evaluations.id),
            requestedIds.length ? notInArray(postings.id, requestedIds) : undefined,
          ),
        )
        .orderBy(sql`md5(${postings.id}::text || current_date::text)`)
        .limit(options.audit)
    : [];

  const items: DraftItem[] = [
    ...requested,
    ...queue.map((p) => ({ ...p, purpose: "queue" as const, note: notes.get(p.postingId) ?? "" })),
    ...audit.map((p) => ({ ...p, purpose: "audit" as const, note: "screen-rejected; evaluate normally" })),
  ];
  return withSnapshots(db, items);
}

/** Take the missing snapshots of the items' current text, so every item says which text it is. */
async function withSnapshots(db: Db, items: DraftItem[]): Promise<WorkItem[]> {
  const snapshots = await ensureSnapshots(
    db,
    items.filter((i) => i.snapshotId === null).map((i) => i.postingId),
  );
  return items.map((i) => {
    const snapshotId = i.snapshotId ?? snapshots.get(i.postingId);
    if (snapshotId === undefined) throw new Error(`no snapshot for posting ${i.postingId}`);
    return { ...i, snapshotId };
  });
}
