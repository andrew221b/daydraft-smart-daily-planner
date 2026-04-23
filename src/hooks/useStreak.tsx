import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { todayDateStr, dateStr } from "@/lib/daydraft";

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
  // Idempotency guard: prevents double-recording within the same session if
  // recordPlanToday is invoked twice in quick succession (double-tap on Plan).
  const recordingRef = useRef<Promise<any> | null>(null);

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
        // Local date key — UTC slice would drift a day in negative offsets.
        freeze_resets_at: dateStr(next),
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
    if (recordingRef.current) return recordingRef.current;
    const today = todayDateStr();
    const run = (async () => {
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
    }).eq("user_id", user.id).neq("last_planned_date", today).select().maybeSingle();
    // If the row was updated by a concurrent call (last_planned_date became today),
    // re-read the current value and return it without an extra increment.
    if (!upd) {
      const { data: latest } = await supabase.from("streaks").select("*").eq("user_id", user.id).maybeSingle();
      if (latest) setStreak(latest as Streak);
      return latest ? { ...(latest as Streak), milestone: null as number | null, freezeUsed: false } : null;
    }
    if (upd) setStreak(upd as Streak);
    return { ...(upd as Streak), milestone, freezeUsed };
    })();
    recordingRef.current = run;
    try { return await run; } finally { recordingRef.current = null; }
  }, [user?.id]);

  // Manually restore yesterday's streak using a freeze, when the user missed a single day.
  const restoreWithFreeze = useCallback(async () => {
    if (!user || !streak) return false;
    if (streak.freezes_remaining < 1) return false;
    const today = todayDateStr();
    if (!streak.last_planned_date) return false;
    const gap = daysBetween(streak.last_planned_date, today);
    // Only valid when exactly one day was missed (yesterday was skipped).
    if (gap !== 2) return false;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const { data: upd } = await supabase.from("streaks").update({
      freezes_remaining: streak.freezes_remaining - 1,
      // Pretend yesterday was planned so today can continue the streak naturally.
      last_planned_date: dateStr(yesterday),
    }).eq("user_id", user.id).select().maybeSingle();
    if (upd) setStreak(upd as Streak);
    return true;
  }, [user?.id, streak]);

  return { streak, loading, refresh, recordPlanToday, restoreWithFreeze };
};