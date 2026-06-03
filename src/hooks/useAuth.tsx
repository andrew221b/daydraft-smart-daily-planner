import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { setSentryUser } from "@/lib/sentry";
import { registerNativePush, unregisterNativePush } from "@/lib/nativePush";
import { clearNativeSocialSessions } from "@/lib/nativeAuth";

interface Ctx { user: User | null; session: Session | null; loading: boolean; signOut: () => Promise<void>; }
const AuthCtx = createContext<Ctx>({ user: null, session: null, loading: true, signOut: async () => {} });

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    try {
      const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
        if (!mounted) return;
        setSession(s);
        setSentryUser(s?.user?.id ?? null, s?.user?.email ?? null);
        setLoading(false);
        if (s?.user?.id && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
          void registerNativePush(s.user.id);
          // Tie RevenueCat purchases to this Supabase user (webhook maps it back).
          void import("@/lib/revenueCat").then(({ identifyRevenueCat }) => identifyRevenueCat(s.user.id));
        }
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
        if (result) {
          const sess = result.data.session;
          setSession(sess);
          setSentryUser(sess?.user?.id ?? null, sess?.user?.email ?? null);
          if (sess?.user?.id) {
            void registerNativePush(sess.user.id);
            void import("@/lib/revenueCat").then(({ identifyRevenueCat }) => identifyRevenueCat(sess.user!.id));
          }
        }
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
    <AuthCtx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          const uid = session?.user?.id;
          if (uid) {
            try { await unregisterNativePush(uid); } catch { /* never block sign-out */ }
          }
          try { const { logoutRevenueCat } = await import("@/lib/revenueCat"); await logoutRevenueCat(); } catch { /* never block sign-out */ }
          await supabase.auth.signOut();
          // After the Supabase session is cleared, also drop the cached native
          // OAuth grant. Without this step, Google's iOS SDK keeps the picked
          // account in its keychain and "Continue with Google" on the next
          // launch silently re-signs the user back in — which made the
          // delete-account flow appear broken (account "comes back").
          try { await clearNativeSocialSessions(); } catch { /* best-effort */ }
        },
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
