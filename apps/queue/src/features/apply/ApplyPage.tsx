/**
 * The apply session: the shortlist one posting at a time, at the desk. Copy
 * each drafted answer into the company's form (C), then Log applied (⌘↵).
 * Skip (N) records why; Not now leaves it on the shortlist.
 */

import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Check, ChevronLeft, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/jr/Chip";
import { AlreadyAppliedSheet, OtherRoleSheet } from "@/components/SkipDetails";
import { SkipSheet } from "@/components/SkipSheet";
import { Button } from "@/components/ui/button";
import { useLogApplied, useSkip } from "@/lib/decisions";
import { skipText } from "@/lib/labels";
import { overviewQuery } from "@/lib/queries";
import type { SubmissionDraft } from "@/lib/submission";
import { useDesktop } from "@/lib/use-desktop";
import { useStack } from "@/lib/use-stack";
import { cn } from "@/lib/utils";
import { type Logged, Step } from "./Step.tsx";

const route = getRouteApi("/apply");

/** Minutes since the session started, for the header and the summary. */
function useMinutes(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return Math.round((now - since) / 60_000);
}

function PhoneNote({ shortlist }: { shortlist: { postingId: number; company: string; title: string }[] }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6">
      <p className="flex items-center gap-2 text-muted-foreground">
        <Monitor className="size-4" />
        Applying happens at your desk, where the company's form is.
      </p>
      <ul className="border-t">
        {shortlist.map((l) => (
          <li key={l.postingId} className="flex h-11 items-center gap-2.5 border-b">
            <span className="font-medium">{l.company}</span>
            <span className="truncate text-muted-foreground">{l.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApplyPage() {
  const { posting } = route.useSearch();
  const { data, error } = useQuery(overviewQuery);
  const stack = useStack(data?.shortlist, posting);
  const [startedAt] = useState(Date.now);
  const minutes = useMinutes(startedAt);
  const [forms, setForms] = useState<Record<number, SubmissionDraft>>({});
  const [copied, setCopied] = useState<Record<number, ReadonlySet<number>>>({});
  const [applied, setApplied] = useState(0);
  const [sheet, setSheet] = useState<"skip" | "already_applied" | "other_role" | null>(null);
  const logApplied = useLogApplied();
  const skip = useSkip();
  const desktop = useDesktop();
  const lead = stack.current;

  if (!desktop) return data ? <PhoneNote shortlist={data.shortlist} /> : null;

  const done = (message: string) => {
    if (!lead) return;
    toast(message);
    stack.markDecided(lead.postingId);
    setSheet(null);
  };
  const log = (logged: Logged) => {
    if (!lead) return;
    logApplied.mutateAsync([lead.postingId, logged]).then(
      () => {
        setApplied((n) => n + 1);
        done(`Logged ${lead.company} · applied`);
      },
      (e: Error) => toast.error(e.message),
    );
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3.5 border-b px-8">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ChevronLeft />
            Today
          </Link>
        </Button>
        <h1 className="text-[15px] font-semibold">Apply session</h1>
        <ol className="ml-2 flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {stack.all.map(({ id, item, done }, i) => (
            <li key={id}>
              <button type="button" disabled={done || !item} onClick={() => stack.show(id)}>
                <Chip tone={id === lead?.postingId ? "go" : "outline"} className={cn(done && "opacity-50")}>
                  {done ? <Check className="size-3" /> : <span className="font-mono">{i + 1}</span>}
                  {item?.company ?? "done"}
                  {item && !item.pack && <span className="text-muted-foreground">· no pack</span>}
                </Chip>
              </button>
            </li>
          ))}
        </ol>
        <div className="grow" />
        <span className="font-mono text-xs text-muted-foreground">session {minutes} min</span>
      </header>

      {error && <p className="px-8 pt-6 text-destructive">Couldn't load the shortlist: {error.message}</p>}
      {data && !lead && (
        <div className="mx-auto flex max-w-[920px] flex-col items-start gap-4 px-8 pt-16">
          <p className="eyebrow">Apply session</p>
          <h2 className="text-[44px] leading-[1.08] font-semibold tracking-[-0.035em]">
            {applied ? `${applied} applied in ${minutes} min.` : stack.total ? "Shortlist done." : "Nothing on your shortlist."}
          </h2>
          <Button variant="outline" size="lg" asChild>
            <Link to="/">Back to Today</Link>
          </Button>
        </div>
      )}
      {lead && (
        <Step
          key={lead.postingId}
          lead={lead}
          form={forms[lead.postingId]}
          setForm={(form) => setForms((f) => ({ ...f, [lead.postingId]: form }))}
          copied={copied[lead.postingId] ?? new Set()}
          onCopied={(key) => setCopied((c) => ({ ...c, [lead.postingId]: new Set(c[lead.postingId]).add(key) }))}
          keys={sheet === null}
          logging={logApplied.isPending}
          onLog={log}
          onSkip={() => setSheet("skip")}
          onNotNow={() => done(`${lead.company} stays on your shortlist`)}
        />
      )}

      {lead && (
        <>
          <SkipSheet
            posting={lead}
            open={sheet === "skip"}
            onOpenChange={(open) => !open && setSheet(null)}
            onSkip={(reason) =>
              skip.mutateAsync([lead.postingId, reason]).then(
                () => done(`Skipped ${lead.company}: ${skipText(reason)}`),
                (e: Error) => toast.error(e.message),
              )
            }
            onAlreadyApplied={() => setSheet("already_applied")}
            onOtherRole={() => setSheet("other_role")}
          />
          <AlreadyAppliedSheet posting={lead} open={sheet === "already_applied"} onOpenChange={(open) => !open && setSheet(null)} onDone={done} />
          <OtherRoleSheet posting={lead} open={sheet === "other_role"} onOpenChange={(open) => !open && setSheet(null)} onDone={done} />
        </>
      )}
    </div>
  );
}
