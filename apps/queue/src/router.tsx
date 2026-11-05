/**
 * Every page of the app, declared in one place so links between them are
 * type-checked. Search params (a range, a search, the open application) are
 * checked by Zod, so a view can be bookmarked and reloaded; defaults are left
 * out of URLs.
 */
import { STATS_RANGES } from "@llm-job-search/core/tracker/filters.ts";
import { COMPANY_TABS } from "@llm-job-search/core/watchlist/filters.ts";
import { createRootRoute, createRoute, createRouter, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "./app/AppShell.tsx";
import { ApplyPage } from "./features/apply/ApplyPage.tsx";
import { AskPage } from "./features/ask/AskPage.tsx";
import { CallCardPage } from "./features/call/CallCardPage.tsx";
import { CompaniesPage } from "./features/companies/CompaniesPage.tsx";
import { FocusPage } from "./features/focus/FocusPage.tsx";
import { LabPage } from "./features/lab/LabPage.tsx";
import { PipelinePage } from "./features/pipeline/PipelinePage.tsx";
import { TodayPage } from "./features/today/TodayPage.tsx";

const root = createRootRoute({ component: AppShell });

const today = createRoute({ getParentRoute: () => root, path: "/", component: TodayPage });
const focus = createRoute({ getParentRoute: () => root, path: "/focus", component: FocusPage });
// ?posting=<id>: start the session at that posting.
const apply = createRoute({
  getParentRoute: () => root,
  path: "/apply",
  validateSearch: z.object({ posting: z.number().int().optional().catch(undefined) }),
  component: ApplyPage,
});
const pipeline = createRoute({
  getParentRoute: () => root,
  path: "/pipeline",
  validateSearch: z.object({
    range: z.enum(STATS_RANGES).default("90d").catch("90d"),
    q: z.string().optional().catch(undefined),
    /** The application open in the sheet. */
    app: z.number().int().optional().catch(undefined),
  }),
  search: { middlewares: [stripSearchParams({ range: "90d" as const })] },
  component: PipelinePage,
});
const callCard = createRoute({ getParentRoute: () => root, path: "/call/$applicationId", component: CallCardPage });
const companies = createRoute({
  getParentRoute: () => root,
  path: "/companies",
  validateSearch: z.object({ tab: z.enum(COMPANY_TABS).default("active").catch("active"), q: z.string().optional().catch(undefined) }),
  search: { middlewares: [stripSearchParams({ tab: "active" as const })] },
  component: CompaniesPage,
});

const lab = createRoute({ getParentRoute: () => root, path: "/lab", component: LabPage });
const askPage = createRoute({ getParentRoute: () => root, path: "/ask", component: AskPage });

export const router = createRouter({
  routeTree: root.addChildren([today, focus, apply, pipeline, callCard, companies, lab, askPage]),
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
