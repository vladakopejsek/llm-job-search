import Anthropic from "@anthropic-ai/sdk";
import { type Attributes, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { z } from "zod";

/** The model both steps use unless `--model` says otherwise. */
export const MODEL = "claude-opus-5-5";

/**
 * The Anthropic client. It retries 429s, 5xx and connection errors 4 times with backoff
 * (the SDK default is 2). With tracing on, every call is a span carrying the full
 * prompt and output, so a trace shows exactly what the model saw.
 */
export function createClient(): Anthropic {
  return new Anthropic({ maxRetries: 4, openTelemetry: { traces: { contentMode: "content" } } });
}

/**
 * Whether the API can be used now: one tiny Haiku call (a millionth of a dollar). False only
 * when the key is missing, rejected, out of credit or over a spend limit; anything else (an outage, a network
 * error) throws, so a passing problem fails the run instead of quietly switching runtimes.
 */
export async function apiUsable(): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  try {
    await new Anthropic().messages.create({ model: "claude-haiku-5-5", max_tokens: 16, messages: [{ role: "user", content: "ok" }] });
    return true;
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;
    if (["billing_error", "authentication_error", "permission_error"].includes(String(error.type))) return false;
    // Out of money until someone acts or the month ends: an empty balance on some accounts and a spend
    // limit you set come as a 400; the usage tier's monthly cap as a 429 (unlike a rate limit, retrying won't help).
    if (error.status === 400 && /credit balance|usage limits/i.test(error.message)) return false;
    if (error.status === 429 && error.message.includes("enforced_spend_limit_reached")) return false;
    throw error;
  }
}

/**
 * Sends spans to an OTLP backend (Langfuse, Jaeger…) when OTEL_EXPORTER_OTLP_ENDPOINT is
 * set; the exporter reads it and OTEL_EXPORTER_OTLP_HEADERS itself. Without it there's no
 * provider, spans are no-ops and nothing leaves the machine. The caller must
 * `await provider?.shutdown()` before exiting, or the spans still buffered are lost.
 */
export function startTracing(): NodeTracerProvider | undefined {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;
  const provider = new NodeTracerProvider({ spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())] });
  provider.register();
  return provider;
}

const tracer = trace.getTracer("llm-job-search");

/** Runs `fn` in a span, so the SDK's call spans nest under it. A no-op without tracing. */
export function inSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Keywords outside the JSON Schema subset the API accepts. Zod still enforces them on the result. */
const UNSUPPORTED = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
]);
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

/**
 * A Zod schema as the JSON Schema that structured outputs and strict tools accept.
 * Unlike the SDK's zodOutputFormat it keeps `enum` and `const`. It forces
 * `additionalProperties: false`, and moves the limits the API can't enforce into the
 * description (`{maxLength: 400}`), so the model still sees them. Shared parts stay
 * inline: with `$ref`s, the grammar the API compiles for Facts is "too large" (a 400).
 */
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...json } = z.toJSONSchema(schema);
  return strict(json) as Record<string, unknown>;
}

function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  const limits: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const unsupported = UNSUPPORTED.has(key) || (key === "minItems" && (value as number) > 1) || (key === "format" && !FORMATS.has(value as string));
    if (unsupported) {
      // z.number().int() adds ±2^53 bounds; they say nothing to the model.
      if (Math.abs(value as number) !== Number.MAX_SAFE_INTEGER) limits.push(`${key}: ${JSON.stringify(value)}`);
    } else if (key === "properties") {
      // Keys here are names, not keywords: recurse into each schema only.
      out[key] = Object.fromEntries(Object.entries(value as object).map(([name, s]) => [name, strict(s)]));
    } else out[key] = strict(value);
  }
  if (out.type === "object") out.additionalProperties = false;
  if (limits.length) out.description = [out.description, `{${limits.join(", ")}}`].filter(Boolean).join(" ");
  return out;
}
