import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface Profile {
  id: string;
  display_name: string | null;
  energy_preference: "morning" | "midday" | "night";
  notifications_enabled: boolean;
  onboarded: boolean;
}

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!user) { setProfile(null); setLoading(false); return; }
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

  return { profile, loading, refresh, update };
};
