import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Facts } from "../agent/facts.ts";
import { PrepPack } from "../agent/prep.ts";
import type { WorkItem } from "../agent/work.ts";
import { costUsd, promptVersion } from "./calls.ts";
import { apiUsable, strictSchema } from "./client.ts";
import { postingMessage, schemaRetryMessage } from "./evaluate.ts";
import { problemMessage } from "./judge.ts";
import { judgeOnce, packLoop } from "./prep.ts";

type Node = Record<string, unknown>;

/** Union-typed and optional properties, which the API caps per request (16 and 24). */
function complexity(schema: Node) {
  let unions = 0;
  let optional = 0;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const n = node as Node;
    if (n.properties) {
      const required = new Set((n.required as string[]) ?? []);
      for (const [name, prop] of Object.entries(n.properties as Node)) {
        if ((prop as Node).anyOf || Array.isArray((prop as Node).type)) unions++;
        if (!required.has(name)) optional++;
      }
    }
    Object.values(n).forEach(walk);
  };
  walk(schema);
  return { unions, optional };
}

describe("strictSchema", () => {
  const schema = strictSchema(
    z
      .object({ name: z.string().max(80).describe("A name."), kind: z.enum(["a", "b"]), n: z.number().int(), tags: z.array(z.string()).max(3) })
      .strict(),
  );
  const props = schema.properties as Record<string, Node>;

  it("keeps enums and moves unsupported limits into the description", () => {
    expect(props.kind!.enum).toEqual(["a", "b"]);
    expect(props.name).toEqual({ type: "string", description: "A name. {maxLength: 80}" });
    expect(props.tags!.description).toBe("{maxItems: 3}");
    expect(props.n).toEqual({ type: "integer" });
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$schema).toBeUndefined();
  });

  it("keeps the evaluation and pack schemas within the API's limits", () => {
    for (const s of [Facts, PrepPack.omit({ postingId: true })]) {
      const schema = strictSchema(s);
      const { unions, optional } = complexity(schema);
      expect(unions).toBeLessThanOrEqual(16);
      expect(optional).toBeLessThanOrEqual(24);
      // The same Facts with $refs compiled to a grammar the API rejected as too large.
      expect(JSON.stringify(schema)).not.toContain("$ref");
    }
  });
});

describe("costUsd", () => {
  const usage = (u: Partial<Anthropic.Usage>) => ({ input_tokens: 0, output_tokens: 0, ...u }) as Anthropic.Usage;

  it("prices input, cache writes and reads, output and searches", () => {
    const cost = costUsd(
      "claude-opus-5-5",
      usage({
        input_tokens: 1000,
        output_tokens: 2000,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 3000,
        cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 0 },
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
      }),
    );
    // 1000×4 + 3000×5 + 10000×0.2 + 2000×20 = 61000 per million, plus 2 searches at a cent
    expect(cost).toBeCloseTo(0.081, 6);
  });

  it("charges Haiku 5.5 five times over 100k prompt tokens, and refuses unknown models", () => {
    expect(costUsd("claude-haiku-5-5", usage({ input_tokens: 200_000 }))).toBeCloseTo(0.1, 6);
    expect(() => costUsd("claude-nope", usage({}))).toThrow(/No prices/);
  });

  it("versions a prompt by its system text and schema together", () => {
    expect(promptVersion("a", { x: 1 })).toHaveLength(12);
    expect(promptVersion("a", { x: 1 })).not.toBe(promptVersion("a", { x: 2 }));
  });
});

describe("evaluation messages", () => {
  const item = {
    company: "Acme",
    title: "Engineer",
    location: null,
    workplace: "remote",
    url: "https://x",
    purpose: "audit",
    note: "",
    text: "Body",
  };

  it("labels purpose and leaves out an empty note", () => {
    const message = postingMessage(item as unknown as WorkItem);
    expect(message).toContain("purpose: audit");
    expect(message).not.toContain("note:");
    expect(message.endsWith("Posting text:\n\nBody")).toBe(true);
  });

  it("names schema errors by their place in the facts", () => {
    expect(schemaRetryMessage(["results.0.facts.fit.reason: Too big"])).toContain("- fit.reason: Too big");
  });
});

describe("packLoop", () => {
  const reply = (stop_reason: Anthropic.StopReason, content: unknown[] = []) => ({ stop_reason, content }) as Anthropic.Message;
  const submitCall = (id: string) => ({ type: "tool_use", id, name: "submit_pack", input: { id } });
  const script = (...responses: Anthropic.Message[]) => {
    const sent: Anthropic.MessageParam[][] = [];
    const send = async (messages: Anthropic.MessageParam[]) => {
      sent.push(structuredClone(messages));
      return responses.shift()!;
    };
    return { sent, send };
  };

  it("returns problems as tool results and stops once a submit is stored", async () => {
    const { send, sent } = script(reply("tool_use", [submitCall("a")]), reply("tool_use", [submitCall("b")]));
    const answers = ["unanswered question", null];
    expect(await packLoop(send, "lead", async () => answers.shift()!)).toEqual({ stored: true });
    expect(sent[1]!.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "a", is_error: true, content: "unanswered question" }],
    });
  });

  it("resends a paused turn unchanged and nudges once when the model stops without submitting", async () => {
    const { send, sent } = script(reply("pause_turn"), reply("end_turn"), reply("tool_use", [submitCall("a")]));
    expect(await packLoop(send, "lead", async () => null)).toEqual({ stored: true });
    expect(sent[1]!.at(-1)!.role).toBe("assistant");
    expect(sent[2]!.at(-1)).toEqual({ role: "user", content: "Call submit_pack with the complete pack." });
  });

  it("numbers the submits, so the claim judge can tell which one it's at", async () => {
    const attempts: number[] = [];
    const { send } = script(reply("tool_use", [submitCall("a")]), reply("tool_use", [submitCall("b")]));
    await packLoop(send, "lead", async (_input, attempt) => {
      attempts.push(attempt);
      return attempt === 1 ? "unsupported claim" : null;
    });
    expect(attempts).toEqual([1, 2]);
  });

  it("gives up after a second stop without a submit, a refusal, or four rejected submits", async () => {
    expect((await packLoop(script(reply("end_turn"), reply("end_turn")).send, "lead", async () => null)).reason).toBe("no submit_pack call");
    expect((await packLoop(script(reply("refusal")).send, "lead", async () => null)).reason).toBe("stop_reason refusal");
    const submits = script(...["a", "b", "c", "d"].map((id) => reply("tool_use", [submitCall(id)])));
    expect(await packLoop(submits.send, "lead", async () => "bad")).toEqual({ stored: false, reason: "not stored after 4 submits: bad" });
  });
});

describe("judgeOnce", () => {
  const pack = {} as PrepPack;

  it("judges the first submit that passes the code checks, and only that one", async () => {
    const review = vi.fn(async () => []);
    const at = judgeOnce(review);
    at(1); // the code checks failed: submitPrepPacks never called the judge
    await at(2)?.(pack);
    expect(at(3)).toBeUndefined();
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("doesn't judge a submit that leaves fewer than two after it", () => {
    expect(judgeOnce(async () => [])(3)).toBeUndefined();
  });
});

describe("problemMessage", () => {
  it("says where the claim is, what's wrong with it, and what to do", () => {
    const claim = {
      phrase: "the billing dashboard I led",
      verdict: "unsupported" as const,
      evidence: "the candidate built its first version; nothing says they led it",
    };
    expect(problemMessage({ section: "answer", question: "Why us?" }, claim)).toBe(
      'In the answer to "Why us?", "the billing dashboard I led" is unsupported: the candidate built its first version; nothing says they led it. Say only what the Answer bank or a cited quote backs.',
    );
  });
});

describe("apiUsable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /** The API answering every call with this error (bodies as in the API docs). A 1 ms retry-after keeps the SDK's retries instant. */
  const answer = (status: number, type: string, message: string, details?: object) =>
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ type: "error", error: { type, message, details } }), {
          status,
          headers: { "content-type": "application/json", "retry-after-ms": "1" },
        }),
    );

  it("is false when a spend limit is reached, so the run falls back to the subscription", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    answer(
      400,
      "invalid_request_error",
      "You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.",
    );
    expect(await apiUsable()).toBe(false);
    answer(429, "rate_limit_error", "You have reached your API usage limits: your organization has crossed its monthly API usage threshold.", {
      error_code: "enforced_spend_limit_reached",
    });
    expect(await apiUsable()).toBe(false);
  });

  it("throws on an ordinary rate limit, so a passing problem fails the run", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    answer(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit");
    await expect(apiUsable()).rejects.toThrow(/per-minute rate limit/);
  });
});
