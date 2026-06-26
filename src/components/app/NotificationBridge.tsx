import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useProfileData, useProfileMutations } from "@/hooks/useProfile";
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
  getDailyNudgesEnabled,
} from "@/lib/localNotifications";
import { buildMorningFresh, buildEveningFresh } from "@/lib/nudgeTemplates";

// Default nudge times. The morning/evening columns predate any Settings UI, so
// rows still holding the old cron-era defaults (07:00 / 21:00) are untouched —
// bumped once to these so the new pickers + schedule start where users expect.
const DEFAULT_MORNING = "08:00";
const DEFAULT_EVENING = "20:00";
const LEGACY_MORNING = "07:00";
const LEGACY_EVENING = "21:00";
const NUDGE_TIMES_DEFAULTED_KEY = "dd_nudge_times_defaulted";

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
  const { update } = useProfileMutations();

  // One-time: bump untouched legacy nudge times (07:00 / 21:00) to the new
  // 8am / 8pm defaults so the schedule + Settings pickers start where expected.
  // Guarded by a localStorage flag so it never overrides a deliberate choice.
  useEffect(() => {
    if (!profile) return;
    try {
      if (localStorage.getItem(NUDGE_TIMES_DEFAULTED_KEY) === "1") return;
    } catch { /* ignore */ }
    const patch: Record<string, string> = {};
    if (!profile.morning_nudge_local_time || profile.morning_nudge_local_time === LEGACY_MORNING) {
      patch.morning_nudge_local_time = DEFAULT_MORNING;
    }
    if (!profile.evening_nudge_local_time || profile.evening_nudge_local_time === LEGACY_EVENING) {
      patch.evening_nudge_local_time = DEFAULT_EVENING;
    }
    try { localStorage.setItem(NUDGE_TIMES_DEFAULTED_KEY, "1"); } catch { /* ignore */ }
    if (Object.keys(patch).length) void update(patch);
  }, [profile, update]);

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

  // ── Daily nudges (morning brief + evening recap) ──────────────────────────
  // On-device, scheduled in advance from template pools — no server. Today's
  // slots are enriched with the user's real numbers (computed here on open);
  // future days fall back to evergreen templates as a buffer. Each fires at a
  // user-set time (Settings → Daily nudges; defaults 08:00 / 20:00). Re-synced
  // on foreground (throttled) to refresh copy and roll the horizon forward.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let detached = false;
    let detach: (() => void) | null = null;
    let lastSync = 0;

    // Build today's morning + evening copy from real numbers. Each returns null
    // when there's nothing to say, and the scheduler falls back to evergreen.
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
        const name = profile?.display_name ?? undefined;
        return {
          morning: buildMorningFresh({ yesterdayDone: yd.done, yesterdayTotal: yd.total, todayTotal: td.total, name }),
          evening: buildEveningFresh({ todayDone: td.done, todayTotal: td.total, name }),
        };
      } catch {
        return { morning: null, evening: null }; // best-effort — evergreen fallback
      }
    };

    const run = async () => {
      const uid = userIdRef.current;
      if (cancelled || !uid) return;
      if (!getDailyNudgesEnabled()) {
        await cancelDailyNudges();
        return;
      }
      const fresh = await computeTodayFresh(uid);
      if (cancelled) return;
      await syncDailyNudges({
        morningTime: profile?.morning_nudge_local_time || "08:00",
        eveningTime: profile?.evening_nudge_local_time || "20:00",
        morningFresh: fresh.morning,
        eveningFresh: fresh.evening,
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
    // Re-run when the nudge times / name arrive or change (profile loads async).
  }, [profile?.morning_nudge_local_time, profile?.evening_nudge_local_time, profile?.display_name]);

  return null;
}
