import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { z } from "zod";

/**
 * Request validators. Unlike checking inside the handler, a validator's schema
 * becomes part of the route's type, so the typed client (src/lib/api.ts) knows
 * what each route takes. A bad request gets the same 400 `{ error }` as
 * any other failure (server/app.ts `onError`).
 */
const rejectInvalid = (result: { success: boolean; error?: unknown }, c: Context) => {
  if (!result.success) return c.json({ error: z.prettifyError(result.error as z.ZodError) }, 400);
};

/** The JSON body, checked against a schema. */
export const json = <S extends z.ZodType>(schema: S) => zValidator("json", schema, rejectInvalid);

/** The query string, checked against a schema. */
export const query = <S extends z.ZodType>(schema: S) => zValidator("query", schema, rejectInvalid);

/** Route parameters, checked against a schema. */
export const param = <S extends z.ZodType>(schema: S) => zValidator("param", schema, rejectInvalid);

/** A numeric `:id` route parameter. */
export const idParam = param(z.object({ id: z.coerce.number().int() }));

export const ok = { ok: true } as const;
