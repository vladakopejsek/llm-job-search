import { z } from "zod";
import { fetchJson } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseResponse } from "./parse.ts";
import type { Board, Collector, NormalizedPosting } from "./types.ts";

const LeverJob = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
    })
    .nullish(),
  workplaceType: z.string().nullish(),
  /** Unix time in milliseconds. */
  createdAt: z.number().nullish(),
  description: z.string().nullish(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).nullish(),
  additional: z.string().nullish(),
  salaryRange: z.unknown().optional(),
});

const LeverResponse = z.array(z.unknown());

/** Lever splits a posting into an intro, titled lists ("What you'll do"…) and a closing section. */
function leverText(job: z.infer<typeof LeverJob>): string {
  const parts = [
    job.description ? htmlToText(job.description) : "",
    // List content is often bare <li> items, which render as one run-on line outside a <ul>.
    ...(job.lists ?? []).map((list) => `${list.text}\n${htmlToText(`<ul>${list.content}</ul>`)}`),
    job.additional ? htmlToText(job.additional) : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function normalizeLever(response: unknown): NormalizedPosting[] {
  const jobs = parseResponse(LeverResponse, response, "Lever board");

  return jobs.map((raw) => {
    const job = parseResponse(LeverJob, raw, "Lever job");
    const locations = job.categories?.allLocations?.length ? job.categories.allLocations : [job.categories?.location].filter((l): l is string => !!l);

    return {
      externalId: job.id,
      url: job.hostedUrl,
      title: job.text,
      locationRaw: locations.length ? locations.join("; ") : null,
      workplaceRaw: job.workplaceType ?? null,
      department: job.categories?.team ?? job.categories?.department ?? null,
      descriptionText: leverText(job),
      compensationRaw: job.salaryRange ?? null,
      postedAt: job.createdAt ? new Date(job.createdAt) : null,
      raw,
    };
  });
}

export const lever: Collector = {
  ats: "lever",
  async fetchPostings(board: Board) {
    const url = `https://${board.host}/v0/postings/${encodeURIComponent(board.token)}?mode=json`;
    return normalizeLever(await fetchJson(url));
  },
};
