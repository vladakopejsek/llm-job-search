export const ATS_TYPES = [
  "ashby",
  "greenhouse",
  "lever",
  "workable",
  "recruitee",
  "teamtailor",
  "personio",
  "smartrecruiters",
  "startupjobs",
  "workday",
  "bamboohr",
  "other",
  "none",
] as const;
export type Ats = (typeof ATS_TYPES)[number];

/** A company's job board, as much as a collector needs to fetch it. */
export interface Board {
  ats: Ats;
  token: string;
  /** API host; differs for EU-hosted Greenhouse and Lever boards. */
  host: string;
}

/**
 * One posting, normalised across ATSs. Collectors only reshape what the API
 * returns; they make no judgement about the role.
 */
export interface NormalizedPosting {
  externalId: string;
  url: string;
  title: string;
  /** Location text as the ATS shows it, e.g. "Remote - Europe" or "London, Stockholm". */
  locationRaw: string | null;
  /** The ATS's own remote/hybrid/onsite flag, when it has one. */
  workplaceRaw: string | null;
  department: string | null;
  /** Full description as plain text. This is what later LLM steps read. */
  descriptionText: string;
  compensationRaw: unknown;
  postedAt: Date | null;
  /** The ATS's original job object, kept so nothing is lost to normalisation. Stored without its description fields (src/collect/raw.ts). */
  raw: unknown;
}

export interface Collector {
  ats: Ats;
  fetchPostings(board: Board): Promise<NormalizedPosting[]>;
}

/** A fetch or parse failure for one board. The run records it and moves on. */
export class CollectorError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CollectorError";
  }
}
