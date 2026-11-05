/** The Lab's numbers, in one read. */
import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, call } from "@/lib/api";

export const labQuery = queryOptions({ queryKey: ["lab"], queryFn: () => call(api.lab.$get()) });
export type Lab = InferResponseType<typeof api.lab.$get, 200>;

/** Below this many, a group is drawn faint and marked "small": too few to read much into. */
export const SMALL = 5;
