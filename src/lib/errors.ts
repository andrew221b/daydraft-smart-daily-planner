/**
 * Safe error-message extraction.
 *
 * `catch` clauses are typed `unknown` (a thrown value can be anything), so we
 * funnel them through here instead of sprinkling `(e)?.message`. Handles
 * real `Error`s, plain strings, Supabase `PostgrestError`s, and the Capacitor
 * plugin shape `{ message, errorMessage }`.
 */
export function getErrorMessage(error: unknown, fallback = ""): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const o = error as { message?: unknown; errorMessage?: unknown };
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.errorMessage === "string" && o.errorMessage) return o.errorMessage;
  }
  return fallback;
}
