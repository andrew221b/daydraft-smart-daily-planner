import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchDayPlan, planDayQueryKey, planDashboardQueryKey } from "@/lib/planQueries";
import type { Block } from "@/lib/daydraft";
import { todayDateStr } from "@/lib/daydraft";
import {
  attachNotificationActionListener,
  registerNotificationActions,
  requestLocalNotificationPermissions,
  syncBlockNotifications,
} from "@/lib/localNotifications";

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

  return null;
}
