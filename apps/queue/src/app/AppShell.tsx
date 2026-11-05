/** The frame around every new screen: rail on desktop, tab bar on the phone. */
import { useQuery } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { CommandPalette } from "@/features/search/CommandPalette";
import { PostingSheet } from "@/features/search/PostingSheet";
import { useHotkeys } from "@/lib/hotkeys";
import { setSearchOpen, useOverlays } from "@/lib/overlays";
import { overviewQuery } from "@/lib/queries";
import { lastRun } from "@/lib/run-status";
import { Rail } from "./Rail.tsx";
import { TabBar } from "./TabBar.tsx";

export function AppShell() {
  const { data } = useQuery(overviewQuery);
  // Focus puts its own action bar where the tab bar would be.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const focus = path === "/focus";
  const { search } = useOverlays();
  useHotkeys({ "mod+k": () => setSearchOpen(!search) });
  return (
    <div className="flex min-h-dvh">
      <Rail run={data ? lastRun(data.status) : null} />
      {/* Bottom padding: room for the phone's tab bar. */}
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <Outlet />
      </main>
      {!focus && <TabBar />}
      {/* In the apply session, above its footer. */}
      <CommandPalette />
      <PostingSheet />
      <Toaster position="bottom-left" offset={path === "/apply" ? { bottom: 96 } : undefined} />
    </div>
  );
}
