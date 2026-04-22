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
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    setProfile(data as Profile | null);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [user?.id]);

  const update = async (patch: Partial<Profile>) => {
    if (!user) return;
    const { data } = await supabase.from("profiles").update(patch).eq("id", user.id).select().maybeSingle();
    if (data) setProfile(data as Profile);
  };

  return <Ctx.Provider value={{ profile, loading, refresh, update }}>{children}</Ctx.Provider>;
}

export const useProfile = (): ProfileCtx => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
};
