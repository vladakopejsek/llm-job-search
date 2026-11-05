/**
 * ⌘K: search everything and jump, or act. The server searches (applications,
 * postings, companies, past answers); a leading verb turns the results into
 * that action: "call card parc", "set next step parc", "pause kiln",
 * "snooze kiln". Full screen on the phone.
 */

import { addDays } from "@llm-job-search/core/lib/dates.ts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, ClipboardCopy, FileText, Moon, Phone, Play, Send, Sun, SunMoon, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, call } from "@/lib/api";
import { useSnooze } from "@/lib/decisions";
import { formatDate, todayIso } from "@/lib/format";
import { openPosting, setSearchOpen, useOverlays } from "@/lib/overlays";
import { setTheme } from "@/lib/theme";
import { useAction } from "@/lib/use-action";
import { useDebounced } from "@/lib/use-debounced";
import { searchQuery } from "./api.ts";

/** Verbs that change what picking a result does. */
const VERBS = ["call card", "set next step", "pause", "snooze"] as const;
type Verb = (typeof VERBS)[number];

function parse(input: string): { verb: Verb | null; term: string } {
  const lower = input.trimStart().toLowerCase();
  const verb = VERBS.find((v) => lower === v || lower.startsWith(`${v} `)) ?? null;
  return { verb, term: verb ? input.trimStart().slice(verb.length).trim() : input.trim() };
}

function Item({ icon, onSelect, children, value }: { icon: ReactNode; onSelect: () => void; children: ReactNode; value: string }) {
  return (
    <CommandItem value={value} onSelect={onSelect} className="gap-3">
      {icon}
      <span className="flex min-w-0 grow flex-col">{children}</span>
    </CommandItem>
  );
}

export function CommandPalette() {
  const { search: open } = useOverlays();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const { verb, term } = parse(input);
  const q = useDebounced(term, 200);
  const { data: found } = useQuery(searchQuery(q));
  // Only results for what's typed now: Enter on a previous search's first row would act on the wrong company.
  const data = q === term ? found : undefined;
  const snooze = useSnooze();
  const pause = useAction((id: number) => call(api.companies[":id"].watch.$post({ param: { id: String(id) }, json: { watched: false } })));

  const done = (then: () => void) => {
    setSearchOpen(false);
    setInput("");
    then();
  };
  // Fixed actions, filtered by what's typed (when no verb is).
  const actions = [
    { label: "Start deciding", icon: <Play />, run: () => navigate({ to: "/focus" }) },
    { label: "Start apply session", icon: <Send />, run: () => navigate({ to: "/apply", search: {} }) },
    { label: "Companies", icon: <Building2 />, run: () => navigate({ to: "/companies", search: {} }) },
    { label: "Theme: light", icon: <Sun />, run: () => setTheme("light") },
    { label: "Theme: dark", icon: <Moon />, run: () => setTheme("dark") },
    { label: "Theme: follow the system", icon: <SunMoon />, run: () => setTheme("system") },
  ].filter((a) => !verb && (!term || a.label.toLowerCase().includes(term.toLowerCase())));

  const applications = verb === "pause" || verb === "snooze" ? [] : (data?.applications ?? []);
  const postings = verb === null || verb === "snooze" ? (data?.postings ?? []) : [];
  const companies = verb === null || verb === "pause" ? (data?.companies ?? []) : [];
  const answers = verb === null ? (data?.answers ?? []) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setSearchOpen(o);
        if (!o) setInput("");
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 overflow-hidden p-0 sm:max-w-xl max-md:top-0 max-md:h-dvh max-md:max-w-none max-md:rounded-none max-md:border-0"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Applications, postings, companies, your past answers and actions</DialogDescription>
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group]]:px-2 [&_[cmdk-item]]:py-2.5">
          <CommandInput value={input} onValueChange={setInput} placeholder="Search, or: call card · set next step · pause · snooze…" />
          <CommandList className="max-md:max-h-none max-md:flex-1">
            {term.length >= 2 && <CommandEmpty>Nothing matches “{term}”.</CommandEmpty>}
            {actions.length > 0 && (
              <CommandGroup heading="Actions">
                {actions.map((a) => (
                  <Item key={a.label} value={a.label} icon={a.icon} onSelect={() => done(a.run)}>
                    {a.label}
                  </Item>
                ))}
              </CommandGroup>
            )}
            {applications.length > 0 && (
              <CommandGroup heading={verb === "call card" ? "Call card for" : verb === "set next step" ? "Set the next step of" : "Applications"}>
                {applications.map((a) => (
                  <Item
                    key={a.id}
                    value={`application-${a.id}`}
                    icon={verb === "call card" ? <Phone /> : <Users />}
                    onSelect={() =>
                      done(() =>
                        verb === "call card"
                          ? navigate({ to: "/call/$applicationId", params: { applicationId: String(a.id) } })
                          : navigate({ to: "/pipeline", search: { app: a.id } }),
                      )
                    }
                  >
                    <span className="truncate">
                      {a.company} <span className="text-muted-foreground">· {a.role}</span>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{a.stage.replace("_", " ")}</span>
                  </Item>
                ))}
              </CommandGroup>
            )}
            {postings.length > 0 && (
              <CommandGroup heading={verb === "snooze" ? "Snooze for a week" : "Postings"}>
                {postings.map((p) => (
                  <Item
                    key={p.id}
                    value={`posting-${p.id}`}
                    icon={<FileText />}
                    onSelect={() =>
                      done(() => {
                        if (verb !== "snooze") return openPosting(p.id);
                        const until = addDays(todayIso(), 7);
                        snooze.mutate([p.id, until], {
                          onSuccess: () => toast(`Snoozed ${p.company} until ${formatDate(until)}`),
                          onError: (e) => toast.error(e.message),
                        });
                      })
                    }
                  >
                    <span className="truncate">
                      {p.company} <span className="text-muted-foreground">· {p.title}</span>
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {[p.closed ? "closed" : p.verdict?.replace("_", " "), p.snippet.replace(/[⟦⟧]/g, "")].filter(Boolean).join(" · ")}
                    </span>
                  </Item>
                ))}
              </CommandGroup>
            )}
            {companies.length > 0 && (
              <CommandGroup heading={verb === "pause" ? "Stop watching" : "Companies"}>
                {companies.map((c) => (
                  <Item
                    key={c.id}
                    value={`company-${c.id}`}
                    icon={<Building2 />}
                    onSelect={() =>
                      done(() =>
                        verb === "pause"
                          ? pause.mutate([c.id], { onSuccess: () => toast(`Paused ${c.name}`), onError: (e) => toast.error(e.message) })
                          : navigate({ to: "/companies", search: { tab: c.status === "paused" ? "paused" : "active", q: c.name } }),
                      )
                    }
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {c.status} · {c.openPostings} open · {c.leads} leads
                    </span>
                  </Item>
                ))}
              </CommandGroup>
            )}
            {answers.length > 0 && (
              <CommandGroup heading="Past answers · copy">
                {answers.map((a) => (
                  <Item
                    key={`${a.applicationId}:${a.question}`}
                    value={`answer-${a.applicationId}-${a.question}`}
                    icon={<ClipboardCopy />}
                    onSelect={() =>
                      done(() =>
                        navigator.clipboard.writeText(a.answer).then(
                          () => toast("Answer copied"),
                          () => toast.error("The browser didn't allow copying"),
                        ),
                      )
                    }
                  >
                    <span className="truncate">{a.question}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {a.company} · {a.answer}
                    </span>
                  </Item>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
