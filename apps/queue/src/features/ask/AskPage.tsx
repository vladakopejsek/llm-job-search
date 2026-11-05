/**
 * Ask: a question about the search, answered by Claude with read-only tools over the
 * database, every tool call shown. On the API while there's credit, otherwise on the
 * subscription; the badge under each answer says which.
 */
import { useState } from "react";
import { Chip } from "@/components/jr/Chip";
import { KeyHint } from "@/components/jr/KeyHint";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToolCallChip } from "./ToolCallChip.tsx";
import { type Turn, useAsk } from "./use-ask.ts";

function Meta({ turn }: { turn: Turn }) {
  if (!turn.runtime) return null;
  const parts = [turn.runtime === "api" ? "API" : "Subscription"];
  if (turn.done) {
    if (turn.done.costUsd !== null) parts.push(`${turn.runtime === "api" ? "" : "≈ "}$${turn.done.costUsd.toFixed(3)}`);
    parts.push(`${Math.round(turn.done.ms / 1000)} s`);
  }
  return (
    <Chip tone="solid" className="font-mono">
      {parts.join(" · ")}
    </Chip>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <article className="flex flex-col items-start gap-3">
      <h2 className="text-[15px] font-semibold">{turn.question}</h2>
      {turn.parts.map((part, i) =>
        part.type === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts only ever get appended
          <p key={i} className="text-[15px] leading-relaxed whitespace-pre-wrap">
            {part.text}
          </p>
        ) : (
          <ToolCallChip key={part.id} part={part} />
        ),
      )}
      {turn.pending && !turn.parts.length && <p className="text-sm text-muted-foreground">Thinking…</p>}
      {turn.error && <p className="text-sm text-destructive">{turn.error}</p>}
      <Meta turn={turn} />
    </article>
  );
}

export function AskPage() {
  const { turns, busy, send, stop, reset } = useAsk();
  const [question, setQuestion] = useState("");

  const submit = () => {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    void send(q);
  };

  return (
    <>
      <header className="flex h-14 items-center gap-3.5 border-b px-4 md:h-[60px] md:px-8">
        <h1 className="text-base font-semibold md:text-[15px]">Ask</h1>
        <span className="text-xs text-muted-foreground">Claude reads your search through read-only tools</span>
        <div className="grow" />
        {turns.length > 0 && (
          <Button variant="ghost" size="sm" onClick={reset}>
            New conversation
          </Button>
        )}
      </header>
      <div className="flex max-w-[820px] flex-col gap-8 px-4 py-6 md:px-12 md:py-10">
        {turns.map((turn, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: turns only ever get appended
          <TurnView key={i} turn={turn} />
        ))}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder={turns.length ? "Ask a follow-up…" : "How many applications got a reply in October, by channel?"}
            aria-label="Question"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            {busy ? (
              <Button type="button" variant="outline" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button type="submit" disabled={!question.trim()}>
                Ask <KeyHint>⌘↵</KeyHint>
              </Button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
