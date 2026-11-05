import { CollectorError } from "../ats/types.ts";

const USER_AGENT = "llm-job-search/0.1 (personal job search tool)";
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

const isRetryable = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET a URL and return its body as text, plus the URL it finally came from
 * (after redirects). With `json`, POST that value as JSON instead: Workday's
 * job search is a POST, and since it only reads, retrying it is safe. Retries
 * rate limits, server errors and network failures with backoff; a 4xx (e.g. a
 * wrong board token) fails immediately. With followRedirects: false, a
 * redirect is reported as an error instead.
 */
export async function fetchText(
  url: string,
  accept: string,
  options: { followRedirects?: boolean; json?: unknown } = {},
): Promise<{ body: string; finalUrl: string }> {
  const payload = options.json === undefined ? undefined : JSON.stringify(options.json);
  const headers = { "user-agent": USER_AGENT, accept, ...(payload === undefined ? {} : { "content-type": "application/json" }) };
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));

    let response: Response;
    try {
      response = await fetch(url, {
        method: payload === undefined ? "GET" : "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: options.followRedirects === false ? "manual" : "follow",
      });
      // Reading the body can fail too (a reset mid-download, the timeout): retried like the request.
      if (response.ok) return { body: await response.text(), finalUrl: response.url };
    } catch (error) {
      lastError = error;
      continue;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "?";
      throw new CollectorError(`HTTP ${response.status} redirect from ${url} to ${location}`, response.status);
    }
    if (!isRetryable(response.status)) {
      throw new CollectorError(`HTTP ${response.status} from ${url}`, response.status);
    }
    lastError = new CollectorError(`HTTP ${response.status} from ${url}`, response.status);
  }

  if (lastError instanceof CollectorError) throw lastError;
  throw new CollectorError(`Request failed: ${url}`, null, { cause: lastError });
}

/** GET a URL, or POST `json` to it, and parse the JSON response (see fetchText for retries and redirects). */
export async function fetchJson(url: string, options: { followRedirects?: boolean; json?: unknown } = {}): Promise<unknown> {
  const { body, finalUrl } = await fetchText(url, "application/json", options);
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new CollectorError(`Invalid JSON from ${finalUrl}`, null, { cause: error });
  }
}
