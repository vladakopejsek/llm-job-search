import { XMLParser } from "fast-xml-parser";
import { CollectorError } from "../ats/types.ts";

/**
 * Parse XML into plain objects. `arrays` lists the elements that must always
 * be arrays: XML can't tell one <item> from a list of one, so without this a
 * board with a single job would parse differently from a board with two.
 * Entries are element names ("item") or, when a name is used both singly and
 * in lists, dotted paths ("workzag-jobs.position.additionalOffices.office").
 */
export function parseXml(xml: string, arrays: string[], what: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    parseTagValue: false, // keep "0042" a string; we convert what we need ourselves
    isArray: (name, jpath) => arrays.includes(name) || arrays.includes(String(jpath)),
  });
  try {
    return parser.parse(xml, true);
  } catch (error) {
    throw new CollectorError(`Invalid XML from ${what}`, null, { cause: error });
  }
}
