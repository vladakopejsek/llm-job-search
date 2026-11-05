/** Phone navigation: Today, Pipeline, Search, and More (Companies, theme), clear of the home indicator. */
import { Link } from "@tanstack/react-router";
import { Building2, ChartNoAxesColumnDecreasing, Ellipsis, FlaskConical, Moon, Search, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { setSearchOpen } from "@/lib/overlays";
import { setTheme, useDark } from "@/lib/theme";

const tab = "group flex h-11 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground";
const icon = "size-[18px] group-data-[status=active]:text-primary-ink";

export function TabBar() {
  const [more, setMore] = useState(false);
  const dark = useDark();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t bg-background px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] md:hidden print:hidden"
    >
      <Link to="/" className={tab} activeProps={{ className: "text-foreground" }} activeOptions={{ includeSearch: false }}>
        <Sun className={icon} />
        Today
      </Link>
      <Link to="/pipeline" search={{}} className={tab} activeProps={{ className: "text-foreground" }} activeOptions={{ includeSearch: false }}>
        <ChartNoAxesColumnDecreasing className={icon} />
        Pipeline
      </Link>
      <button type="button" className={tab} onClick={() => setSearchOpen(true)}>
        <Search className={icon} />
        Search
      </button>
      <button type="button" className={tab} onClick={() => setMore(true)}>
        <Ellipsis className={icon} />
        More
      </button>
      <Drawer open={more} onOpenChange={setMore}>
        <DrawerContent>
          <DrawerTitle className="sr-only">More</DrawerTitle>
          <div className="flex flex-col gap-2 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),24px)]">
            <Button variant="ghost" size="lg" className="justify-start" asChild onClick={() => setMore(false)}>
              <Link to="/companies" search={{}}>
                <Building2 />
                Companies
              </Link>
            </Button>
            <Button variant="ghost" size="lg" className="justify-start" asChild onClick={() => setMore(false)}>
              <Link to="/lab">
                <FlaskConical />
                Lab
              </Link>
            </Button>
            <Button variant="ghost" size="lg" className="justify-start" onClick={() => setTheme(dark ? "light" : "dark")}>
              {dark ? <Sun /> : <Moon />}
              {dark ? "Light theme" : "Dark theme"}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
