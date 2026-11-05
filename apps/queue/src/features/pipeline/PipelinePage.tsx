/**
 * Pipeline: how the search is going, and every application by where it
 * stands. The range, the search and the open application live in the URL,
 * so a view can be bookmarked and Back closes the sheet.
 */
import { STATS_RANGES } from "@llm-job-search/core/tracker/filters.ts";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { overviewQuery, statsQuery } from "@/lib/queries";
import { useDebounced } from "@/lib/use-debounced";
import { ApplicationSheet } from "./ApplicationSheet.tsx";
import { pipelineQuery } from "./api.ts";
import { PipelineList } from "./PipelineList.tsx";
import { Funnel, Tiles } from "./PipelineStats.tsx";

const route = getRouteApi("/pipeline");
const RANGE_TEXT = { "30d": "30d", "90d": "90d", all: "All" } as const;

export function PipelinePage() {
  const { range, q, app } = route.useSearch();
  const navigate = route.useNavigate();
  const [text, setText] = useState(q);
  const debounced = useDebounced(text);
  useEffect(() => {
    if (debounced !== q) void navigate({ search: (s) => ({ ...s, q: debounced || undefined }), replace: true });
  }, [debounced, q, navigate]);

  const stats = useQuery(statsQuery(range));
  const list = useQuery(pipelineQuery(q ?? ""));
  const rows = list.data ?? [];
  const overview = useQuery(overviewQuery);
  const followUpDue = new Set(overview.data?.followUps.map((f) => f.applicationId));

  return (
    <>
      <header className="flex flex-wrap items-center gap-3.5 border-b px-4 py-3 md:h-[60px] md:flex-nowrap md:px-8 md:py-0">
        <h1 className="text-base font-semibold md:text-[15px]">Pipeline</h1>
        <span className="font-mono text-xs text-muted-foreground">{list.data ? `${rows.length} applications` : ""}</span>
        <div className="grow" />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={range}
          onValueChange={(value) => value && navigate({ search: (s) => ({ ...s, range: value as (typeof STATS_RANGES)[number] }), replace: true })}
          aria-label="Range"
        >
          {STATS_RANGES.map((r) => (
            <ToggleGroupItem key={r} value={r} className="font-mono text-xs">
              {RANGE_TEXT[r]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <label className="relative w-full md:w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text ?? ""}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search what you sent…"
            aria-label="Search applications"
            className="pl-8"
          />
        </label>
      </header>

      <div className="flex max-w-[1100px] flex-col gap-5 px-4 py-5 md:gap-6 md:px-10 md:py-8">
        {stats.data && <Tiles stats={stats.data} />}
        {stats.data && !q && <Funnel stats={stats.data} />}
        {list.error && <p className="text-destructive">Couldn't load applications: {list.error.message}</p>}
        {list.data &&
          (rows.length ? (
            <PipelineList rows={rows} followUpDue={followUpDue} />
          ) : (
            <p className="text-muted-foreground">{q ? `Nothing you sent matches “${q}”.` : "No applications yet."}</p>
          ))}
      </div>

      <ApplicationSheet id={app} row={rows.find((r) => r.id === app)} onClose={() => navigate({ search: (s) => ({ ...s, app: undefined }) })} />
    </>
  );
}
