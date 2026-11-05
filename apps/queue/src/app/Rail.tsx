/** Desktop navigation: a slim icon rail, with the last run's status as a dot on the logo. */
import { Link } from "@tanstack/react-router";
import { Moon, Search, Sun } from "lucide-react";
import { Dot } from "@/components/jr/Dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setSearchOpen } from "@/lib/overlays";
import type { lastRun } from "@/lib/run-status";
import { setTheme, useDark } from "@/lib/theme";
import { NAV } from "./nav.ts";

const item = "relative flex size-10 items-center justify-center rounded-[10px] text-muted-foreground hover:text-foreground";
// The active item: a lime bar at the rail's edge.
const active = "bg-muted text-foreground before:absolute before:inset-y-[11px] before:-left-3 before:w-0.5 before:rounded-full before:bg-primary";

function RailTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Rail({ run }: { run: ReturnType<typeof lastRun> | null }) {
  const dark = useDark();
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center gap-1 border-r pt-3.5 pb-4 md:flex print:hidden">
      <RailTip label={run?.label ?? "Job search"}>
        <Link
          to="/"
          className="relative mb-[18px] flex size-[34px] items-center justify-center rounded-[9px] bg-foreground font-mono font-bold text-background"
        >
          j{run && <Dot tone={run.tone} className="absolute -top-[3px] -right-[3px] size-2.5 border-2 border-background shadow-none" />}
        </Link>
      </RailTip>
      {NAV.map(({ to, label, icon: Icon }) => (
        <RailTip key={to} label={label}>
          <Link to={to} search={{}} aria-label={label} className={item} activeProps={{ className: active }} activeOptions={{ includeSearch: false }}>
            <Icon className="size-[18px]" />
          </Link>
        </RailTip>
      ))}
      <div className="grow" />
      <RailTip label="Search ⌘K">
        <button type="button" aria-label="Search" className={item} onClick={() => setSearchOpen(true)}>
          <Search className="size-[18px]" />
        </button>
      </RailTip>
      <RailTip label={dark ? "Light theme" : "Dark theme"}>
        <button
          type="button"
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          className={item}
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
        </button>
      </RailTip>
    </nav>
  );
}
