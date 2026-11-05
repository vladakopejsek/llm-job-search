/** Whether the screen is desktop-wide (Tailwind's `md`, 768px): the breakpoint between phone and desk layouts. */
import { useSyncExternalStore } from "react";

const query = window.matchMedia("(min-width: 768px)");
const subscribe = (listener: () => void) => {
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

export const useDesktop = () => useSyncExternalStore(subscribe, () => query.matches);
