import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export type Theme = "system" | "light" | "dark";

interface Ctx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeCtx = createContext<Ctx>({ theme: "system", resolved: "light", setTheme: () => {} });

const STORAGE_KEY = "daydraft.theme";

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** "system" follows the OS; an explicit choice wins. Dark is only the fallback
 *  when the platform can't report a preference. */
const resolveTheme = (theme: Theme): "light" | "dark" =>
  theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;

const applyTheme = (theme: Theme): "light" | "dark" => {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  void applyStatusBarStyle(resolved);
  return resolved;
};

/** Native status bar text colour must invert with the app's own background,
 *  or it goes unreadable — white-on-white in light theme, black-on-black in
 *  dark. Capacitor's Style is named after the BACKGROUND it suits (`Dark` =
 *  light text, for a dark bg), the inverse of our `resolved` theme name. */
const applyStatusBarStyle = async (resolved: "light" | "dark") => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: resolved === "dark" ? Style.Dark : Style.Light });
  } catch (e) {
    console.warn("[theme] status bar style failed", e);
  }
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    // Safari private browsing throws on every localStorage read; fall back
    // to "system" so the app still mounts.
    try {
      return (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
    } catch {
      return "system";
    }
  });
  // Resolve synchronously from the initial theme so the very first render is
  // already correct (no dark→light flip after mount).
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(theme));

  useEffect(() => {
    setResolved(applyTheme(theme));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (theme === "system") setResolved(applyTheme("system")); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Hydrate from the saved profile once the user is known — but NEVER clobber an
  // explicit local choice. localStorage holds a value only when the user has
  // actively picked a theme on THIS device, and that always wins; the profile is
  // a cross-device default adopted only on a device that hasn't chosen yet.
  //
  // ROOT-CAUSE FIX (2026-06-18): hydration must react to AUTH STATE, not run once
  // at mount. ThemeProvider sits ABOVE AuthProvider, so it has no useAuth; the
  // old one-shot `getSession()` in a []-effect bailed when the session wasn't
  // ready yet (a fresh login), and never retried — so the saved profile theme
  // only landed on a LATER mount/restart. That's the "I log in, it's Auto/dark,
  // then after a restart it's suddenly Light" flip the user hit. Subscribing to
  // onAuthStateChange adopts the saved theme the moment the user signs in (or the
  // session restores), deterministically, no restart needed.
  useEffect(() => {
    let cancelled = false;
    let hydratedFor: string | null = null;

    const hydrate = async (userId: string) => {
      if (cancelled || hydratedFor === userId) return;
      hydratedFor = userId; // set before await so concurrent callers no-op
      let localChoice: string | null = null;
      try { localChoice = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
      const { data } = await supabase.from("profiles").select("theme").eq("id", userId).maybeSingle();
      if (cancelled) return;
      const t = (data)?.theme as Theme | undefined;
      const valid = t === "light" || t === "dark" || t === "system";

      if (localChoice) {
        // Explicit local choice is authoritative. If the server drifted (an
        // earlier write failed/raced), reconcile it to the local value so a
        // stale profile can't override this device on the next resume.
        if (valid && t !== localChoice) {
          supabase.from("profiles").update({ theme: localChoice }).eq("id", userId).then(() => {});
        }
        return;
      }
      // No local choice yet on this device — adopt the cross-device default.
      if (valid && t !== theme) {
        setThemeState(t);
        try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) void hydrate(session.user.id);
      else hydratedFor = null; // signed out — re-hydrate on the next sign-in
    });
    // Cover an already-restored session (the listener may not refire for it).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) void hydrate(session.user.id);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode / quota */ }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        supabase.from("profiles").update({ theme: t }).eq("id", data.session.user.id).then(() => {});
      }
    });
  };

  return <ThemeCtx.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeCtx.Provider>;
};

export const useTheme = () => useContext(ThemeCtx);