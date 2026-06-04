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

type ProfileData = {
  profile: Profile | null;
  loading: boolean;
};

type ProfileMutations = {
  refresh: () => Promise<void>;
  update: (patch: Partial<Profile>) => Promise<void>;
};

type ProfileCtx = ProfileData & ProfileMutations;

/**
 * The profile context is split into two halves:
 *   - DataCtx       — re-renders consumers when `profile` or `loading` changes
 *   - MutationsCtx  — stable across the provider's lifetime; consumers of just
 *                     `update` / `refresh` never re-render
 *
 * `useProfile()` is preserved as a combined back-compat hook so existing
 * call sites work unchanged. New consumers should prefer the split hooks
 * when they only need one half — handler-only components (Tour, Settings
 * row toggles, Onboarding actions) can subscribe to mutations alone and
 * skip every re-render driven by profile updates.
 */
const DataCtx = createContext<ProfileData | null>(null);
const MutationsCtx = createContext<ProfileMutations | null>(null);

// Once a user has been seen as onboarded, persist the fact so a flaky profile
// fetch (or a partial-row server response from `.update().select()` that omits
// `onboarded`) can never bounce them back through onboarding. The flag is
// per-user so signing into a different unonboarded account still routes
// correctly.
const ONBOARDED_FLAG_PREFIX = "dd_onboarded_uid_";
const readOnboardedFlag = (uid: string): boolean => {
  try { return localStorage.getItem(`${ONBOARDED_FLAG_PREFIX}${uid}`) === "1"; } catch { return false; }
};
export const writeOnboardedFlag = (uid: string): void => {
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
        if (localTz && data && (data).timezone !== localTz) {
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

  // Mutations object lives in a ref-stable identity for the provider's
  // lifetime. `refresh` and `update` close over `user` via the outer
  // refs/state, so we don't need new function identities on each render —
  // we just rebuild the wrapped pair when `user.id` changes.
  const mutations = useMemo<ProfileMutations>(
    () => ({ refresh, update }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id],
  );
  const data = useMemo<ProfileData>(
    () => ({ profile: stickyProfile, loading }),
    [stickyProfile, loading],
  );

  return (
    <MutationsCtx.Provider value={mutations}>
      <DataCtx.Provider value={data}>{children}</DataCtx.Provider>
    </MutationsCtx.Provider>
  );
}

/** Read-only profile data. Re-renders when `profile` or `loading` changes. */
export const useProfileData = (): ProfileData => {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useProfileData must be used inside ProfileProvider");
  return ctx;
};

/**
 * Refresh / update handles. The provider keeps a stable identity for these
 * across re-renders, so consumers that subscribe here do NOT re-render when
 * profile data changes. Prefer this in components that only need to *write*
 * to the profile.
 */
export const useProfileMutations = (): ProfileMutations => {
  const ctx = useContext(MutationsCtx);
  if (!ctx) throw new Error("useProfileMutations must be used inside ProfileProvider");
  return ctx;
};

/**
 * Combined data + mutations — kept for back-compat with existing call
 * sites. New code should prefer `useProfileData` or `useProfileMutations`
 * directly to avoid re-rendering on the half you don't care about.
 */
export const useProfile = (): ProfileCtx => {
  const data = useProfileData();
  const mut = useProfileMutations();
  return useMemo(
    () => ({ ...data, ...mut }),
    [data, mut],
  );
};
