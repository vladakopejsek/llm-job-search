import { z } from "zod";
import { CollectorError } from "./types.ts";

/**
 * Validate an API response against the fields we rely on. A mismatch means
 * the ATS changed its format; the run records it as that board's error.
 */
export function parseResponse<T extends z.ZodType>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new CollectorError(`Unexpected ${what} shape: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
