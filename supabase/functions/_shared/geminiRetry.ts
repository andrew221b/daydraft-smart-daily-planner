/**
 * Shared Gemini call+retry, used by parse-tasks, generate-plan and ai-assist.
 *
 * Centralises three things that used to be copy-pasted (and had to be edited in
 * three places at once): the model fallback chain, which HTTP statuses are worth
 * a retry, and the retry loop itself. Adding/removing a transient status (e.g.
 * 404) is now a one-line change here instead of three.
 *
 * The three call sites differ — generate-plan has a per-request deadline,
 * ai-assist streams the response and needs the winning model name — so the
 * helper is parameterised: it hands the caller's `doCall` a per-attempt budget,
 * accepts an abort signal + deadline, and returns the raw OK Response UNREAD so
 * the caller can `.json()` or stream `.body` as needed.
 */

export const GEMINI_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

/** Statuses worth retrying the SAME model for. Gemini intermittently returns
 *  404/429 (and 5xx) for an otherwise-valid, available model. */
export const isTransientStatus = (s: number): boolean =>
  s === 404 || s === 408 || s === 425 || s === 429 ||
  s === 500 || s === 502 || s === 503 || s === 504;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GeminiRetryOptions {
  models?: string[];
  /** Attempts per model before falling through to the next. Default 3. */
  attemptsPerModel?: number;
  /** Backoff base in ms; waits base*(attempt+1) + jitter between retries. Default 300. */
  baseBackoffMs?: number;
  /** Absolute epoch-ms deadline. When set, stops once the remaining budget drops
   *  below `minBudgetMs`, and passes the remaining budget (minus 1s) to doCall. */
  deadlineMs?: number;
  minBudgetMs?: number;
  /** Bail early if the caller/client disconnected. */
  signal?: AbortSignal;
  /** Called on every non-OK response (and on a timeout/network throw, as 504). */
  onError?: (info: { model: string; attempt: number; status: number; body: string }) => void;
}

export interface GeminiRetryResult {
  /** The OK response, UNREAD (safe to .json() or stream .body), or null if all failed. */
  response: Response | null;
  /** Which model produced `response` (for e.g. an X-Ai-Model header). */
  model: string | null;
  /** Last HTTP status seen — for error messaging when `response` is null. */
  lastStatus: number;
  /** Last error body (truncated) — for safety-filter detection etc. */
  lastBody: string;
}

/**
 * Calls `doCall(model, budgetMs)` across the model chain, retrying transient
 * failures on the same model with backoff before moving to the next model.
 * `budgetMs` is how long this attempt may take (Infinity when no deadline set).
 */
export async function callGeminiWithRetry(
  doCall: (model: string, budgetMs: number) => Promise<Response>,
  opts: GeminiRetryOptions = {},
): Promise<GeminiRetryResult> {
  const models = opts.models ?? GEMINI_MODEL_CHAIN;
  const attempts = opts.attemptsPerModel ?? 3;
  const base = opts.baseBackoffMs ?? 300;
  const minBudget = opts.minBudgetMs ?? 4_000;
  let lastStatus = 0;
  let lastBody = "";

  for (const model of models) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (opts.signal?.aborted) return { response: null, model: null, lastStatus, lastBody };

      let budgetMs = Number.POSITIVE_INFINITY;
      if (opts.deadlineMs != null) {
        const remaining = opts.deadlineMs - Date.now();
        if (remaining < minBudget) return { response: null, model: null, lastStatus, lastBody };
        budgetMs = remaining - 1_000;
      }

      let r: Response;
      try {
        r = await doCall(model, budgetMs);
      } catch (_e) {
        // Our timeout (abort) or a transient network blip — don't retry the same
        // (slow) model, jump straight to the faster fallback.
        lastStatus = 504;
        opts.onError?.({ model, attempt, status: 504, body: "timeout or network error" });
        break;
      }

      if (r.ok) return { response: r, model, lastStatus: r.status, lastBody: "" };

      lastStatus = r.status;
      try { lastBody = (await r.text()).slice(0, 1024); } catch { lastBody = ""; }
      opts.onError?.({ model, attempt, status: r.status, body: lastBody });

      if (isTransientStatus(r.status) && attempt < attempts - 1) {
        await sleep(base * (attempt + 1) + Math.floor(Math.random() * 200));
        continue;
      }
      break; // permanent 4xx (400/401/403) or attempts exhausted → next model
    }
  }
  return { response: null, model: null, lastStatus, lastBody };
}
