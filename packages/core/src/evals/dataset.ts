import { sql } from "drizzle-orm";
import type { Verdict } from "../agent/rules.ts";
import type { Db } from "../db/client.ts";
import { applications, companies, evaluations, postingSnapshots, postings } from "../db/schema.ts";
import type { EvalCase, Label } from "./grade.ts";

const APPLY_STAGES = ["shortlisted", "applied", "screening", "interviewing", "offer", "rejected", "no_response"];
const NOT_INTERESTED = ["not_interested", "pay", "company"];

/** The candidate's decision as a label, or null when it isn't one ("lead" is undecided, other skips say nothing about the role). */
export function labelOf(stage: string, skipReason: string | null): Label | null {
  if (APPLY_STAGES.includes(stage)) return "apply";
  if (stage !== "skipped") return null;
  if (skipReason === "applied_other_role") return "apply";
  if (skipReason === "not_eligible") return "not_eligible";
  return skipReason && NOT_INTERESTED.includes(skipReason) ? "not_interested" : null;
}

type Row = {
  posting_id: number;
  company: string;
  title: string;
  location: string | null;
  workplace: string | null;
  url: string;
  text: string;
  verdict: Verdict | null;
  stage?: string;
  skip_reason?: string | null;
};

const toCase = (r: Row, label: Label | null, decision: string | null): EvalCase => ({
  id: `p${r.posting_id}`,
  postingId: r.posting_id,
  label,
  decision,
  production: r.verdict,
  item: { company: r.company, title: r.title, location: r.location, workplace: r.workplace, url: r.url, text: r.text },
});

/**
 * Every posting the candidate decided on, with the text the pipeline read (the latest
 * evaluated snapshot, else the posting's own), plus up to `sample` unlabelled evaluated
 * postings per production verdict, chosen by a hash of the id so a rebuild picks the same.
 * Purpose and triage note are left out of the model's input on purpose: a note like
 * "company is applied" would leak the label.
 */
export async function buildDataset(db: Db, sample: number): Promise<EvalCase[]> {
  const labelled = await db.execute<Row>(sql`
    select distinct on (p.id) p.id as posting_id, c.name as company, p.title, p.location_raw as location,
      p.workplace_raw as workplace, p.url, coalesce(s.description_text, p.description_text) as text,
      e.verdict, a.stage, a.skip_reason
    from ${applications} a
    join ${postings} p on p.id = a.posting_id
    join ${companies} c on c.id = p.company_id
    left join lateral (select verdict, snapshot_id from ${evaluations} where posting_id = p.id order by created_at desc, id desc limit 1) e on true
    left join ${postingSnapshots} s on s.id = e.snapshot_id
    order by p.id, a.id desc`);
  const cases = [...labelled].flatMap((r) => {
    const label = labelOf(r.stage!, r.skip_reason ?? null);
    const decision = r.stage === "skipped" ? `skipped: ${r.skip_reason}` : r.stage!;
    return label && r.text.length > 200 ? [toCase(r, label, decision)] : [];
  });

  const taken = cases.map((c) => c.postingId);
  const unlabelled = await db.execute<Row>(sql`
    select * from (
      select p.id as posting_id, c.name as company, p.title, p.location_raw as location, p.workplace_raw as workplace,
        p.url, s.description_text as text, e.verdict,
        row_number() over (partition by e.verdict order by md5(p.id::text)) as n
      from ${evaluations} e
      join ${postingSnapshots} s on s.id = e.snapshot_id
      join ${postings} p on p.id = e.posting_id
      join ${companies} c on c.id = p.company_id
      where length(s.description_text) > 200 ${taken.length ? sql`and p.id not in ${taken}` : sql``}
    ) x where n <= ${sample}
    order by verdict, n`);
  const seen = new Set(taken);
  for (const r of unlabelled) {
    // A posting evaluated twice (a newer text) appears once.
    if (seen.has(r.posting_id)) continue;
    seen.add(r.posting_id);
    cases.push(toCase(r, null, null));
  }
  return cases;
}

/** Sanity checks over the whole set: balance, lengths, duplicates. Read them before paying for a run. */
export function describeDataset(cases: EvalCase[]): string[] {
  const count = (key: (c: EvalCase) => string) =>
    Object.entries(Object.groupBy(cases, key))
      .map(([k, v]) => `${k} ${v?.length}`)
      .join(", ");
  const lengths = cases.map((c) => c.item.text.length).sort((a, b) => a - b);
  const titles = Object.values(Object.groupBy(cases, (c) => `${c.item.company}|${c.item.title.toLowerCase()}`)).filter((g) => (g?.length ?? 0) > 1);
  return [
    `${cases.length} cases. Labels: ${count((c) => c.label ?? "unlabelled")}`,
    `Production verdicts: ${count((c) => c.production ?? "none")}`,
    `Text length: min ${lengths[0]}, median ${lengths[Math.floor(lengths.length / 2)]}, max ${lengths.at(-1)} characters`,
    `Same company and title more than once: ${titles.length}${
      titles.length
        ? ` (${titles
            .map((g) => g?.[0]?.item.title)
            .slice(0, 5)
            .join("; ")})`
        : ""
    }`,
  ];
}
