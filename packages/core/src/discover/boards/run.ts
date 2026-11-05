import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import { collectorFor } from "../../ats/index.ts";
import type { Board } from "../../ats/types.ts";
import type { Db } from "../../db/client.ts";
import { applications, companies, discoveredRoles, postings } from "../../db/schema.ts";
import { companyKeys } from "../../screen/company-key.ts";
import { postingKey } from "../../screen/posting-key.ts";
import { upsertDiscoveredRoles } from "../store.ts";
import { isBoardMatch, isStrongMatch } from "./match.ts";
import { findAtsBoard, sameRole } from "./resolve.ts";
import type { BoardRole, BoardSource } from "./types.ts";

export interface BoardDiscoverySummary {
  source: string;
  listed: number;
  read: number;
  matched: number;
  /** Matches at companies already watched, paused or without a feed: left as they are. */
  atKnownCompanies: number;
  atRejectingCompanies: number;
  /** Roles whose apply link isn't on an ATS we collect. */
  uncollectable: number;
  /** Companies the board names without a board link, looked up on the ATSs we collect. */
  lookedUp: number;
  /** Of those, the ones with no board we can collect: saved as "no feed" so they aren't looked up again. */
  noBoard: string[];
  /** And the ones with a board found by name that doesn't list the role: discovered, never auto-promoted. */
  byNameOnly: string[];
  companies: number;
  roles: number;
  /** Discovered companies with a role that names the candidate's stack: worth watching now. */
  strong: { id: number; name: string; title: string }[];
  staleRemoved: number;
  errors: string[];
}

/** Each lookup tries up to ~20 ATS boards, so one scan does a few; the rest wait for the next scan. */
const MAX_LOOKUPS = 12;

const boardId = (b: Board) => `${b.ats}:${b.token.toLowerCase()}`;
const nameKeys = (role: BoardRole, board: Board | null) => [
  ...companyKeys(role.company),
  ...(role.companySlug ? companyKeys(role.companySlug) : []),
  ...(board ? companyKeys(board.token) : []),
];

/**
 * Scan one job board for roles at companies we don't watch, and store them as
 * discovered companies with their roles, like the snapshot does. A company
 * already on the list in any status (watched, paused, no feed), by board or by
 * name, is left alone: pausing a company sticks.
 */
export async function discoverOnBoard(db: Db, source: BoardSource): Promise<BoardDiscoverySummary> {
  const now = new Date();
  const known = await db
    .select({
      id: companies.id,
      name: companies.name,
      ats: companies.ats,
      token: companies.boardToken,
      host: companies.boardHost,
      status: companies.status,
    })
    .from(companies);
  type Known = (typeof known)[number];
  const byBoard = new Map(known.filter((c) => c.token).map((c) => [boardId({ ats: c.ats, token: c.token!, host: "" }), c]));
  const byName = new Map(known.flatMap((c) => companyKeys(c.name).map((k) => [k, c] as const)));
  const takenNames = new Set(known.map((c) => c.name.toLowerCase()));
  const remember = (c: Known) => {
    takenNames.add(c.name.toLowerCase());
    for (const k of companyKeys(c.name)) byName.set(k, c);
    if (c.token) byBoard.set(boardId({ ats: c.ats, token: c.token, host: "" }), c);
  };
  const findKnown = (role: BoardRole, board: Board | null) =>
    (board ? byBoard.get(boardId(board)) : undefined) ??
    nameKeys(role, board)
      .map((k) => byName.get(k))
      .find(Boolean);
  const freeName = (name: string) => (takenNames.has(name.toLowerCase()) ? `${name} (${source.name})` : name);
  const rejectedKeys = new Set(
    (await db.select({ company: applications.company }).from(applications).where(eq(applications.stage, "rejected"))).flatMap((a) =>
      companyKeys(a.company),
    ),
  );

  // Collected already, at a company we watch: no need to read it again. Discovered roles are read
  // again, so a company that wasn't promoted yet is still judged on its roles next time.
  const stored = new Set(
    (
      await db
        .select({ ats: companies.ats, externalId: postings.externalId })
        .from(postings)
        .innerJoin(companies, eq(companies.id, postings.companyId))
    ).map((p) => postingKey(p.ats, p.externalId)),
  );

  const scan = await source.scan((key) => stored.has(key));
  const summary: BoardDiscoverySummary = {
    source: source.label,
    listed: scan.listed.size,
    read: scan.roles.length,
    matched: 0,
    atKnownCompanies: 0,
    atRejectingCompanies: 0,
    uncollectable: scan.uncollectable,
    lookedUp: 0,
    noBoard: [],
    byNameOnly: [],
    companies: 0,
    roles: 0,
    strong: [],
    staleRemoved: 0,
    errors: scan.errors,
  };

  // `confirmed`: the board is linked from the role, or lists it. Only a confirmed board is promoted on its own.
  const groups = new Map<string, { board: Board; existing?: Known; roles: BoardRole[]; confirmed: boolean }>();
  const group = (board: Board, roles: BoardRole[], existing: Known | undefined, confirmed: boolean) => {
    const id = existing ? `company:${existing.id}` : boardId(board);
    const g = groups.get(id) ?? { board, existing, roles: [], confirmed };
    g.roles.push(...roles);
    g.confirmed ||= confirmed;
    groups.set(id, g);
  };
  const unlinked = new Map<string, { roles: BoardRole[]; existing?: Known }>();

  for (const role of scan.roles) {
    if (!isBoardMatch(role.posting)) continue;
    summary.matched++;
    const existing = findKnown(role, role.board);
    if (existing && existing.status !== "discovered") {
      summary.atKnownCompanies++;
      continue;
    }
    if (nameKeys(role, role.board).some((k) => rejectedKeys.has(k))) {
      summary.atRejectingCompanies++;
      continue;
    }
    if (role.board) group(role.board, [role], existing, true);
    // Without a board link, only a role naming the stack is worth looking the company up for.
    else if (isStrongMatch(role.posting)) {
      const key = companyKeys(role.company)[0] ?? role.company.toLowerCase();
      const u = unlinked.get(key) ?? { roles: [], existing };
      u.roles.push(role);
      unlinked.set(key, u);
    }
  }

  // A company discovered on an earlier scan has its board: read that one board for the roles instead of
  // looking the company up on every ATS again, which would take a lookup from a new company. A board that
  // lists a role is confirmed, as a lookup's would be.
  const lookups: BoardRole[][] = [];
  for (const { roles, existing } of unlinked.values()) {
    const collector = existing && collectorFor(existing.ats);
    if (!existing?.token || !existing.host || !collector) {
      lookups.push(roles);
      continue;
    }
    const board: Board = { ats: existing.ats, token: existing.token, host: existing.host };
    const listed = await collector.fetchPostings(board).catch(() => []);
    const confirmed = listed.some((p) => roles.some((r) => sameRole(p.title, r.posting.title)));
    group(
      board,
      roles.map((r) => ({ ...r, board })),
      existing,
      confirmed,
    );
  }

  for (const roles of lookups.slice(0, MAX_LOOKUPS)) {
    const first = roles[0]!;
    summary.lookedUp++;
    let found: Awaited<ReturnType<typeof findAtsBoard>>;
    try {
      found = await findAtsBoard(
        first.company,
        first.companySlug,
        roles.map((r) => r.posting.title),
      );
    } catch (error) {
      // Not saved as "no feed": the next scan looks it up again.
      summary.errors.push(`${first.company}: lookup failed (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (!found) {
      const [inserted] = await db
        .insert(companies)
        .values({
          name: freeName(first.company),
          ats: "none",
          boardUrl: first.companyUrl,
          status: "no_feed",
          source: "discovery",
          notes: `Found on ${source.label}: ${first.posting.title}. No board on an ATS we collect.`,
        })
        .onConflictDoNothing()
        .returning({
          id: companies.id,
          name: companies.name,
          ats: companies.ats,
          token: companies.boardToken,
          host: companies.boardHost,
          status: companies.status,
        });
      if (inserted) remember(inserted);
      summary.noBoard.push(first.company);
      continue;
    }
    const existing = findKnown(first, found.board);
    if (existing && existing.status !== "discovered") {
      summary.atKnownCompanies += roles.length;
      continue;
    }
    if (!found.confirmed) summary.byNameOnly.push(first.company);
    group(
      found.board,
      roles.map((r) => ({ ...r, board: found.board, companyUrl: found.url })),
      existing,
      found.confirmed,
    );
  }

  for (const { board, existing, roles, confirmed } of groups.values()) {
    const first = roles[0]!;
    let company = existing ?? byBoard.get(boardId(board));
    if (!company) {
      const [inserted] = await db
        .insert(companies)
        .values({
          name: freeName(first.company),
          ats: board.ats,
          boardToken: board.token,
          boardHost: board.host,
          feedUrl: first.companyUrl,
          boardUrl: first.companyUrl,
          status: "discovered",
          source: "discovery",
          notes: `Found on ${source.label}: ${first.posting.title}${confirmed ? "" : "; its board was found by name and doesn't list this role"}`,
        })
        .onConflictDoNothing()
        .returning({
          id: companies.id,
          name: companies.name,
          ats: companies.ats,
          token: companies.boardToken,
          host: companies.boardHost,
          status: companies.status,
        });
      if (!inserted) continue;
      company = inserted;
      remember(inserted);
    }
    summary.companies++;
    summary.roles += await upsertDiscoveredRoles(
      db,
      roles.map((r) => ({
        companyId: company.id,
        postingKey: r.postingKey,
        title: r.posting.title.trim(),
        location: r.posting.locationRaw,
        url: r.posting.url,
        firstSeen: r.posting.postedAt,
        lastSeenInSnapshot: now,
      })),
    );
    const strong = roles.find((r) => isStrongMatch(r.posting));
    if (strong && confirmed) summary.strong.push({ id: company.id, name: company.name, title: strong.posting.title });
  }

  // The board's list is the truth: a stored role it still lists is still open, one it doesn't is gone.
  // An empty list is a failed read, not an empty board, so it removes nothing.
  const listed = [...scan.listed];
  const discoveredIds = (await db.select({ id: companies.id }).from(companies).where(eq(companies.status, "discovered"))).map((c) => c.id);
  if (discoveredIds.length && listed.length) {
    const ofThisBoard = and(inArray(discoveredRoles.companyId, discoveredIds), like(discoveredRoles.postingKey, `${source.name}:%`));
    const stale = await db
      .delete(discoveredRoles)
      .where(and(ofThisBoard, notInArray(discoveredRoles.postingKey, listed)))
      .returning({ id: discoveredRoles.id });
    summary.staleRemoved = stale.length;
  }

  return summary;
}
