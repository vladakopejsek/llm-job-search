import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** A role that can only read (pg_read_all_data): Ask's tools use it. Optional, so without it only Ask fails. */
  // "KEY=" in .env is "": the same as not set, not an invalid URL that stops every command.
  DATABASE_URL_READONLY: z.preprocess((v) => v || undefined, z.url({ protocol: /^postgres(ql)?$/ }).optional()),
});

/** Validated environment. Fails at startup with a clear message instead of deep inside a query. */
export function env(): z.infer<typeof Env> {
  const result = Env.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment (see .env.example):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
