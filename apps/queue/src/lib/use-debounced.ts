import { useEffect, useState } from "react";

/** The value, once it has stopped changing for `delay` ms: a search box asks the server once per pause, not per keystroke. */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
