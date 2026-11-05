/**
 * Companies: which are collected (watched), set aside (paused) or suggested
 * by discovery. Priority decides what comes first everywhere. Broken feeds
 * are fixed from the terminal with `pnpm company`.
 */
import { COMPANY_LIST_LIMIT, COMPANY_TABS, type CompanyTab } from "@llm-job-search/core/watchlist/filters.ts";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebounced } from "@/lib/use-debounced";
import { type CompanyRow, companiesQuery, usePriority, usePromote, useWatch } from "./api.ts";

const route = getRouteApi("/companies");
const TAB_LABELS: Record<CompanyTab, string> = { active: "Watched", paused: "Paused", discovered: "Discovered" };

function status(c: CompanyRow) {
  if (c.inProcess) return "in process · others wait";
  if (c.health.failing) return "feed failing";
  if (c.health.stale) return c.health.daysSinceNewest === null ? "no open roles" : `no new roles in ${c.health.daysSinceNewest} days`;
  return null;
}

function WatchedRow({ c }: { c: CompanyRow }) {
  const watch = useWatch();
  const priority = usePriority();
  const note = status(c);
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 border-t px-4 py-3 first:border-t-0 md:grid-cols-[200px_110px_120px_130px_1fr_auto] md:px-5 md:py-2.5">
      <span className="truncate font-semibold">{c.name}</span>
      <span className="font-mono text-xs text-muted-foreground max-md:hidden">{c.ats}</span>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={c.priority ?? ""}
        onValueChange={(p) => p && priority.mutate([c.id, p as "A" | "B" | "C"])}
        aria-label={`Priority of ${c.name}`}
        className="max-md:order-3"
      >
        {(["A", "B", "C"] as const).map((p) => (
          <ToggleGroupItem key={p} value={p} className="w-8 font-mono text-xs">
            {p}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="font-mono text-xs whitespace-nowrap text-muted-foreground max-md:order-4">
        {c.openPostings} open · {c.leads} leads
      </span>
      <span className={`truncate text-xs max-md:order-5 max-md:col-span-2 ${c.health.failing ? "text-warning" : "text-muted-foreground"}`}>
        {note}
      </span>
      <Switch
        checked={c.status === "active"}
        disabled={watch.isPending}
        onCheckedChange={(on) => watch.mutate([c.id, on])}
        aria-label={`Watch ${c.name}`}
        className="justify-self-end max-md:order-2"
      />
    </li>
  );
}

function DiscoveredRow({ c }: { c: CompanyRow }) {
  const promote = usePromote();
  return (
    <li className="flex flex-col gap-1.5 border-t px-4 py-3 first:border-t-0 md:flex-row md:items-center md:gap-4 md:px-5">
      <div className="flex grow flex-col gap-0.5">
        <span className="font-semibold">
          {c.name} <span className="font-mono text-xs font-normal text-muted-foreground">{c.ats}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {[`${c.discoveredTitles ?? 0} matching roles`, c.sampleTitles?.join(", "), c.sampleLocations?.join(", ")].filter(Boolean).join(" · ")}
        </span>
      </div>
      <Button variant="outline" size="sm" className="self-start md:self-auto" disabled={promote.isPending} onClick={() => promote.mutate([c.id])}>
        Promote
      </Button>
    </li>
  );
}

export function CompaniesPage() {
  const { tab, q } = route.useSearch();
  const navigate = route.useNavigate();
  const [text, setText] = useState(q ?? "");
  // A q set from outside (⌘K's "jump to company") replaces what's in the box, instead of being undone by it.
  const [seen, setSeen] = useState(q);
  if (q !== seen) {
    setSeen(q);
    setText(q ?? "");
  }
  const debounced = useDebounced(text);
  useEffect(() => {
    if (debounced === text && debounced !== (q ?? "")) void navigate({ search: (s) => ({ ...s, q: debounced || undefined }), replace: true });
  }, [debounced, text, q, navigate]);
  const { data, error } = useQuery(companiesQuery(tab, q ?? ""));

  return (
    <>
      <header className="flex flex-wrap items-center gap-3.5 border-b px-4 py-3 md:h-[60px] md:flex-nowrap md:px-8 md:py-0">
        <h1 className="text-base font-semibold md:text-[15px]">Companies</h1>
        <div className="grow" />
        <label className="relative w-full md:w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find a company…" aria-label="Find a company" className="pl-8" />
        </label>
      </header>
      <div className="flex max-w-[1100px] flex-col gap-4 px-4 py-5 md:px-10 md:py-8">
        <Tabs value={tab} onValueChange={(t) => navigate({ search: (s) => ({ ...s, tab: t as CompanyTab }) })}>
          <TabsList>
            {COMPANY_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]} <span className="font-mono text-xs text-muted-foreground">{data?.counts[t] ?? ""}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {tab === "active" && data && data.failing.length > 0 && (
          <p className="text-sm text-warning">
            {data.failing.length} {data.failing.length === 1 ? "feed is" : "feeds are"} failing ({data.failing.join(", ")}). Fix one with{" "}
            <code className="font-mono text-xs">pnpm company feed "Name" &lt;board URL&gt;</code>.
          </p>
        )}
        {error && <p className="text-destructive">{error.message}</p>}
        {data &&
          (data.rows.length ? (
            <ul className="overflow-hidden rounded-xl border bg-card">
              {data.rows.map((c) => (tab === "discovered" ? <DiscoveredRow key={c.id} c={c} /> : <WatchedRow key={c.id} c={c} />))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{q ? `No ${TAB_LABELS[tab].toLowerCase()} company matches “${q}”.` : "None."}</p>
          ))}
        {data && data.rows.length >= COMPANY_LIST_LIMIT && (
          <p className="text-xs text-muted-foreground">The first {COMPANY_LIST_LIMIT}; search to find the others.</p>
        )}
      </div>
    </>
  );
}
