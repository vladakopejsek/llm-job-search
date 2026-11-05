/** The app-wide overlays, opened from any screen and shown by the shell: ⌘K search and the posting sheet. */
import { useSyncExternalStore } from "react";

interface Overlays {
  search: boolean;
  /** The posting open in the posting sheet. */
  postingId: number | null;
}

let state: Overlays = { search: false, postingId: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Overlays>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useOverlays = () => useSyncExternalStore(subscribe, () => state);
export const setSearchOpen = (search: boolean) => set({ search });
/** Opening a posting closes the search it was picked from. */
export const openPosting = (postingId: number) => set({ search: false, postingId });
export const closePosting = () => set({ postingId: null });
