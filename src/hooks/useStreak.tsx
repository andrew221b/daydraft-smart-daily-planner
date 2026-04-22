import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { todayDateStr } from "@/lib/daydraft";

export interface Streak {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_planned_date: string | null;
  freezes_remaining: number;
  freeze_resets_at: string;
  updated_at: string;
}

const daysBetween = (a: string, b: string) => {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((db - da) / 86400000);
};

export const useStreak = () => {
  const { user } = useAuth();
  const [streak, setStreak] = useState<Streak | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setStreak(null); setLoading(false); return; }
    let { data } = await supabase.from("streaks").select("*").eq("user_id", user.id).maybeSingle();
    if (!data) {
      const { data: created } = await supabase.from("streaks").insert({ user_id: user.id }).select().maybeSingle();
      data = created;
    }
    // Refresh weekly freeze
    if (data && new Date(data.freeze_resets_at) <= new Date()) {
      const next = new Date(); next.setDate(next.getDate() + 7);
      const { data: upd } = await supabase.from("streaks").update({
        freezes_remaining: 1,
        freeze_resets_at: next.toISOString().slice(0, 10),
      }).eq("user_id", user.id).select().maybeSingle();
      if (upd) data = upd;
    }
    setStreak(data as Streak | null);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Call after a plan has been saved today
  const recordPlanToday = useCallback(async () => {
    if (!user) return null;
    const today = todayDateStr();
    const { data: existing } = await supabase.from("streaks").select("*").eq("user_id", user.id).maybeSingle();
    let s = existing as Streak | null;
    if (!s) {
      const { data: created } = await supabase.from("streaks").insert({ user_id: user.id }).select().maybeSingle();
      s = created as Streak;
    }
    if (!s) return null;
    if (s.last_planned_date === today) { setStreak(s); return { ...s, milestone: null as number | null, freezeUsed: false }; }

    let current = s.current_streak;
    let freezes = s.freezes_remaining;
    let freezeUsed = false;

    if (!s.last_planned_date) {
      current = 1;
    } else {
      const gap = daysBetween(s.last_planned_date, today);
      if (gap === 1) current = current + 1;
      else if (gap > 1) {
        // missed days; consume freezes if possible to bridge a single missed day
        const missed = gap - 1;
        if (missed === 1 && freezes > 0) { freezes -= 1; current = current + 1; freezeUsed = true; }
        else { current = 1; }
      }
    }
    const longest = Math.max(s.longest_streak, current);
    const milestones = [7, 30, 100];
    const milestone = milestones.includes(current) && current > s.current_streak ? current : null;

    const { data: upd } = await supabase.from("streaks").update({
      current_streak: current,
      longest_streak: longest,
      last_planned_date: today,
      freezes_remaining: freezes,
    }).eq("user_id", user.id).select().maybeSingle();
    if (upd) setStreak(upd as Streak);
    return { ...(upd as Streak), milestone, freezeUsed };
  }, [user?.id]);

  return { streak, loading, refresh, recordPlanToday };
};