import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!user) { setProfile(null); setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      setProfile(data as Profile | null);
      // Auto-sync timezone on every session: server defaults to 'UTC' and many old
      // accounts were stamped UTC, which corrupts daily nudges and AI planning.
      // Fire-and-forget; ignore errors.
      try {
        const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (localTz && data && (data as any).timezone !== localTz) {
          await supabase.from("profiles").update({ timezone: localTz }).eq("id", user.id);
          setProfile({ ...(data as Profile), timezone: localTz });
        }
      } catch {/* ignore */}
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, [user?.id]);

  const update = async (patch: Partial<Profile>) => {
    if (!user) return;
    const { data } = await supabase.from("profiles").update(patch as never).eq("id", user.id).select().maybeSingle();
    if (data) setProfile(data as Profile);
  };

  return <Ctx.Provider value={{ profile, loading, refresh, update }}>{children}</Ctx.Provider>;
}

export const useProfile = (): ProfileCtx => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
};
