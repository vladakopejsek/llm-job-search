/**
 * The theme: light, dark or the OS's ("system", the default), remembered per
 * browser. Applied as the `dark` class on <html> (index.css); index.html
 * applies it once before the page paints, so there's no flash of the wrong one.
 */
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "theme";
const osDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const isDark = () => document.documentElement.classList.contains("dark");

function apply() {
  const theme = stored();
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && osDark.matches));
  for (const listener of listeners) listener();
}

osDark.addEventListener("change", apply);
// Paper is white: every print (⌘P too, not only the Print button) is in the light theme.
addEventListener("beforeprint", () => document.documentElement.classList.remove("dark"));
addEventListener("afterprint", apply);

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked (private window): the choice lasts until reload.
  }
  apply();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the page is dark right now, whatever the preference that made it so. */
export const useDark = () => useSyncExternalStore(subscribe, isDark);
