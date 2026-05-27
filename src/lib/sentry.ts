import * as Sentry from "@sentry/react";

/**
 * Sentry initialization.
 *
 * The DSN comes from `VITE_SENTRY_DSN`. If it isn't set (local dev, PR
 * preview without the env var) we short-circuit and Sentry stays inert
 * — no network traffic, no init cost, no console noise. That keeps
 * crash reporting opt-in per environment without scattering null
 * checks across the codebase.
 *
 * Sampling: errors are always captured. Tracing + replay are off by
 * default — they cost bytes on the wire and we can flip them on later
 * via env vars without touching this file.
 */
let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
      // Errors-only by default. Performance tracing can be enabled per
      // environment without code changes by setting these env vars.
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0),
      // Skip the noisy native-shell errors that aren't actionable.
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
        "Non-Error promise rejection captured",
        // Aborted fetches are normal during nav — they aren't crashes.
        "AbortError",
      ],
      // Strip query-strings off URLs we send up — they often contain
      // auth tokens or user ids we don't want in error reports.
      beforeSend(event) {
        if (event.request?.url) {
          try {
            const u = new URL(event.request.url);
            u.search = "";
            event.request.url = u.toString();
          } catch { /* leave as-is */ }
        }
        return event;
      },
      // Strip query-strings off URLs in breadcrumbs too — they capture
      // every fetch / navigation and would leak auth tokens otherwise.
      beforeBreadcrumb(crumb) {
        if (typeof crumb.data?.url === "string") {
          try {
            const u = new URL(crumb.data.url);
            u.search = "";
            crumb.data.url = u.toString();
          } catch { /* leave as-is */ }
        }
        return crumb;
      },
    });
    initialized = true;
  } catch (e) {
    // Never let Sentry init failure take down the app.
    console.warn("[sentry] init failed", e);
  }
}

export function setSentryUser(userId: string | null, email?: string | null): void {
  if (!initialized) return;
  if (userId) {
    Sentry.setUser({ id: userId, email: email ?? undefined });
  } else {
    Sentry.setUser(null);
  }
}

/** Manually report an error from a catch block when you want it tracked
 *  even though it didn't bubble up to an ErrorBoundary. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) {
    console.error("[captureError]", error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/** Forward a caught render-tree error to Sentry with the React component
 *  stack attached. Called by RootErrorBoundary. */
export function captureComponentError(error: unknown, componentStack: string | null | undefined): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (componentStack) scope.setExtra("componentStack", componentStack);
    Sentry.captureException(error);
  });
}
