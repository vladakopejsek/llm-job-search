import { useMutation, useQueryClient } from "@tanstack/react-query";

/** Run a server action, then refetch everything on screen: an action can change several lists at once. */
export function useAction<A extends unknown[], R = unknown>(fn: (...args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (args: A) => fn(...args), onSuccess: () => client.invalidateQueries() });
}
