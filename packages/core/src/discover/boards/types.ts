import type { Board, NormalizedPosting } from "../../ats/types.ts";

/**
 * A role found on a job board, at a company we may not watch yet. `board` is
 * where the company gets collected from once it's watched: its own page on the
 * job board, or its ATS when the board links there. Null when the board names
 * only the company; discovery then looks for its ATS board (resolve.ts).
 */
export interface BoardRole {
  company: string;
  /** The company's id on the job board, a likely ATS token too ("fxcintel"). */
  companySlug?: string;
  board: Board | null;
  /** The company's page a person would open: its ATS board, or its page on the job board. */
  companyUrl: string;
  /** Prefixed with the source's name, so each source cleans up only its own roles. */
  postingKey: string;
  posting: NormalizedPosting;
}

interface BoardScan {
  /** Posting keys of every role the board lists now, read or not: what's no longer listed is gone. Empty when the board can't say (a search). */
  listed: Set<string>;
  /** Roles read in full this time. */
  roles: BoardRole[];
  /** Roles read whose apply link isn't on an ATS we collect, so their company can't be watched. */
  uncollectable: number;
  errors: string[];
}

/** A job board scanned as a whole, so a company that posts a good role there gets found the same day. */
export interface BoardSource {
  /** Short id: the prefix of its roles' posting keys. */
  name: string;
  label: string;
  /** Its data changes once a day, so only the morning scan reads it (`pnpm discover --boards --daily`). */
  daily?: boolean;
  /** A national board, read only when this is the search config's home country (an ISO code). */
  country?: string;
  /** `known` tells which posting keys are already stored, so the source can skip reading them again. */
  scan(known: (postingKey: string) => boolean): Promise<BoardScan>;
}
