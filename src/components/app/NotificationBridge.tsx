import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useProfileData } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { fetchDayPlan, planDayQueryKey, planDashboardQueryKey } from "@/lib/planQueries";
import type { Block } from "@/lib/daydraft";
import { todayDateStr, shiftDate, isUserTask, isUserTaskDone } from "@/lib/daydraft";
import {
  attachNotificationActionListener,
  ensureNotificationChannel,
  registerNotificationActions,
  requestLocalNotificationPermissions,
  syncBlockNotifications,
  syncDailyNudges,
  cancelDailyNudges,
  syncSmartNudge,
  cancelSmartNudge,
  getDailyNudgesEnabled,
} from "@/lib/localNotifications";
import { buildMorningFresh, buildEveningFresh } from "@/lib/nudgeTemplates";

/**
 * Wires native notification actions into the app:
 *   • body tap     → navigate to the plan
 *   • Start / Track→ open Focus for that task
 *   • Done / Skip  → resolve the task in the background, then re-sync the
 *                    day's notifications so the resolved task stops pinging
 *
 * Mounted once near the app root, inside the router + auth + query providers.
 * No-op on web.
 */
export function NotificationBridge() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { profile } = useProfileData();

  // Keep the latest user id in a ref so the (once-attached) listener closure
  // always resolves against the current account without re-subscribing.
  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let detach: (() => void) | null = null;
    let cancelled = false;

    // After resolving a task from a notification, refresh the plan caches and
    // reschedule that day's pings (drops the now-resolved task's follow-ups).
    const refreshAfterAction = async (date: string) => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: planDayQueryKey(uid, date) }),
          queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(uid, date) }),
        ]);
        const data = await fetchDayPlan(uid, date);
        await syncBlockNotifications(date, (data?.blocks ?? []) as Block[]);
      } catch {
        /* non-fatal */
      }
    };

    const handleComplete = async (blockId: string, date?: string) => {
      const uid = userIdRef.current;
      if (!uid) return;
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("blocks")
        .update({
          completed: true,
          completed_at: nowIso,
          resolution: "done",
          resolved_at: nowIso,
        } as never)
        .eq("id", blockId);
      if (error) {
        toast.error("Couldn't mark done");
        return;
      }
      toast.success("Marked done");
      void refreshAfterAction(date || todayDateStr());
    };

    const handleSkip = async (blockId: string, date?: string) => {
      const uid = userIdRef.current;
      if (!uid) return;
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("blocks")
        .update({
          resolution: "skipped",
          resolved_at: nowIso,
          completed: false,
        } as never)
        .eq("id", blockId);
      if (error) {
        toast.error("Couldn't skip");
        return;
      }
      toast("Skipped");
      void refreshAfterAction(date || todayDateStr());
    };

    (async () => {
      await registerNotificationActions();
      await ensureNotificationChannel();
      await requestLocalNotificationPermissions();
      if (cancelled) return;
      detach = await attachNotificationActionListener({
        onNavigate: (path) => navigate(path),
        onComplete: handleComplete,
        onSkip: handleSkip,
      });
    })();

    return () => {
      cancelled = true;
      if (detach) detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, queryClient]);

  // ── Daily nudges (morning / evening brief) ────────────────────────────────
  // On-device, scheduled in advance from a template pool — no server. Today's
  // slots are enriched with the user's real numbers (computed here on open);
  // future days fall back to evergreen templates as a buffer. Re-synced on
  // foreground (throttled) to refresh the copy and roll the horizon forward.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let detached = false;
    let detach: (() => void) | null = null;
    let lastSync = 0;

    const computeTodayFresh = async (uid: string) => {
      const today = todayDateStr();
      const yesterday = shiftDate(today, -1);
      try {
        const [t, y] = await Promise.all([fetchDayPlan(uid, today), fetchDayPlan(uid, yesterday)]);
        const summarize = (blocks?: Block[]) => {
          const tasks = (blocks ?? []).filter((b) => isUserTask(b));
          return { total: tasks.length, done: tasks.filter((b) => isUserTaskDone(b)).length };
        };
        const td = summarize(t?.blocks as Block[] | undefined);
        const yd = summarize(y?.blocks as Block[] | undefined);
        return {
          morning: buildMorningFresh({
            yesterdayDone: yd.done,
            yesterdayTotal: yd.total,
            todayTotal: td.total,
            name: profile?.display_name ?? undefined,
          }),
          evening: buildEveningFresh({ done: td.done, total: td.total }),
        };
      } catch {
        return undefined; // best-effort — caller falls back to evergreen copy
      }
    };

    // Peak "follow-through" hour from learned patterns. Hours are local
    // wall-clock (derived from each task's start_time); the value is a
    // completion-rate %. Returns null unless there's a clear, trustworthy
    // signal, in which case no smart nudge is scheduled at all.
    const fetchPeakHour = async (uid: string): Promise<number | null> => {
      try {
        const { data } = await supabase
          .from("user_patterns")
          .select("completion_by_hour")
          .eq("user_id", uid)
          .maybeSingle();
        const cbh = (data?.completion_by_hour ?? null) as Record<string, number> | null;
        if (!cbh) return null;
        const entries = Object.entries(cbh)
          .map(([h, pct]) => [parseInt(h, 10), Number(pct)] as [number, number])
          .filter(([h, pct]) => Number.isInteger(h) && h >= 0 && h <= 23 && Number.isFinite(pct));
        // Need real history across several hours before trusting a "peak".
        if (entries.length < 4) return null;
        let bestHour = -1;
        let bestPct = -1;
        for (const [h, pct] of entries) {
          if (pct > bestPct) { bestPct = pct; bestHour = h; }
        }
        // Only when the user genuinely follows through at that hour (matches the
        // ≥70% bar the chat already uses to call out "finishes most around …").
        if (bestPct < 70 || bestHour < 0) return null;
        return bestHour;
      } catch {
        return null; // best-effort; absence of a smart nudge is harmless
      }
    };

    const run = async () => {
      const uid = userIdRef.current;
      if (cancelled || !uid) return;
      if (!getDailyNudgesEnabled()) {
        await cancelDailyNudges();
        await cancelSmartNudge();
        return;
      }
      const todayFresh = await computeTodayFresh(uid);
      if (cancelled) return;
      await syncDailyNudges({
        morningTime: profile?.morning_nudge_local_time,
        eveningTime: profile?.evening_nudge_local_time,
        todayFresh,
      });
      // Pattern-timed bonus nudge at the user's productive window (best-effort;
      // no-op when there's no clear peak or it sits too close to the briefs).
      const peakHour = await fetchPeakHour(uid);
      if (cancelled) return;
      await syncSmartNudge({
        peakHour,
        morningTime: profile?.morning_nudge_local_time,
        eveningTime: profile?.evening_nudge_local_time,
      });
      lastSync = Date.now();
    };

    void run();

    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && Date.now() - lastSync > 10 * 60_000) void run();
    }).then((h) => {
      if (detached) {
        h.remove();
        return;
      }
      detach = () => h.remove();
    });

    return () => {
      cancelled = true;
      detached = true;
      if (detach) detach();
    };
    // Re-run when nudge times / name arrive (profile loads async).
  }, [profile?.morning_nudge_local_time, profile?.evening_nudge_local_time, profile?.display_name]);

  return null;
}
