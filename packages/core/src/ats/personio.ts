import { z } from "zod";
import { fetchText } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import { parseXml } from "../lib/xml.ts";
import { parseResponse } from "./parse.ts";
import { type Board, type Collector, CollectorError, type NormalizedPosting } from "./types.ts";

const PersonioPosition = z.object({
  id: z.string(),
  name: z.string(),
  office: z.string().optional(),
  additionalOffices: z
    .object({ office: z.array(z.string()) })
    .or(z.literal(""))
    .optional(),
  department: z.string().optional(),
  createdAt: z.string().optional(),
  /** Sections like "Your mission" / "Your profile", each with an HTML value. */
  jobDescriptions: z
    .object({ jobDescription: z.array(z.object({ name: z.string().optional(), value: z.string().optional() })) })
    .or(z.literal(""))
    .optional(),
});

const PersonioXml = z.object({ "workzag-jobs": z.object({ position: z.array(z.unknown()).optional() }).or(z.literal("")) });

export function normalizePersonio(xml: string, board: Pick<Board, "host">): NormalizedPosting[] {
  const parsed = parseResponse(
    PersonioXml,
    parseXml(xml, ["position", "jobDescription", "workzag-jobs.position.additionalOffices.office"], "Personio feed"),
    "Personio feed",
  );
  const positions = parsed["workzag-jobs"] === "" ? [] : (parsed["workzag-jobs"].position ?? []);

  return positions.map((raw) => {
    const position = parseResponse(PersonioPosition, raw, "Personio position");
    const offices = [position.office, ...(position.additionalOffices ? position.additionalOffices.office : [])].filter((o): o is string => !!o);
    const sections = position.jobDescriptions ? position.jobDescriptions.jobDescription : [];

    return {
      externalId: position.id,
      url: `https://${board.host}/job/${position.id}?language=en`,
      title: position.name,
      locationRaw: [...new Set(offices)].join("; ") || null,
      workplaceRaw: null, // Personio's feed has no remote flag; offices named "Remote" land in the location.
      department: position.department || null,
      descriptionText: sections
        .map((s) => [s.name, s.value ? htmlToText(s.value) : ""].filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n"),
      compensationRaw: null,
      postedAt: position.createdAt ? new Date(position.createdAt) : null,
      raw,
    };
  });
}

export const personio: Collector = {
  ats: "personio",
  async fetchPostings(board: Board) {
    try {
      // A board that no longer exists redirects to personio.com's homepage (which
      // then answers bots with 429), so don't follow redirects: one means "gone".
      const { body } = await fetchText(`https://${board.host}/xml?language=en`, "application/xml", { followRedirects: false });
      return normalizePersonio(body, board);
    } catch (error) {
      if (error instanceof CollectorError && error.httpStatus && error.httpStatus >= 300 && error.httpStatus < 400) {
        throw new CollectorError(`Personio board not found (${error.message})`, 404);
      }
      throw error;
    }
  },
};
