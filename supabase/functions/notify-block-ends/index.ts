import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, api-key, apikey, content-type, x-dd-dev-pro",
};

/**
 * Service-role cron: every ~5 minutes, notify users whose task blocks end soon (local TZ).
 * Call with Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
 *
 * Mirrors send-daily-nudges dry-run/live push behavior when VAPID_* env vars exist.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!bearer || bearer !== serviceRole) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRole);

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@daydraft.app";
    const liveMode = Boolean(vapidPublic && vapidPrivate);
    if (liveMode) webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,timezone,notifications_enabled");

    let checked = 0;
    let windowHits = 0;
    let sent = 0;
    let scheduled = 0;
    let failed = 0;

    const hhmmTz = (d: Date, tz: string) => {
      try {
        return new Intl.DateTimeFormat("en-GB", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(d);
      } catch {
        const h = d.getHours();
        const m = d.getMinutes();
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
    };

    const ymdTz = (d: Date, tz: string) => {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
      } catch {
        return d.toISOString().slice(0, 10);
      }
    };

    const parseHm = (s: string) => {
      const [h, m] = String(s || "00:00").split(":").map(Number);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };

    const nowUtc = new Date();

    for (const p of profiles || []) {
      if (!p.notifications_enabled) continue;
      const tz = (p.timezone as string) || "UTC";
      const todayLocal = ymdTz(nowUtc, tz);
      const hm = hhmmTz(nowUtc, tz);
      const nowMin = parseHm(hm);

      checked += 1;

      const { data: plan } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", p.id as string)
        .eq("date", todayLocal)
        .maybeSingle();
      if (!plan?.id) continue;

      const { data: blocks } = await supabase
        .from("blocks")
        .select("id,title,start_time,duration_min,slot_end_time,kind,completed,is_calendar_event")
        .eq("plan_id", plan.id)
        .order("position");

      for (const b of blocks || []) {
        if (!(b.kind === "task" || b.kind === "lunch")) continue;
        if (b.completed || b.is_calendar_event) continue;
        const sm = parseHm(String(b.start_time || "09:00"));
        const dm = Number(b.duration_min || 0);
        if (!(dm > 0) && !(typeof b.slot_end_time === "string" && /^\d{2}:\d{2}$/.test(b.slot_end_time))) continue;
        const endStr =
          typeof b.slot_end_time === "string" && /^\d{2}:\d{2}$/.test(b.slot_end_time)
            ? b.slot_end_time
            : (() => {
              const cap = sm + dm;
              const h = Math.floor(cap / 60);
              const mi = cap % 60;
              return `${String(Math.min(23, h)).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
            })();
        const endMinFull = parseHm(endStr);
        const diff = endMinFull - nowMin;
        /** Fire if block ends inside this cron window (~5 min lookahead) */
        if (diff < 1 || diff > 6) continue;
        windowHits += 1;
        const body = `"${String(b.title || "Block").slice(0, 60)}" wraps soon — glance at what's next`;
        const payload = { title: "Slot winding down", body, url: "/home" };
        const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", p.id as string);
        if (!subs?.length) continue;
        for (const s of subs) {
          if (!liveMode) {
            scheduled += 1;
            console.log("slot-end dry-run:", { user: p.id, block: b.id, diff_min: diff });
            continue;
          }
          try {
            await webpush.sendNotification(
              {
                endpoint: s.endpoint,
                keys: { p256dh: s.p256dh, auth: s.auth },
              } as any,
              JSON.stringify(payload),
              {
                TTL: 120,
                headers: {
                  /** Collapse duplicate pings for this block/day */
                  Urgency: "normal",
                },
              },
            );
            sent += 1;
            scheduled += 1;
          } catch (e) {
            console.error(e);
            failed += 1;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        mode: liveMode ? "live" : "dry-run",
        checked_profiles: checked,
        window_hits: windowHits,
        sent,
        scheduled,
        failed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
