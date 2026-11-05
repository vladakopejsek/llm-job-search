import { ashby } from "./ashby.ts";
import { bamboohr } from "./bamboohr.ts";
import { greenhouse } from "./greenhouse.ts";
import { lever } from "./lever.ts";
import { personio } from "./personio.ts";
import { recruitee } from "./recruitee.ts";
import { startupjobs } from "./startupjobs.ts";
import { teamtailor } from "./teamtailor.ts";
import type { Ats, Collector } from "./types.ts";
import { workable } from "./workable.ts";
import { workday } from "./workday.ts";

const COLLECTORS: Partial<Record<Ats, Collector>> = {
  ashby,
  greenhouse,
  lever,
  workable,
  teamtailor,
  personio,
  recruitee,
  startupjobs,
  workday,
  bamboohr,
};

/** The collector for an ATS, or undefined if we don't support it yet. */
export function collectorFor(ats: Ats): Collector | undefined {
  return COLLECTORS[ats];
}

export { parseFeedUrl } from "./feed-url.ts";
export * from "./types.ts";
