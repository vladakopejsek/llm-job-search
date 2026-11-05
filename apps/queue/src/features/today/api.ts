/** Today's own data and actions. The overview it shares with the shell is in lib/queries.ts. */
import { api, call } from "@/lib/api";
import { useAction } from "@/lib/use-action";

const byId = (id: number) => ({ param: { id: String(id) } });

export const useConfirmReply = () => useAction((id: number) => call(api.proposals[":id"].accept.$post(byId(id))));
export const useDismissReply = () => useAction((id: number) => call(api.proposals[":id"].dismiss.$post(byId(id))));
export const useDraftPacks = () => useAction(() => call(api.packs.draft.$post()));
