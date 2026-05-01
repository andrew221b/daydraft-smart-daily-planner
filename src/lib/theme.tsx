import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Theme = "system" | "light" | "dark";

interface Ctx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeCtx = createContext<Ctx>({ theme: "system", resolved: "light", setTheme: () => {} });

const STORAGE_KEY = "daydraft.theme";

const applyTheme = (theme: Theme): "light" | "dark" => {
  // Dark-first product. "system" still respects OS, but dark is the default
  // when user has expressed no preference yet.
  const sys = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "dark";
  const resolved = theme === "system" ? sys : theme;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  return resolved;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => {
    setResolved(applyTheme(theme));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (theme === "system") setResolved(applyTheme("system")); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Hydrate from profile once user is loaded
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;
      const { data } = await supabase.from("profiles").select("theme").eq("id", session.user.id).maybeSingle();
      const t = (data as any)?.theme as Theme | undefined;
      if (t && t !== theme) setThemeState(t);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        supabase.from("profiles").update({ theme: t } as any).eq("id", data.session.user.id).then(() => {});
      }
    });
  };

  return <ThemeCtx.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeCtx.Provider>;
};

export const useTheme = () => useContext(ThemeCtx);