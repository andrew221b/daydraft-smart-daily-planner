import { lazy, type ComponentType } from "react";

/**
 * Wraps `React.lazy()` so a stale browser tab that references a chunk hash
 * which no longer exists on the CDN (after a deploy) recovers by reloading
 * once, instead of leaving the user on the "Importing a module script failed"
 * error boundary screen.
 *
 * IMPORTANT: gate the reload by a timestamp, not by a flag-cleared-on-load.
 * Clearing on `window.load` causes an infinite reload loop whenever the chunk
 * failure is persistent (e.g. preview env, offline, blocked CDN).
 */
const RELOAD_KEY = "dd_chunk_reload_at";
const RELOAD_COOLDOWN_MS = 60_000;

export function lazyWithReload<T extends { default: ComponentType<any> }>(
  factory: () => Promise<T>,
) {
  return lazy(() =>
    factory().catch((err) => {
      const msg = String(err?.message || err || "");
      const isChunkErr =
        /Importing a module script failed|Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk/i.test(
          msg,
        );
      if (isChunkErr && typeof window !== "undefined") {
        try {
          const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
          const now = Date.now();
          if (!last || now - last > RELOAD_COOLDOWN_MS) {
            sessionStorage.setItem(RELOAD_KEY, String(now));
            window.location.reload();
            return new Promise(() => {}) as Promise<T>;
          }
        } catch {
          // ignore storage errors and fall through to re-throw
        }
      }
      throw err;
    }),
  );
}
