/** Focus's own data: the lead type, the eligibility note, the posting text. Decisions are in lib/decisions.ts. */
import { queryOptions } from "@tanstack/react-query";
import { api, call } from "@/lib/api";
import type { Overview } from "@/lib/queries";
import { useAction } from "@/lib/use-action";

export type Lead = Overview["decide"][number];

const byId = (id: number) => ({ param: { id: String(id) } });

export const useConfirmEligible = () =>
  useAction((id: number, note: string) => call(api.postings[":id"].eligible.$post({ ...byId(id), json: { note: note || undefined } })));

/** The posting text the evaluation read, loaded only when opened. */
export const postingTextQuery = (lead: Lead) =>
  queryOptions({
    queryKey: ["posting-text", lead.postingId, lead.snapshotId],
    queryFn: () => call(api.postings[":id"].snapshots[":sid"].$get({ param: { id: String(lead.postingId), sid: String(lead.snapshotId) } })),
  });
