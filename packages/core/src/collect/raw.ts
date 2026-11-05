import type { Ats } from "../ats/types.ts";

/**
 * The fields of each ATS's job object that hold the description (and, for
 * Recruitee, its translations). Their text is already in `descriptionText`, and
 * they are most of the object's size, so `raw` is stored without them.
 */
const DESCRIPTION_FIELDS: Partial<Record<Ats, readonly string[]>> = {
  ashby: ["descriptionHtml", "descriptionPlain"],
  bamboohr: ["description"],
  greenhouse: ["content"],
  lever: [
    "description",
    "descriptionPlain",
    "descriptionBody",
    "descriptionBodyPlain",
    "opening",
    "openingPlain",
    "lists",
    "additional",
    "additionalPlain",
  ],
  personio: ["jobDescriptions"],
  recruitee: ["description", "requirements", "translations"],
  startupjobs: ["description"],
  teamtailor: ["description"],
  workable: ["description"],
  workday: ["jobDescription"],
};

/** The ATS's job object without its description fields. */
export function withoutDescription(ats: Ats, raw: unknown): unknown {
  const fields = DESCRIPTION_FIELDS[ats];
  if (!fields || !raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !fields.includes(key)));
}
