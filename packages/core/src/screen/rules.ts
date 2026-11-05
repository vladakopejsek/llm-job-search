/**
 * Cheap, deterministic screening that runs before any LLM call.
 *
 * The bias is towards recall: a rule rejects only what is clearly not a fit.
 * Anything uncertain passes and is judged later by the extraction step, where
 * the full posting text is read. A wrongly rejected role is never seen again;
 * a wrongly passed one costs one LLM call.
 */

import { searchConfig } from "../search-config.ts";

export type ScreenResult = { pass: true } | { pass: false; rule: string; reason: string };

interface Rule {
  id: string;
  reason: string;
  pattern: RegExp;
  /** Titles that also match this are kept, e.g. "Platform Engineer, Frontend". */
  unless?: RegExp;
}

/** A frontend/full-stack/TypeScript signal in the title overrides a domain rule. */
const WEB_SIGNAL =
  /\b(front[\s-]?end|full[\s-]?stack|fullstack|react|typescript|javascript|node(\.?js)?|web|ui|design engineer|product engineer|kibana)\b/i;

/** The TypeScript side of a stack named in the title, the same languages the evaluator accepts. */
const TS_SIGNAL = /\b(typescript|javascript|node(\.?js)?|react)\b/i;

/**
 * Each rule rejects a kind of role a TypeScript web engineer's profile rules out: people
 * management, junior roles, mobile, other primary languages, infrastructure, data/ML, security,
 * QA, hardware, sales and support. Backend roles go to the evaluator, which scores fit against
 * the profile.
 */
const TITLE_RULES: Rule[] = [
  // People leadership. "Lead Engineer", "Tech Lead" and "Team Lead" are often hands-on and go to the
  // evaluator, which rejects a role that is really people management.
  {
    id: "management",
    reason: "people-management role",
    pattern: /\b(manager|head of|director|vp|vice president|chief|cto)\b/i,
  },
  {
    id: "junior",
    reason: "junior, intern or graduate role",
    pattern: /\b(junior|jr\.?|intern(ship)?|graduate|new grad|apprentice|student|entry[\s-]level|trainee|werkstudent)\b/i,
  },
  {
    id: "mobile",
    reason: "mobile role",
    pattern: /\b(ios|android|mobile|react native|flutter|swift|swiftui)\b/i,
  },
  {
    id: "language",
    reason: "primary language isn't TypeScript",
    // A lookbehind, not \b: in "(.NET" there is no word boundary before the dot.
    // "Go" is matched case-sensitively below; "java" must not match "javascript".
    pattern:
      /(?<![\w.#+])(python|golang|rust|java(?!script)|kotlin|scala|php|laravel|ruby|rails|elixir|clojure|haskell|erlang|ocaml|c\+\+|c#|\.net|dotnet)(?![\w+#])/i,
    // "TypeScript/Go" is a mixed stack: the evaluator keeps those too (agent/rules.ts).
    unless: TS_SIGNAL,
  },
  // "Go-to-Market" is a team, not the language: the customer_facing rule judges it.
  { id: "language", reason: "primary language isn't TypeScript", pattern: /\bGo\b(?![\s-][Tt]o[\s-])/, unless: TS_SIGNAL },
  {
    id: "non_engineering",
    reason: "not a software engineering role",
    pattern: /\b(analyst|designer|product manager|recruiter|writer|account executive|specialist|coordinator|technician)\b/i,
    // "Design Engineer, Technical Designer, or PM" is still an engineering role;
    // "Fullstack Data Analyst" is not.
    unless: /\b(engineer|developer)\b/i,
  },
  {
    id: "data_ml",
    reason: "ML, data or research role",
    pattern:
      /\b(machine learning|ml|mlops|reinforcement learning|robot learning|computer vision|data (engineer|scientist|platform)|analytics engineer|research (engineer|scientist)|applied scientist|scientist)\b/i,
    unless: WEB_SIGNAL,
  },
  {
    id: "infra",
    reason: "infrastructure, SRE or DevOps role",
    pattern:
      /\b(sre|site reliability|devops|finops|release engineer(ing)?|build engineer|infrastructure|infra|platform engineer(ing)?|cloud engineer|operations engineer|network(ing)?|systems engineer|observability|kubernetes|database(s)?|storage|distributed systems)\b/i,
    unless: WEB_SIGNAL,
  },
  {
    id: "security",
    reason: "security role",
    pattern: /\b(security|appsec|iam|identity and access|vulnerability|penetration|soc analyst)\b/i,
  },
  {
    id: "qa",
    reason: "QA or test role",
    pattern: /\b(qa|sdet|test(ing)?|quality (assurance|engineer))\b/i,
  },
  {
    // Unambiguous: "PCB Design Engineer" is hardware even though it says "design engineer".
    id: "hardware",
    reason: "hardware or non-software engineering role",
    pattern:
      /\b(firmware|hardware|electrical|electronics|mechanical|fpga|asic|pcb|cad|controls engineer|civil|structural|manufacturing|facade|fire engineering|process engineer|component engineer|validation engineer)\b/i,
  },
  {
    // Ambiguous: "Senior Product Engineer, Robotics" is a software role. So is "Backend Engineer, Embedded
    // Payments": embedded finance is a fintech product.
    id: "hardware",
    reason: "hardware or non-software engineering role",
    pattern: /\b(robotics|robot|embedded(?![\s-](finance|fintech|payments?|banking|lending|insurance|payroll|analytics|commerce)))\b/i,
    unless: WEB_SIGNAL,
  },

  {
    id: "customer_facing",
    reason: "sales, solutions or support engineering",
    pattern:
      // Forward deployed and solutions engineers build for customers, close to product work, so the evaluator judges them.
      /\b(sales|support|customer (success|support|engineer(ing)?)|implementation|gtm|go[\s-]to[\s-]market|consultant|pre[\s-]?sales|demo engineer|technical account|developer (relations|advocate)|devrel|professional services|field engineer|business develop(er|ment))\b/i,
    // "Senior Full Stack Engineer, Customer Experience Platform" is a product role.
    unless: WEB_SIGNAL,
  },
  {
    // Elastic's many search-engine roles are Java; its Kibana roles are TypeScript.
    id: "search_engine",
    reason: "search/database engine internals",
    pattern: /\b(elasticsearch|lucene|search algorithms|query engine|vector search)\b/i,
    unless: WEB_SIGNAL,
  },
  {
    id: "other_platform",
    reason: "vendor platform specialist",
    pattern: /\b(salesforce|sap|servicenow|wordpress|drupal|magento|unity|game|workday)\b/i,
  },
];

export function screenTitle(title: string): ScreenResult {
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(title) && !rule.unless?.test(title)) {
      return { pass: false, rule: `title.${rule.id}`, reason: rule.reason };
    }
  }
  return { pass: true };
}

// ---------------------------------------------------------------------------
// Location: reject only when the location clearly excludes someone living where the
// candidate does (the search config's home country).
//
// The ATS's structured fields are not reliable on their own: one lists a role under
// "North America" whose text says "open to candidates based in the US and Europe",
// another marks a role "Hybrid" whose text says "or anywhere in the world". So a
// location rule rejects only when the posting text doesn't contradict it.

/**
 * Europe, by English names. Not "Georgia": in the snapshot it's mostly the US state
 * ("Atlanta, Georgia"), so the country counts by its cities. Not "New South Wales".
 * The home country's own names, in its own language too, come from the search config.
 */
const EUROPE =
  /\b(europe|european|emea|eu|eea|cet|cest|worldwide|anywhere|global|international|germany|deutschland|austria|poland|czechia|czech republic|slovakia|hungary|netherlands|belgium|luxembourg|france|spain|portugal|italy|ireland|united kingdom|uk|england|scotland|(?<!new south )wales|sweden|denmark|norway|finland|iceland|estonia|latvia|lithuania|romania|bulgaria|croatia|slovenia|serbia|bosnia|montenegro|albania|macedonia|greece|cyprus|malta|switzerland|ukraine|moldova|tbilisi|batumi|armenia|turkey|berlin|munich|hamburg|frankfurt|cologne|vienna|warsaw|krakow|wroclaw|gdansk|prague|bratislava|budapest|amsterdam|rotterdam|brussels|paris|lyon|madrid|barcelona|valencia|lisbon|porto|milan|rome|dublin|london|manchester|edinburgh|stockholm|copenhagen|oslo|helsinki|tallinn|riga|vilnius|bucharest|sofia|zagreb|ljubljana|belgrade|athens|nicosia|limassol|zurich|geneva|kyiv|kiev|lviv)\b/i;

const OUTSIDE_EUROPE =
  /\b(united states|usa|us|u\.s\.?|america|americas|north america|canada|mexico|latam|latin america|south america|brazil|argentina|colombia|chile|peru|uruguay|costa rica|india|apac|asia|singapore|japan|china|hong kong|taiwan|korea|philippines|vietnam|indonesia|malaysia|kuala lumpur|thailand|australia|new zealand|anz|israel|tel aviv|uae|dubai|saudi|egypt|nigeria|kenya|south africa|pakistan|bangladesh|san francisco|sf|bay area|new york|nyc|seattle|austin|boston|chicago|denver|los angeles|atlanta|miami|toronto|vancouver|montreal|bangalore|bengaluru|hyderabad|pune|chennai|noida|delhi|mumbai|gurgaon|tokyo|sydney|melbourne|auckland|sao paulo|são paulo|buenos aires|bogota|mexico city)\b/i;

// Local boards and Workday write places in the local language, with or without
// diacritics: "Évora" or "Evora", "Setúbal". \b only knows ASCII letters, so it
// never falls next to "é" or "ú" (collect/filter.ts); these patterns use letter
// lookarounds instead.

/** "Évora" → "[ée]vora": the name with or without its diacritics. A space or hyphen matches either. */
function eitherSpelling(name: string): string {
  return [...name.toLowerCase()]
    .map((c) => {
      if (c === " " || c === "-") return "[\\s-]";
      const plain = c.normalize("NFD").replace(/\p{M}/gu, "");
      if (plain !== c) return `[${c}${plain}]`;
      return c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); // names come from a config file
    })
    .join("");
}

const NEVER = /(?!)/;

/** Any of `names` as whole words, in any case. `exact` names must keep their diacritics (a short form that is something else without them). */
export function placeNames(names: string[], exact: string[] = []): RegExp {
  const alternatives = [...names.map(eitherSpelling), ...exact];
  return alternatives.length ? new RegExp(`(?<!\\p{L})(${alternatives.join("|")})(?!\\p{L})`, "iu") : NEVER;
}

let home: { places: RegExp; codes: RegExp; titleWord: RegExp } | undefined;

/** Built from the search config on first use. */
function homePatterns() {
  if (!home) {
    const { home: h, titleWords } = searchConfig();
    home = {
      places: placeNames(h.places, h.exact),
      // Upper case and a whole token only, as Workday writes them: "Lisbon, PT", "PRT - Porto".
      codes: new RegExp(`(?<![\\p{L}\\p{N}])(${h.codes.join("|")})(?![\\p{L}\\p{N}])`, "u"),
      // Word starts: a local word for "developer" also matches its other forms.
      titleWord: titleWords.length ? new RegExp(`(?<!\\p{L})(${titleWords.map(eitherSpelling).join("|")})`, "iu") : NEVER,
    };
  }
  return home;
}

const REMOTE_WORDING = /\b(remote|anywhere|distributed|work from home|wfh)\b/i;
/** Regions that name no office: "Europe", "EMEA" as a location say nothing about where the office is. */
const REGIONS = /\b(europe|european|emea|eu|eea|cet|cest|worldwide|anywhere|global|international)\b/gi;
const OFFICE_WORDING = /\b(on[\s-]?site|in[\s-]office|hybrid)\b/i;

/** Text that could make a non-European-looking role eligible from home. */
const TEXT_EUROPE = /\b(europe|european union|emea|eu|eea|worldwide|anywhere in the world|work from anywhere|cet)\b/i;
/** Text that could make an office-looking role remote. */
const TEXT_REMOTE = /\b(remote|work from home|anywhere in the world|work from anywhere|comfort of (your )?home)\b/i;

export function screenLocation(locationRaw: string | null, workplaceRaw: string | null, descriptionText = ""): ScreenResult {
  const location = locationRaw?.trim() ?? "";
  const workplace = workplaceRaw?.toLowerCase().replace(/[\s-]/g, "") ?? "";

  const outsideEurope = location && OUTSIDE_EUROPE.test(location) && !namesEurope(location);
  if (outsideEurope && !TEXT_EUROPE.test(descriptionText) && !textNamesHome(descriptionText)) {
    return { pass: false, rule: "location.outside_europe", reason: `outside Europe: "${location}"` };
  }

  const officeBased =
    workplace === "onsite" || workplace === "hybrid" || (!workplace && OFFICE_WORDING.test(location) && !REMOTE_WORDING.test(location));
  // A location naming a place says whether the office is at home. One naming none (empty, "HQ", "EMEA") leaves it to the text.
  const place = location.replace(REGIONS, " ");
  const atHome = namesEurope(place) || OUTSIDE_EUROPE.test(place) ? namesHome(location) : textNamesHome(descriptionText);
  if (officeBased && !atHome && !TEXT_REMOTE.test(descriptionText)) {
    const where = location || "unspecified location";
    return { pass: false, rule: "location.office_abroad", reason: `${workplace || "office-based"} in ${where}` };
  }

  return { pass: true };
}

export function screenPosting(posting: {
  title: string;
  locationRaw: string | null;
  workplaceRaw: string | null;
  descriptionText?: string;
}): ScreenResult {
  const title = screenTitle(posting.title);
  if (!title.pass) return title;
  return screenLocation(posting.locationRaw, posting.workplaceRaw, posting.descriptionText);
}

/** Does a location string name somewhere in Europe, or say remote/anywhere? Used by discovery. */
export function mentionsEuropeOrRemote(location: string | null): boolean {
  return !!location && (namesEurope(location) || REMOTE_WORDING.test(location));
}

function namesEurope(location: string): boolean {
  // EUROPE is plain ASCII: "Zürich" and "Kraków" match once their accents are gone.
  return EUROPE.test(location.normalize("NFD").replace(/\p{M}/gu, "")) || namesHome(location);
}

/** Does a location string name a place in the home country, by name or ISO code? "Évora, Portugal", "Lisbon, PT". */
export function namesHome(location: string | null): boolean {
  const { places, codes } = homePatterns();
  return !!location && (places.test(location) || codes.test(location));
}

/** Does free text name the home country or a place in it? No ISO codes: "PT" in a description is usually part-time. */
export function textNamesHome(text: string | null): boolean {
  return !!text && homePatterns().places.test(text);
}

/** Does a title use a local word for "developer" (the search config's `titleWords`)? */
export function localTitleWord(title: string): boolean {
  return homePatterns().titleWord.test(title);
}
