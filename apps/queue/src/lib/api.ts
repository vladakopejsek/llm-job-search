/**
 * The typed API client. Paths, inputs and outputs come from the server's
 * route chain (server/app.ts), so a renamed route or a changed body is a
 * type error here, not a 400 at runtime.
 */
import { type ClientResponse, DetailedError, hc, parseResponse } from "hono/client";
import type { AppType } from "../../server/app.ts";

export const api = hc<AppType>("/").api;

/** A call's JSON. On failure, an Error with the server's own message (it answers `{ error }`). */
export async function call<T extends ClientResponse<unknown>>(response: Promise<T>) {
  try {
    return await parseResponse(response);
  } catch (e) {
    const message = e instanceof DetailedError ? (e.detail as { data?: { error?: string } } | undefined)?.data?.error : undefined;
    throw message ? new Error(message) : e;
  }
}
