/**
 * Keyboard shortcuts for the screen that's showing. Keys are `event.key`
 * lowercased ("y", "Enter", "Escape"), with "mod+" for ⌘ or Ctrl ("mod+Enter").
 * While typing in a field only "mod+" shortcuts fire, and Enter is left alone
 * on a focused button or link, which Enter already activates.
 */
import { useEffect } from "react";

type Handlers = Record<string, (event: KeyboardEvent) => void>;

const isField = (el: Element) => el.matches("input, textarea, select, [contenteditable=''], [contenteditable='true']");

export function useHotkeys(handlers: Handlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const mod = event.metaKey || event.ctrlKey;
      if (event.defaultPrevented || event.altKey || (target && isField(target) && !mod)) return;
      if (event.key === "Enter" && target?.closest("button, a")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = handlers[(mod ? "mod+" : "") + key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers, enabled]);
}
