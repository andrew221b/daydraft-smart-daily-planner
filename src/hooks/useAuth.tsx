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
        // Keep preview resilient: if backend/auth is unreachable (or returns 4xx like 412),
        // we still render as "signed out" instead of freezing on a blank loading screen.
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth_init_timeout")), 4000)),
        ]);
        if (!mounted) return;
        setSession(result.data.session);
      } catch {
        if (!mounted) return;
        setSession(null);
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
