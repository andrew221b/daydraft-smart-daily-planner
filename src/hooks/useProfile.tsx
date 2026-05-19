import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface Profile {
  id: string;
  display_name: string | null;
  energy_preference: "morning" | "midday" | "night";
  notifications_enabled: boolean;
  onboarded: boolean;
  theme?: "system" | "light" | "dark";
  passkey_enabled?: boolean;
  install_prompted_at?: string | null;
  digest_opt_in?: boolean;
  timezone?: string;
  energy_zones?: { peak?: [number, number]; dip?: [number, number]; recovery?: [number, number] } | null;
  morning_nudge_local_time?: string;
  evening_nudge_local_time?: string;
  tour_seen?: Record<string, boolean>;
  ai_tone?: "professional" | "coach" | "playful" | "motivational" | "tough_love" | "philosophical" | "custom";
  ai_tone_custom?: string | null;
  ai_context_custom?: string | null;
  active_hours_start?: string;
  active_hours_end?: string;
  ai_planning_rules?: string | null;
}

type ProfileCtx = {
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  update: (patch: Partial<Profile>) => Promise<void>;
};

const Ctx = createContext<ProfileCtx | null>(null);

// Once a user has been seen as onboarded, persist the fact so a flaky profile
// fetch (or a partial-row server response from `.update().select()` that omits
// `onboarded`) can never bounce them back through onboarding. The flag is
// per-user so signing into a different unonboarded account still routes
// correctly.
const ONBOARDED_FLAG_PREFIX = "dd_onboarded_uid_";
const readOnboardedFlag = (uid: string): boolean => {
  try { return localStorage.getItem(`${ONBOARDED_FLAG_PREFIX}${uid}`) === "1"; } catch { return false; }
};
const writeOnboardedFlag = (uid: string): void => {
  try { localStorage.setItem(`${ONBOARDED_FLAG_PREFIX}${uid}`, "1"); } catch { /* ignore */ }
};

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // In-session sticky onboarded tracker. Combined with the localStorage flag
  // above this acts as a one-way ratchet: once the user has been observed as
  // onboarded, we never report them as un-onboarded again for this uid until
  // they sign out.
  const onboardedSessionRef = useRef<Set<string>>(new Set());

  // Hard cap so the app never sits on the loader forever. If Supabase is
  // slow / unreachable (Lovable preview's iframe, flaky network, blocked
  // 3rd-party storage in Safari), we fall through with profile=null which
  // routes the user to /onboarding instead of an indefinite spinner.
  const PROFILE_FETCH_TIMEOUT_MS = 5_000;

  const fetchProfileOnce = async (uid: string): Promise<{ data: Profile | null; error: unknown }> => {
    try {
      const res = await Promise.race([
        supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("profile_fetch_timeout")), PROFILE_FETCH_TIMEOUT_MS),
        ),
      ]);
      return { data: (res.data as Profile | null) ?? null, error: res.error ?? null };
    } catch (e) {
      return { data: null, error: e };
    }
  };

  const refresh = async () => {
    if (!user) { setProfile(null); setLoading(false); return; }
    setLoading(true);
    // Retry once on transient failure (mid-token-refresh, single hiccup).
    // Both attempts are wrapped in PROFILE_FETCH_TIMEOUT_MS so a hung
    // request can never lock the UI on PageFallback.
    let data: Profile | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchProfileOnce(user.id);
      data = res.data;
      lastErr = res.error;
      if (!lastErr) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
    try {
      setProfile(data);
      // Auto-sync timezone on every session: server defaults to 'UTC' and many old
      // accounts were stamped UTC, which corrupts daily nudges and AI planning.
      // Fire-and-forget; ignore errors. Don't await the network — it can hang.
      try {
        const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (localTz && data && (data as any).timezone !== localTz) {
          void supabase.from("profiles").update({ timezone: localTz }).eq("id", user.id);
          setProfile({ ...(data as Profile), timezone: localTz });
        }
      } catch {/* ignore */}
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, [user?.id]);

  // Record the sticky flag whenever we see an onboarded profile, so that
  // a later partial response from `.update().select()` (which may omit
  // `onboarded` or return a stale snapshot) can't roll the user back.
  useEffect(() => {
    if (user?.id && profile?.onboarded === true) {
      onboardedSessionRef.current.add(user.id);
      writeOnboardedFlag(user.id);
    }
  }, [user?.id, profile?.onboarded]);

  const update = async (patch: Partial<Profile>) => {
    if (!user) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(patch as never)
      .eq("id", user.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    // Merge: patch always wins over the server snapshot. Without this, a
    // tour_seen / notifications_enabled update could overwrite the just-set
    // `onboarded: true` with a stale `false` from the returned row and
    // bounce the user back to /onboarding mid-session.
    setProfile((prev) => {
      const base = (data as Profile | null) ?? prev ?? ({ id: user.id } as Profile);
      return { ...(base as Profile), ...(patch as object) } as Profile;
    });
  };

  // Expose a profile that respects the sticky onboarded ratchet. Reading
  // localStorage on every render is cheap and keeps the value stable across
  // unmounts (HMR, refresh after sign-in).
  const stickyProfile = useMemo<Profile | null>(() => {
    if (!profile || !user?.id) return profile;
    if (profile.onboarded === true) return profile;
    const sticky =
      onboardedSessionRef.current.has(user.id) || readOnboardedFlag(user.id);
    return sticky ? { ...profile, onboarded: true } : profile;
  }, [profile, user?.id]);

  // Hydrate the session ref from localStorage when the active user changes,
  // so the sticky ratchet survives a fresh app load (refresh, native cold
  // start) without waiting for a successful profile fetch to re-confirm.
  useEffect(() => {
    if (user?.id && readOnboardedFlag(user.id)) {
      onboardedSessionRef.current.add(user.id);
    }
  }, [user?.id]);

  return <Ctx.Provider value={{ profile: stickyProfile, loading, refresh, update }}>{children}</Ctx.Provider>;
}

export const useProfile = (): ProfileCtx => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
};
