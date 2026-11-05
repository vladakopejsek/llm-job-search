/** One tool call in an answer: its name and outcome as a chip that opens to the input (the SQL itself, for `sql`) and any error. */
import { ChevronRight, LoaderCircle } from "lucide-react";
import { Chip } from "@/components/jr/Chip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ToolPart } from "./use-ask.ts";

function outcome({ result }: ToolPart) {
  if (!result) return <LoaderCircle className="size-3 animate-spin" />;
  if (!result.ok) return "failed";
  if (result.rows === undefined) return result.truncated ? "cut" : "done";
  return `${result.rows}${result.truncated ? "+" : ""} ${result.rows === 1 ? "row" : "rows"}`;
}

export function ToolCallChip({ part }: { part: ToolPart }) {
  const input = part.input as { query?: unknown };
  const shown = part.name === "sql" && typeof input?.query === "string" ? input.query : JSON.stringify(part.input);
  return (
    <Collapsible>
      <CollapsibleTrigger className="group">
        <Chip tone={part.result && !part.result.ok ? "destructive" : "outline"} className="font-mono">
          <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
          {part.name}
          <span className="text-muted-foreground">{outcome(part)}</span>
        </Chip>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-2">
        <pre className="max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">{shown}</pre>
        {part.result?.error && <p className="text-xs text-destructive">{part.result.error}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
