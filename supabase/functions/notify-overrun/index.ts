import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { dispatchNudge } from "../_shared/pushDispatch.ts";
import {
  type BlockRow,
  buildOverrun,
  computeOverrun,
  hhmmInTz,
  parseHm,
  ymdInTz,
} from "../_shared/briefData.ts";

/**
 * Mid-day "running behind" check. Run every 30 minutes.
 *
 * For each user with a plan today, it compares the still-open planned minutes
 * against the time left before their active-hours end. When there's
 * meaningfully more work than time — and only inside a sane mid-day window —
 * it fires ONE overrun nudge offering a reschedule. Deep-links to /today/plan.
 *
 * Once-per-day is enforced by notification_log (kind = 'overrun') inside the
 * shared dispatcher, so this can run on a tight cadence without nagging.
 *
 * Service-role bearer only (mirrors notify-block-ends): cron passes
 * Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
 */

// How far behind (planned minutes beyond time left) before it's worth a ping.
const BEHIND_THRESHOLD_MIN = 45;
// Don't fire before the day has had a fair shot, or once it's basically over.
const EARLIEST_AFTER_START_MIN = 120; // ≥ 2h into active hours
const LATEST_BEFORE_END_MIN = 60; // ≥ 1h of runway left to act on

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!bearer || bearer !== serviceRole) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRole);

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, timezone, notifications_enabled, active_hours_start, active_hours_end");

    const nowUtc = new Date();

    let checked = 0;
    let inWindow = 0;
    let fired = 0;
    let nativeSent = 0;
    let webSent = 0;

    for (const p of profiles || []) {
      if (!p.notifications_enabled) continue;
      const userId = p.id as string;
      const tz = (p.timezone as string) || "UTC";
      const hm = hhmmInTz(nowUtc, tz);
      const nowMin = parseHm(hm);
      const todayLocal = ymdInTz(nowUtc, tz);

      const activeStart = parseHm((p.active_hours_start as string) || "09:00");
      const activeEnd = parseHm((p.active_hours_end as string) || "22:00");

      // Only inside the actionable mid-day window.
      if (nowMin < activeStart + EARLIEST_AFTER_START_MIN) continue;
      if (nowMin > activeEnd - LATEST_BEFORE_END_MIN) continue;
      checked += 1;

      const { data: plan } = await admin
        .from("plans").select("id").eq("user_id", userId).eq("date", todayLocal).maybeSingle();
      if (!plan?.id) continue;

      const { data: blocksData } = await admin
        .from("blocks")
        .select("id,title,type,kind,start_time,duration_min,slot_end_time,completed,resolution,estimated_minutes,actual_minutes,is_calendar_event")
        .eq("plan_id", plan.id as string)
        .order("position");
      const blocks = (blocksData as BlockRow[]) ?? [];

      const overrun = computeOverrun(blocks, nowMin, activeEnd);
      if (overrun.remainingMin <= 0 || overrun.behindBy < BEHIND_THRESHOLD_MIN) continue;
      inWindow += 1;

      const nudge = buildOverrun({ overrun, nowHm: hm, localDate: todayLocal });
      const r = await dispatchNudge(admin, userId, "overrun", todayLocal, nudge);
      if (r.fired) { fired += 1; nativeSent += r.nativeSent; webSent += r.webSent; }
    }

    return new Response(JSON.stringify({
      now_utc: nowUtc.toISOString(),
      checked_in_window: checked,
      behind_users: inWindow,
      fired,
      native_sent: nativeSent,
      web_sent: webSent,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
