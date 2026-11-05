/**
 * What an Ask run streams to the screen, whichever runtime answers. Zod and types only: the
 * browser imports this file too.
 */
import { z } from "zod";

export type Runtime = "api" | "subscription";

export type AskEvent =
  | { type: "start"; runtime: Runtime }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; rows?: number; truncated?: boolean; error?: string }
  /** `costUsd` on the subscription is what the same tokens would cost on the API; nothing is billed. */
  | { type: "done"; runtime: Runtime; costUsd: number | null; ms: number }
  | { type: "error"; message: string };

export type Emit = (event: AskEvent) => void;

/** Earlier questions and answers go back as plain text, at most the last few. */
export const MAX_HISTORY = 6;

export const AskInput = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z
    // A long answer keeps its end rather than fail every later question (the browser sends whole answers).
    .array(z.object({ question: z.string().max(2000), answer: z.string().transform((s) => s.slice(-20_000).toWellFormed()) }))
    .max(MAX_HISTORY)
    .default([]),
});
export type AskInput = z.infer<typeof AskInput>;
