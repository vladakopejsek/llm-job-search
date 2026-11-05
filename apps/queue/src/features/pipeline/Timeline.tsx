/** Everything that happened, newest first, with a note field on top. */
import { useState } from "react";
import { toast } from "sonner";
import { Quote } from "@/components/jr/Quote";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ApplicationDetail, useAddNote } from "@/lib/applications";
import { formatDate } from "@/lib/format";
import { eventDetail, eventTitle } from "./timeline.ts";

export function Timeline({ applicationId, events }: { applicationId: number; events: ApplicationDetail["timeline"] }) {
  const addNote = useAddNote();
  const [text, setText] = useState("");
  return (
    <section className="flex flex-col gap-3">
      <h3 className="eyebrow">Timeline</h3>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = text;
          // Keep what was typed while the save was in flight.
          if (saved.trim())
            addNote.mutate([applicationId, saved.trim()], {
              onSuccess: () => setText((t) => (t.startsWith(saved) ? t.slice(saved.length).trimStart() : t)),
              onError: (e) => toast.error(e.message),
            });
        }}
      >
        <Input aria-label="Add a note" placeholder="Add a note…" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="outline" disabled={addNote.isPending || !text.trim()}>
          Add
        </Button>
      </form>
      <ol className="flex flex-col gap-3.5 text-[13px]">
        {events.map((e) => {
          const detail = eventDetail(e);
          return (
            <li key={e.id} className="grid grid-cols-[64px_1fr] gap-3">
              <span className="font-mono text-xs text-muted-foreground">{formatDate(e.occurredOn)}</span>
              <span className="flex flex-col gap-1">
                <b className="font-medium">{eventTitle(e)}</b>
                {detail &&
                  (detail.quote ? <Quote>{detail.text}</Quote> : <span className="whitespace-pre-line text-muted-foreground">{detail.text}</span>)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
