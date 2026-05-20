import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

interface Ctx { user: User | null; session: Session | null; loading: boolean; signOut: () => Promise<void>; }
const AuthCtx = createContext<Ctx>({ user: null, session: null, loading: true, signOut: async () => {} });

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    try {
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        if (!mounted) return;
        setSession(s);
        setLoading(false);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    } catch {
      // Preview/runtime mismatch should not brick the whole app.
      setSession(null);
      setLoading(false);
      return () => { mounted = false; };
    }

    const loadInitialSession = async () => {
      try {
        // Keep preview resilient: if backend/auth is unreachable, we still
        // release the loading shell instead of freezing. IMPORTANT: a slow
        // network must NOT be treated as "signed out" — that's how users get
        // kicked back to /auth mid-session. If the initial call times out,
        // we just stop blocking the UI; `onAuthStateChange` will hydrate the
        // session once the network call eventually resolves.
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: Session | null } } | null>((resolve) =>
            setTimeout(() => resolve(null), 10_000),
          ),
        ]);
        if (!mounted) return;
        if (result) setSession(result.data.session);
      } catch {
        // Network/auth error: leave session untouched (likely null on first
        // load anyway). Do not force a sign-out.
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadInitialSession();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);
  return (
    <AuthCtx.Provider value={{ user: session?.user ?? null, session, loading, signOut: async () => { await supabase.auth.signOut(); } }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
