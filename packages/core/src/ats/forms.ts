/**
 * The application form behind a posting, read from the ATS. The questions a
 * candidate must answer, and whether a cover letter is asked for, are usually
 * in the form, not in the posting text: 21 of the first 23 prep packs had no
 * answers because the text had no questions in it.
 *
 * Supported: Ashby (the public job board's GraphQL), Greenhouse (the job board
 * API with ?questions=true), Workable (the apply page's form endpoint) and
 * BambooHR (the job's detail, which carries its form). Other boards render the
 * form in HTML only, so their form is unknown.
 */
import { fetchJson, fetchText } from "../lib/http.ts";
import { htmlToText } from "../lib/text.ts";
import type { Ats } from "./types.ts";

/**
 * - text: an open question the prep pack drafts an answer for.
 * - choice: yes/no, a dropdown, checkboxes or a number; the pack suggests one answer and why.
 * - personal: salary, visa, notice, consent, "how did you hear", location…: the candidate answers.
 */
export type QuestionKind = "text" | "choice" | "personal";

export interface FormQuestion {
  question: string;
  kind: QuestionKind;
  required: boolean;
  /** Choices to pick from, when the form lists them. */
  options?: string[];
  /** Several options may be picked. */
  multiple?: boolean;
  /** A number is expected (years of experience…). */
  numeric?: boolean;
}

export interface ApplicationForm {
  ats: Ats;
  /** Whether the form has a cover-letter field. */
  coverLetter: "required" | "optional" | "none";
  questions: FormQuestion[];
}

export const COVER_LETTER = /\b(cover|motivation(al)?)\s+letter\b/i;

/**
 * Questions only the candidate can answer: their situation, preferences and
 * consents, not their experience. Drafting these would put words in their
 * mouth about pay or legal status. Leaning personal is deliberate, but not for
 * engineering words: "high availability", "a race condition", "address a disagreement".
 */
const PERSONAL =
  /\b(salary|compensation|pay\b|rate expectation|(hourly|daily|day|monthly) rate|financial expectation|expected (yearly|monthly|annual)|notice period|start date|(available|able) to start|(soon|when) (could|can|would) you start|form of cooperation|(?<!high )availability|visa|sponsor|work permit|right to work|authori[sz](ed|ation)|residen(ce|cy|t)\b|legally|eligible to work|citizenship|relocat|time ?zone|working hours|based in|where are you|located|location|country|city|(your|home|postal|mailing|street) address|how did you (hear|find|discover|first)|where did you (hear|find)|find out about|referr|^if other|accommodat|\bb2b\b.*\b(or|vs)\b|(working|contract|contractual|employment|engagement) (arrangement|model|type)|preferred (first |last |full )?name|name you'?d prefer|pronounc|previously (worked|been employed|applied|interviewed)|employment agreement|non-?compete|post-employment|restrictive covenant|conflict of interest|gender|pronoun|race\b(?!\s+condition)|ethnic|veteran|disabilit|consent|privacy|gdpr|processing of (my |your )?personal data|by selecting|date of birth)/i;

/** Asks for a link or an upload rather than an answer. */
const LINK = /\b(link|links|url|linkedin|github|twitter|portfolio|website|profile|screenshot|video|upload|attach)\b/i;

/** Contact and profile fields every form has: never questions. */
const PROFILE_FIELD =
  /^(name|full name|first name|last name|first and last name|preferred name|e-?mail|phone( number)?|mobile|linkedin( profile)?( url)?|github( profile)?( url)?|twitter|twitter \/ x( profile)?|x|website|portfolio|personal website|resume|resume\/cv|cv|photo|headline|summary|address|location|current location|education|experience)\s*$/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * `hint` is the text under the label. It can make a question personal, but
 * not a link field: essays often say "include any GitHub links".
 */
export function classify(label: string, base: "text" | "choice", hint = ""): QuestionKind {
  return PERSONAL.test(`${label} ${hint}`) || (base === "text" && LINK.test(label)) ? "personal" : base;
}

// ---------------------------------------------------------------------------
// Ashby

interface AshbyField {
  path: string;
  title: string;
  type: string;
  selectableValues?: { label: string; isArchived?: boolean }[];
}
interface AshbyResponse {
  data?: {
    jobPosting?: {
      applicationForm?: { sections: { fieldEntries: { field: AshbyField; isRequired: boolean; descriptionHtml?: string | null }[] }[] } | null;
    } | null;
  };
}

export function parseAshbyForm(json: AshbyResponse): ApplicationForm | null {
  const sections = json.data?.jobPosting?.applicationForm?.sections;
  if (!sections) return null;
  let coverLetter: ApplicationForm["coverLetter"] = "none";
  const questions: FormQuestion[] = [];
  for (const { field, isRequired, descriptionHtml } of sections.flatMap((s) => s.fieldEntries)) {
    const label = clean(field.title ?? "");
    if (!label) continue;
    // The label can be a mere heading ("Tell us more") with the actual question in the description under it.
    const hint = descriptionHtml ? clean(htmlToText(descriptionHtml)) : "";
    const question = hint ? `${label} — ${hint}` : label;
    if (COVER_LETTER.test(label)) {
      if (coverLetter !== "required") coverLetter = isRequired ? "required" : "optional";
      continue;
    }
    // Built-in fields (name, email, resume, location…) and link/contact types.
    if (field.path.startsWith("_systemfield_") || ["Email", "Phone", "Url", "Location", "Date"].includes(field.type)) {
      if (field.type === "Date" || field.type === "Location") {
        if (!PROFILE_FIELD.test(label)) questions.push({ question, kind: "personal", required: isRequired });
      }
      continue;
    }
    if (PROFILE_FIELD.test(label)) continue;
    if (field.type === "File") {
      questions.push({ question, kind: "personal", required: isRequired });
    } else if (field.type === "String" || field.type === "LongText") {
      questions.push({ question, kind: classify(label, "text", hint), required: isRequired });
    } else if (field.type === "Boolean") {
      questions.push({ question, kind: classify(label, "choice", hint), required: isRequired, options: ["Yes", "No"] });
    } else if (field.type === "ValueSelect" || field.type === "MultiValueSelect") {
      const options = (field.selectableValues ?? []).filter((v) => !v.isArchived).map((v) => clean(v.label));
      questions.push({
        question,
        kind: classify(label, "choice", hint),
        required: isRequired,
        options,
        multiple: field.type === "MultiValueSelect",
      });
    } else if (field.type === "Number") {
      questions.push({ question, kind: classify(label, "choice", hint), required: isRequired, numeric: true });
    } else {
      questions.push({ question, kind: "personal", required: isRequired });
    }
  }
  return { ats: "ashby", coverLetter, questions };
}

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { field isRequired descriptionHtml } } } }
  }
}`;

async function fetchAshby(board: string, id: string) {
  const json = await fetchJson("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    json: { operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: board, jobPostingId: id }, query: ASHBY_QUERY },
  });
  return parseAshbyForm(json as AshbyResponse);
}

// ---------------------------------------------------------------------------
// Greenhouse

interface GreenhouseQuestion {
  label: string;
  required: boolean;
  fields: { name: string; type: string; values?: { label: string }[] }[];
}

export function parseGreenhouseForm(json: { questions?: GreenhouseQuestion[] }): ApplicationForm | null {
  if (!json.questions) return null;
  let coverLetter: ApplicationForm["coverLetter"] = "none";
  const questions: FormQuestion[] = [];
  for (const q of json.questions) {
    const label = clean(q.label);
    const names = q.fields.map((f) => f.name);
    if (names.includes("cover_letter") || names.includes("cover_letter_text") || COVER_LETTER.test(label)) {
      coverLetter = q.required ? "required" : "optional";
      continue;
    }
    if (["first_name", "last_name", "email", "phone", "resume", "resume_text"].some((n) => names.includes(n)) || PROFILE_FIELD.test(label)) continue;
    const field = q.fields.find((f) => f.type !== "input_file") ?? q.fields[0];
    if (!field) continue;
    if (field.type === "input_file") questions.push({ question: label, kind: "personal", required: q.required });
    else if (field.type === "input_text" || field.type === "textarea")
      questions.push({ question: label, kind: classify(label, "text"), required: q.required });
    else if (field.type.startsWith("multi_value")) {
      const options = (field.values ?? []).map((v) => clean(v.label));
      questions.push({
        question: label,
        kind: classify(label, "choice"),
        required: q.required,
        options,
        multiple: field.type === "multi_value_multi_select",
      });
    } else questions.push({ question: label, kind: "personal", required: q.required });
  }
  return { ats: "greenhouse", coverLetter, questions };
}

// ---------------------------------------------------------------------------
// Workable

interface WorkableField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  choices?: { body?: string; label?: string; name?: string }[];
}

export function parseWorkableForm(json: { fields?: WorkableField[] }[]): ApplicationForm | null {
  if (!Array.isArray(json)) return null;
  let coverLetter: ApplicationForm["coverLetter"] = "none";
  const questions: FormQuestion[] = [];
  for (const f of json.flatMap((s) => s.fields ?? [])) {
    const label = clean(f.label ?? "");
    if (f.id === "cover_letter" || COVER_LETTER.test(label)) {
      coverLetter = f.required ? "required" : "optional";
      continue;
    }
    // Workable's own profile fields have fixed ids; questions the company added are "QA_<n>".
    if (!f.id.startsWith("QA_")) continue;
    if (f.type === "paragraph" || f.type === "text" || f.type === "free_text") {
      questions.push({ question: label, kind: classify(label, "text"), required: f.required });
    } else if (f.type === "boolean") {
      questions.push({ question: label, kind: classify(label, "choice"), required: f.required, options: ["Yes", "No"] });
    } else if (f.type === "number") {
      questions.push({ question: label, kind: classify(label, "choice"), required: f.required, numeric: true });
    } else if (f.type === "dropdown" || f.type === "multiple" || f.type === "checkbox") {
      const options = (f.choices ?? []).map((c) => clean(c.body ?? c.label ?? c.name ?? "")).filter(Boolean);
      questions.push({ question: label, kind: classify(label, "choice"), required: f.required, options, multiple: f.type !== "dropdown" });
    } else {
      questions.push({ question: label, kind: "personal", required: f.required });
    }
  }
  return { ats: "workable", coverLetter, questions };
}

// ---------------------------------------------------------------------------
// BambooHR

interface BambooHRField {
  label: string;
  isRequired: boolean;
}
interface BambooHRQuestion {
  question: string;
  /** short | long | yes_no | multi | checkbox */
  type: string;
  isRequired: boolean;
  /** "yes" when a multiple-choice question also offers "Other". */
  hasOther?: string;
  options?: { option: string }[];
}
interface BambooHRDetail {
  result?: {
    formFields?: {
      coverLetterFileId?: BambooHRField;
      desiredPay?: BambooHRField;
      dateAvailable?: BambooHRField;
      customQuestions?: BambooHRQuestion[];
    };
  };
}

export function parseBambooHRForm(json: BambooHRDetail): ApplicationForm | null {
  const fields = json.result?.formFields;
  if (!fields) return null;
  const cover = fields.coverLetterFileId;
  const questions: FormQuestion[] = [];
  // Built-in fields are there only when the company turned them on. Pay and
  // start date are the candidate's to answer; the rest are contact details.
  for (const field of [fields.desiredPay, fields.dateAvailable]) {
    if (field) questions.push({ question: clean(field.label), kind: "personal", required: field.isRequired });
  }
  for (const q of fields.customQuestions ?? []) {
    const label = clean(q.question);
    if (q.type === "short" || q.type === "long") {
      questions.push({ question: label, kind: classify(label, "text"), required: q.isRequired });
    } else if (q.type === "yes_no") {
      questions.push({ question: label, kind: classify(label, "choice"), required: q.isRequired, options: ["Yes", "No"] });
    } else if (q.type === "multi") {
      const options = (q.options ?? []).map((o) => clean(o.option));
      if (q.hasOther === "yes") options.push("Other");
      questions.push({ question: label, kind: classify(label, "choice"), required: q.isRequired, options });
    } else {
      // "checkbox" is a statement to tick: a consent or a certification.
      questions.push({ question: label, kind: "personal", required: q.isRequired });
    }
  }
  return { ats: "bamboohr", coverLetter: !cover ? "none" : cover.isRequired ? "required" : "optional", questions };
}

// ---------------------------------------------------------------------------

/** The posting's application form, or null when this ATS's form can't be read. */
export async function fetchApplicationForm(company: { ats: Ats; boardToken: string | null; boardHost: string | null }, externalId: string) {
  if (company.ats === "ashby" && company.boardToken) return fetchAshby(company.boardToken, externalId);
  if (company.ats === "greenhouse" && company.boardToken) {
    const host = company.boardHost ?? "boards-api.greenhouse.io";
    const { body } = await fetchText(`https://${host}/v1/boards/${company.boardToken}/jobs/${externalId}?questions=true`, "application/json");
    return parseGreenhouseForm(JSON.parse(body));
  }
  if (company.ats === "workable") {
    const { body } = await fetchText(`https://apply.workable.com/api/v1/jobs/${externalId}/form`, "application/json");
    return parseWorkableForm(JSON.parse(body));
  }
  if (company.ats === "bamboohr" && company.boardHost) {
    // The external id is "<company>/<job id>".
    const id = externalId.slice(externalId.indexOf("/") + 1);
    const { body } = await fetchText(`https://${company.boardHost}/careers/${id}/detail`, "application/json");
    return parseBambooHRForm(JSON.parse(body));
  }
  return null;
}
