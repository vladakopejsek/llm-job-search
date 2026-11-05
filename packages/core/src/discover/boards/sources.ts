import { cocumaBoard } from "./cocuma.ts";
import { euRemoteJobsBoard } from "./euremotejobs.ts";
import { himalayasBoard } from "./himalayas.ts";
import { hnBoard } from "./hn.ts";
import { jobicyBoard } from "./jobicy.ts";
import { jobstackBoard } from "./jobstack.ts";
import { startupJobsBoard } from "./startupjobs.ts";
import type { BoardSource } from "./types.ts";

/**
 * Job boards scanned as a whole by `pnpm discover --boards`; national ones only
 * when they're the home country's. Boards whose terms forbid automated reading
 * aren't here: LinkedIn, Wellfound, Welcome to the Jungle and some national ones.
 */
export const BOARD_SOURCES: BoardSource[] = [startupJobsBoard, euRemoteJobsBoard, jobicyBoard, himalayasBoard, hnBoard, jobstackBoard, cocumaBoard];
