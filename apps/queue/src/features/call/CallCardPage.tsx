/**
 * The call card: what to have in front of you during a screening or an
 * interview, readable on the phone. Notes taken here go to the timeline as a
 * call note. Print A4 gives the same card on one light page.
 */
import { CHANNEL_LABELS, type Channel } from "@llm-job-search/core/applications/constants.ts";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ChevronLeft, Printer } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Quote } from "@/components/jr/Quote";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { applicationQuery, useAddNote } from "@/lib/applications";
import { formatDate, formatWhen, todayIso } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/labels";
import { wordCount } from "@/lib/submission";

const route = getRouteApi("/call/$applicationId");

function Section({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-3 break-inside-avoid ${className ?? ""}`}>
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

export function CallCardPage() {
  const id = Number(route.useParams().applicationId);
  const { data, error } = useQuery(applicationQuery(id));
  const addNote = useAddNote();
  const [notes, setNotes] = useState("");
  if (error) return <p className="p-8 text-destructive">{error.message}</p>;
  if (!data) return null;

  const a = data.application;
  const tp = data.talkingPoints;
  const sent = data.submission;
  // Today's call stays up through the call: the card is open while it happens.
  const upcoming = a.nextStepAt && new Date(a.nextStepAt).toLocaleDateString("sv-SE") >= todayIso();

  return (
    <>
      <header className="flex h-14 items-center gap-3.5 px-2 md:h-[60px] md:border-b md:px-8 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pipeline" search={{ app: a.id }}>
            <ChevronLeft />
            {a.company}
          </Link>
        </Button>
        <h1 className="text-[15px] font-semibold">Call card</h1>
        <div className="grow" />
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => window.print()}>
          <Printer />
          Print A4
        </Button>
      </header>

      <div className="mx-auto flex max-w-[1120px] flex-col gap-7 px-4 py-4 md:gap-8 md:px-8 md:py-11 print:max-w-none print:gap-5 print:p-0">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-6">
          <div className="flex grow flex-col gap-2.5 md:gap-3">
            <p className="eyebrow">{[a.company, STAGE_LABELS[a.stage], upcoming && a.nextStepKind].filter(Boolean).join(" · ")}</p>
            <h2 className="text-[30px] leading-[1.08] font-semibold tracking-[-0.035em] md:text-[44px] print:text-[28px]">{a.role}</h2>
            {upcoming && (
              <p className="text-[15px]">
                <span className="font-mono">{formatWhen(a.nextStepAt!)}</span>
                {a.nextStepWith && <span className="text-muted-foreground"> with {a.nextStepWith}</span>}
              </p>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground md:text-right">
            {[a.appliedOn && `applied ${formatDate(a.appliedOn)}`, a.channel && CHANNEL_LABELS[a.channel as Channel]?.toLowerCase()]
              .filter(Boolean)
              .join(" · ")}
            {sent?.salaryStated && (
              <>
                <br />
                you said <span className="text-foreground">{sent.salaryStated}</span>
              </>
            )}
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-10 print:grid-cols-[2fr_1fr] print:gap-6">
          <div className="flex flex-col gap-7 md:gap-8 print:gap-5">
            {tp ? (
              <>
                <Section title="30-second pitch">
                  <p className="text-lg leading-[1.45] tracking-[-0.01em] md:text-[21px] print:text-base">{tp.summary}</p>
                </Section>
                <div className="grid gap-7 md:grid-cols-2 print:grid-cols-2 print:gap-5">
                  <Section title="Why you fit">
                    <ul className="flex flex-col gap-2.5 text-[15px] print:text-sm">
                      {tp.whyFit.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Section>
                  <Section title="Gaps → say this">
                    <ul className="flex flex-col gap-3 text-[15px] print:text-sm">
                      {tp.gaps.map((g) => (
                        <li key={g.gap}>
                          <b className="font-medium">{g.gap}</b> <span className="text-muted-foreground">“{g.sayThis}”</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                </div>
                {tp.askThem.length > 0 && (
                  <Section title="Ask them">
                    <ol className="grid gap-x-7 gap-y-2.5 text-[15px] md:grid-cols-2 print:grid-cols-2 print:text-sm">
                      {tp.askThem.map((q, i) => (
                        <li key={q}>
                          <span className="font-mono text-muted-foreground">{i + 1} </span>
                          {q}
                        </li>
                      ))}
                    </ol>
                  </Section>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No prep pack for this application: nothing drafted to rehearse. What you sent is on the right.</p>
            )}
          </div>

          <aside className="flex flex-col gap-6">
            <Section title="What you told them" className="rounded-xl border bg-card px-5 py-[18px]">
              {sent ? (
                <>
                  {sent.answers.slice(0, 4).map((ans) => (
                    <p key={ans.id} className="text-[13px]">
                      <span className="text-muted-foreground">{ans.question} </span>
                      <span className="line-clamp-4 print:line-clamp-none">{ans.answer}</span>
                    </p>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    {sent.answers.length > 4 && `+ ${sent.answers.length - 4} more answers · `}
                    {sent.coverLetter ? `cover letter, ${wordCount(sent.coverLetter)} words` : "no cover letter"}
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">Nothing logged for this application.</p>
              )}
            </Section>
            {tp && tp.whyUs.length > 0 && (
              <Section title="Why them">
                {tp.whyUs.map((w) => (
                  <Quote key={w}>{w}</Quote>
                ))}
              </Section>
            )}
            <section className="flex flex-col gap-2.5 print:hidden">
              <label htmlFor="call-notes" className="eyebrow">
                Notes during the call
              </label>
              <Textarea
                id="call-notes"
                rows={7}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Saved to the timeline as a call note…"
              />
              <Button
                variant="outline"
                className="self-start"
                disabled={!notes.trim() || addNote.isPending}
                onClick={() => {
                  const saved = notes;
                  addNote.mutate([a.id, saved.trim(), "call"], {
                    onSuccess: () => {
                      // Keep what was typed while the save was in flight.
                      setNotes((n) => (n.startsWith(saved) ? n.slice(saved.length).trimStart() : n));
                      toast("Saved to the timeline");
                    },
                    onError: (e) => toast.error(e.message),
                  });
                }}
              >
                Save to timeline
              </Button>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
