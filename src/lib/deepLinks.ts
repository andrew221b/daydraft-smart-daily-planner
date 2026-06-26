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
export type AppAction =
  | { type: "tracker_stop" }
  | { type: "auth_session"; accessToken: string; refreshToken: string; recovery: boolean };

/** Recognise action-only deep links (`daydraft://trackerstop`,
 *  `daydraft://auth-callback#access_token=...`). Returns null for everything
 *  else so navigation parsing can take over. */
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
  if (parsed.hostname === "auth-callback") {
    // Supabase's email-confirmation / password-recovery redirect appends the
    // session as a URL fragment: #access_token=...&refresh_token=...&type=signup|recovery.
    // iOS hands us this URL whole (fragment included), unlike a normal page
    // load where the WebView would just keep the hash to itself.
    const frag = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const accessToken = frag.get("access_token");
    const refreshToken = frag.get("refresh_token");
    if (!accessToken || !refreshToken) return null;
    return { type: "auth_session", accessToken, refreshToken, recovery: frag.get("type") === "recovery" };
  }
  return null;
}

/** Where Supabase should send the user after they tap a confirmation /
 *  password-reset email link. On web, `window.location.origin` is correct
 *  as-is — supabase-js's `detectSessionInUrl` picks the tokens off the
 *  landing page's URL hash automatically. On native, that origin is the
 *  WebView's local scheme (`capacitor://localhost` / `https://localhost`) —
 *  meaningless outside the device, so GoTrue can't deliver a mail client
 *  there. We hand it our registered custom scheme instead, the same one
 *  iOS/Android already deliver to `appUrlOpen` — `resolveDeepLinkAction`
 *  above picks the session back up from it.
 *
 *  Requires `daydraft://auth-callback` to be added to Supabase Dashboard →
 *  Authentication → URL Configuration → Redirect URLs. Without that, GoTrue
 *  rejects the custom redirect_to and falls back to the project's Site URL —
 *  the email link still confirms the account server-side, it just won't
 *  auto-sign-in; the user can still tap "Already confirmed? Sign in". */
export function authRedirectTo(webPath = ""): string {
  if (Capacitor.isNativePlatform()) return "daydraft://auth-callback";
  return `${window.location.origin}${webPath}`;
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
      if (!(window as Window & { __daydraft_launch_handled?: boolean }).__daydraft_launch_handled) {
        const launch = await App.getLaunchUrl();
        (window as Window & { __daydraft_launch_handled?: boolean }).__daydraft_launch_handled = true;
        if (launch?.url) {
          // Intentionally skip resolveDeepLinkAction here.
          // getLaunchUrl() can return a STALE URL from a PREVIOUS app process on
          // some iOS/Capacitor versions — so when the OS kills a backgrounded app
          // and the user reopens it from the icon, this would yank them to
          // /focus or the tracker even though they were on (say) the checklist.
          // That's the "sometimes it threw me into the tracker" bug. Defence:
          // consume each launch URL AT MOST ONCE across processes. If we've
          // already acted on this exact URL in a prior launch, it's stale → drop
          // it and leave the user where they were. A genuinely new deep-link
          // launch carries a new URL (or the fresh appUrlOpen event below fires).
          let alreadyHandled = false;
          try { alreadyHandled = localStorage.getItem("dd_launch_url_handled") === launch.url; } catch { /* ignore */ }
          if (!alreadyHandled) {
            try { localStorage.setItem("dd_launch_url_handled", launch.url); } catch { /* ignore */ }
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
