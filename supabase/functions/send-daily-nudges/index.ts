import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import webpush from "npm:web-push@3.6.7";

/**
 * Cron-driven push dispatcher. Run every 15 minutes.
 * Picks users whose local time matches nudge slots and attempts Web Push delivery.
 *
 * Required env vars for live mode:
 * - VAPID_PUBLIC_KEY
 * - VAPID_PRIVATE_KEY
 * - VAPID_SUBJECT (e.g. mailto:support@yourapp.com)
 *
 * If keys are missing, function falls back to dry-run scheduling.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@daydraft.app";
    const liveMode = Boolean(vapidPublic && vapidPrivate);
    if (liveMode) {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, timezone, morning_nudge_local_time, evening_nudge_local_time, notifications_enabled, ai_tone");
    const nowUtc = new Date();
    let scheduled = 0;
    let usersMatched = 0;
    let usersWithoutSubscriptions = 0;
    let sent = 0;
    let failed = 0;
    let removedExpired = 0;

    for (const p of profiles || []) {
      if (!p.notifications_enabled) continue;
      const tz = p.timezone || "UTC";
      const localStr = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz, weekday: "short" }).format(nowUtc);
      // localStr like "Sun, 21:00"
      const [dow, hm] = localStr.split(", ");
      const morning = (p.morning_nudge_local_time || "07:00").slice(0, 5);
      const evening = (p.evening_nudge_local_time || "21:00").slice(0, 5);

      const tone = p.ai_tone || "professional";
      const nudgeText = {
        professional: {
          morning: { title: "Plan your day", body: "Five minutes now can save an hour later." },
          evening: { title: "Review today's progress", body: "Close the day with a quick recap." },
          weekly: { title: "Weekly review is ready", body: "Check your weekly patterns and next steps." },
        },
        coach: {
          morning: { title: "Let's set up today", body: "A short plan now will make the day smoother." },
          evening: { title: "Let's close today well", body: "Take one minute to capture what worked." },
          weekly: { title: "Weekly reflection is ready", body: "Review your week and choose one improvement." },
        },
        playful: {
          morning: { title: "Ready to make today click?", body: "Quick plan, clearer day." },
          evening: { title: "Time for a quick wrap-up", body: "Capture today's progress in under a minute." },
          weekly: { title: "Your weekly snapshot is ready", body: "See the pattern, then pick your next move." },
        },
        motivational: {
          morning: { title: "Start with intent", body: "Set the plan now and keep momentum all day." },
          evening: { title: "Finish strong", body: "Review today and line up tomorrow's first move." },
          weekly: { title: "Your weekly score is in", body: "Review, adjust, and raise the standard." },
        },
        tough_love: {
          morning: { title: "Plan now", body: "No plan means drift. Lock it in." },
          evening: { title: "Review your output", body: "Check what got done and what did not." },
          weekly: { title: "Weekly accountability check", body: "Review results and tighten your plan." },
        },
        philosophical: {
          morning: { title: "Begin with intention", body: "A clear plan gives shape to attention." },
          evening: { title: "Close the loop", body: "Reflection now improves tomorrow's execution." },
          weekly: { title: "Weekly reflection is ready", body: "Patterns become insight when reviewed." },
        },
      } as const;

      const copy = (nudgeText as Record<string, typeof nudgeText.professional>)[tone] || nudgeText.professional;
      let payload: { title: string; body: string; url: string } | null = null;
      if (hm === morning) payload = { ...copy.morning, url: "/today" };
      else if (hm === evening) payload = { ...copy.evening, url: "/recap" };
      else if (dow === "Sun" && hm === "18:00") payload = { ...copy.weekly, url: "/recap/week" };
      if (!payload) continue;
      usersMatched += 1;

      const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", p.id);
      if (!subs?.length) {
        usersWithoutSubscriptions += 1;
        continue;
      }
      for (const s of subs || []) {
        if (!liveMode) {
          console.log("push-scheduled-dry-run:", {
            user: p.id,
            endpoint: s.endpoint,
            title: payload.title,
            url: payload.url,
            tone,
            local_time: hm,
            local_weekday: dow,
          });
          scheduled += 1;
          continue;
        }
        const subscription = {
          endpoint: s.endpoint,
          keys: {
            p256dh: s.p256dh,
            auth: s.auth,
          },
        };
        try {
          await webpush.sendNotification(
            subscription as any,
            JSON.stringify(payload),
            { TTL: 120 }
          );
          sent += 1;
        } catch (e: any) {
          failed += 1;
          const statusCode = Number(e?.statusCode || e?.status || 0);
          const isExpired = statusCode === 404 || statusCode === 410;
          console.error("push-send-failed:", {
            user: p.id,
            endpoint: s.endpoint,
            statusCode,
            message: e?.message || "unknown",
          });
          if (isExpired) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("user_id", p.id)
              .eq("endpoint", s.endpoint);
            removedExpired += 1;
          }
        }
        scheduled += 1;
      }
    }
    return new Response(JSON.stringify({
      mode: liveMode ? "live" : "dry-run",
      scheduled,
      usersMatched,
      usersWithoutSubscriptions,
      sent,
      failed,
      removedExpired,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});