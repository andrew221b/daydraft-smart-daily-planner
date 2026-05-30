import { Capacitor } from "@capacitor/core";

/**
 * Deep link router.
 *
 * Two URL shapes feed in:
 *
 *   1. Custom scheme   — `daydraft://focus/<blockId>`, `daydraft://today`
 *      Fires `appUrlOpen` on iOS / Android via @capacitor/app. We're the
 *      registered scheme owner so iOS hands us the URL unchanged.
 *
 *   2. Universal Links — `https://daydraft.app/open/focus/<blockId>`
 *      Fires the same event once the apple-app-site-association is
 *      served at /.well-known/. Until that file exists in production
 *      the link falls back to a web page; the parser below treats it
 *      identically once iOS does start delivering it.
 *
 * Parsed routes are returned to the caller as the in-app path the
 * router should navigate to. We never call `navigate()` from this
 * module — keeping it pure makes it easy to test and avoids React
 * Router context wiring inside a Capacitor listener.
 */

type Route = string;

/** Convert an incoming deep-link URL into the in-app path to navigate to.
 *  Returns null if the URL isn't recognized — let the caller decide what
 *  to do (typically: ignore and stay on the current screen). */
export function resolveDeepLink(rawUrl: string): Route | null {
  if (!rawUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  // Universal Links: https://daydraft.app/open/<segments>...
  // Custom scheme:   daydraft://<segments>...
  let segments: string[];
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    // We only claim /open/* on the web origin — any other path stays
    // a normal browser navigation.
    const path = parsed.pathname.replace(/^\/+/, "");
    if (!path.startsWith("open/")) return null;
    segments = path.slice("open/".length).split("/").filter(Boolean);
  } else if (parsed.protocol === "daydraft:") {
    // URL.hostname captures "focus" in `daydraft://focus/123`.
    // URL.pathname captures the rest. Stitch them back together for a
    // unified parsing model.
    const host = parsed.hostname;
    const path = parsed.pathname.replace(/^\/+/, "");
    segments = [host, ...path.split("/")].filter(Boolean);
  } else {
    return null;
  }

  if (segments.length === 0) return "/home";

  const [head, ...rest] = segments;
  switch (head) {
    case "focus": {
      const blockId = rest[0];
      if (!blockId) return null;
      return `/focus/${encodeURIComponent(blockId)}`;
    }
    case "focusdone": {
      // Live Activity "Mark done" button. Open the Focus screen and signal
      // it to run completion exactly as if Done were tapped in-app.
      const blockId = rest[0];
      if (!blockId) return null;
      return `/focus/${encodeURIComponent(blockId)}?complete=1`;
    }
    case "today":
      return rest[0] === "plan" ? "/today/plan" : "/today";
    case "tracker":
      return "/home";
    case "reports":
      return "/reports";
    case "settings":
      return "/settings";
    case "home":
      return "/home";
    default:
      return null;
  }
}

type Unsubscribe = () => void;

/** A non-navigational command carried by a deep link — e.g. a button tapped
 *  inside a Live Activity. Handled by the caller, never routed. */
export type AppAction = { type: "tracker_stop" };

/** Recognise action-only deep links (`daydraft://trackerstop`). Returns null
 *  for everything else so navigation parsing can take over. */
export function resolveDeepLinkAction(rawUrl: string): AppAction | null {
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "daydraft:") return null;
  if (parsed.hostname === "trackerstop") return { type: "tracker_stop" };
  return null;
}

/** Attach the Capacitor listener and forward resolved routes / actions to the
 *  caller. Returns an unsubscribe so React effects can clean up. */
export function attachDeepLinkListener(
  onRoute: (path: string) => void,
  onAction?: (action: AppAction) => void,
): Unsubscribe {
  // Bail early when running in a plain browser — the web routing is
  // already URL-driven, no listener needed.
  if (!Capacitor.isNativePlatform()) return () => {};

  let removeListener: Unsubscribe | null = null;

  void import("@capacitor/app").then(async ({ App }) => {
    // Cold-start: if the app was launched FROM a deep link (killed →
    // tap a notification or daydraft:// URL), iOS hands the URL via
    // getLaunchUrl() instead of the appUrlOpen event. Without this
    // the very first tap of the day silently drops on the floor.
    try {
      if (!(window as any).__daydraft_launch_handled) {
        const launch = await App.getLaunchUrl();
        (window as any).__daydraft_launch_handled = true;
        if (launch?.url) {
          const action = resolveDeepLinkAction(launch.url);
          if (action) onAction?.(action);
          else {
            const route = resolveDeepLink(launch.url);
            if (route) onRoute(route);
          }
        }
      }
    } catch { /* getLaunchUrl rejects on platforms that don't support it */ }

    const handle = App.addListener("appUrlOpen", (event) => {
      const action = resolveDeepLinkAction(event.url);
      if (action) { onAction?.(action); return; }
      const route = resolveDeepLink(event.url);
      if (route) onRoute(route);
    });
    removeListener = () => {
      void Promise.resolve(handle).then((h) => h.remove());
    };
  }).catch((e) => {
    console.warn("[deepLinks] @capacitor/app not available", e);
  });

  return () => {
    if (removeListener) removeListener();
  };
}
