import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { dispatchNudge } from "../_shared/pushDispatch.ts";
import {
  type BlockRow,
  type CategoryRow,
  type EnergyZones,
  type TimeEntryRow,
  buildEveningDebrief,
  buildMorningBrief,
  energyPeakInMin,
  nextEvent,
  parseHm,
  summarizeDay,
  trackedAndEarnings,
  ymdInTz,
} from "../_shared/briefData.ts";

/**
 * Cron-driven nudge dispatcher. Run every 15 minutes.
 *
 * For each user whose local clock matches a nudge slot, this builds a
 * data-driven push and fans it out to BOTH native (APNs/FCM) and Web Push via
 * the shared dispatcher. Two slots carry real value:
 *
 *   • morning  → yesterday's unfinished tasks + today's first event + energy
 *                peak + streak momentum. Deep-links to /today to plan.
 *   • evening  → today's score (X/Y tasks, hours tracked, earnings) + an offer
 *                to carry unfinished work forward. Deep-links to /reports.
 *
 * A Sunday-evening weekly pointer is preserved as a light touch.
 *
 * Dedup is handled inside dispatchNudge via notification_log, so overlapping
 * cron windows can't double-send. Web Push runs in dry-run automatically when
 * VAPID_* env vars are absent; native runs whenever APNs/FCM creds exist.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, timezone, morning_nudge_local_time, evening_nudge_local_time, notifications_enabled, energy_zones");

    const nowUtc = new Date();
    const nowMs = nowUtc.getTime();

    let usersMatched = 0;
    let fired = 0;
    let nativeSent = 0;
    let webSent = 0;

    /** Plan id for a user on a local date, or null. */
    const planId = async (userId: string, date: string): Promise<string | null> => {
      const { data } = await admin
        .from("plans").select("id").eq("user_id", userId).eq("date", date).maybeSingle();
      return (data?.id as string) ?? null;
    };

    /** All blocks for a plan, ordered. */
    const blocksFor = async (pid: string): Promise<BlockRow[]> => {
      const { data } = await admin
        .from("blocks")
        .select("id,title,type,kind,start_time,duration_min,slot_end_time,completed,resolution,estimated_minutes,actual_minutes,is_calendar_event")
        .eq("plan_id", pid)
        .order("position");
      return (data as BlockRow[]) ?? [];
    };

    for (const p of profiles || []) {
      if (!p.notifications_enabled) continue;
      const userId = p.id as string;
      const tz = (p.timezone as string) || "UTC";

      const localStr = (() => {
        try {
          return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz, weekday: "short" }).format(nowUtc);
        } catch {
          return "Mon, 00:00";
        }
      })();
      // "Sun, 21:00"
      const [dow, hm] = localStr.split(", ");
      const todayLocal = ymdInTz(nowUtc, tz);
      const morning = String(p.morning_nudge_local_time || "07:00").slice(0, 5);
      const evening = String(p.evening_nudge_local_time || "21:00").slice(0, 5);

      // ── Morning brief ──────────────────────────────────────────────────
      if (hm === morning) {
        usersMatched += 1;

        const y = new Date(`${todayLocal}T12:00:00Z`);
        y.setUTCDate(y.getUTCDate() - 1);
        const yesterday = y.toISOString().slice(0, 10);

        const [yPid, tPid, streakRow] = await Promise.all([
          planId(userId, yesterday),
          planId(userId, todayLocal),
          admin.from("streaks").select("current_streak").eq("user_id", userId).maybeSingle(),
        ]);
        const [yBlocks, tBlocks] = await Promise.all([
          yPid ? blocksFor(yPid) : Promise.resolve([] as BlockRow[]),
          tPid ? blocksFor(tPid) : Promise.resolve([] as BlockRow[]),
        ]);

        const nudge = buildMorningBrief({
          yesterday: summarizeDay(yBlocks),
          next: nextEvent(tBlocks, parseHm(hm)),
          energyPeakMin: energyPeakInMin((p.energy_zones as EnergyZones) ?? null, parseHm(hm)),
          streak: Number(streakRow.data?.current_streak || 0),
          localDate: todayLocal,
        });

        const r = await dispatchNudge(admin, userId, "morning", todayLocal, nudge);
        if (r.fired) { fired += 1; nativeSent += r.nativeSent; webSent += r.webSent; }
        continue;
      }

      // ── Evening debrief ────────────────────────────────────────────────
      if (hm === evening) {
        usersMatched += 1;

        const tPid = await planId(userId, todayLocal);
        if (!tPid) continue; // nothing planned → nothing to debrief

        const tBlocks = await blocksFor(tPid);
        // Pull entries from the last ~36h and filter to today (local) in the
        // metric helper — covers late-night sessions without a tz round-trip.
        const since = new Date(nowMs - 36 * 3600 * 1000).toISOString();
        const [entriesRes, catsRes] = await Promise.all([
          admin.from("time_entries").select("started_at,ended_at,category_id").eq("user_id", userId).gte("started_at", since),
          admin.from("time_categories").select("id,hourly_rate,currency").eq("user_id", userId),
        ]);

        const { trackedMin, earnings } = trackedAndEarnings(
          (entriesRes.data as TimeEntryRow[]) ?? [],
          (catsRes.data as CategoryRow[]) ?? [],
          todayLocal,
          tz,
          nowMs,
        );

        const nudge = buildEveningDebrief({
          today: summarizeDay(tBlocks),
          trackedMin,
          earnings,
          localDate: todayLocal,
        });

        const r = await dispatchNudge(admin, userId, "evening", todayLocal, nudge);
        if (r.fired) { fired += 1; nativeSent += r.nativeSent; webSent += r.webSent; }
        continue;
      }

      // ── Weekly pointer (Sun 18:00 local) — light, optional ─────────────
      if (dow === "Sun" && hm === "18:00") {
        usersMatched += 1;
        const r = await dispatchNudge(admin, userId, "weekly", todayLocal, {
          title: "Your week in review",
          body: "See where your hours went and pick one thing to adjust.",
          url: "/reports",
        });
        if (r.fired) { fired += 1; nativeSent += r.nativeSent; webSent += r.webSent; }
        continue;
      }
    }

    return new Response(JSON.stringify({
      now_utc: nowUtc.toISOString(),
      users_matched: usersMatched,
      fired,
      native_sent: nativeSent,
      web_sent: webSent,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
