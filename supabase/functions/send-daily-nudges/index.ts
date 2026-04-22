import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

/**
 * Cron-driven push dispatcher. Run every 15 minutes.
 * Picks users whose local time matches morning/evening nudge slots (or Sunday 18:00 for weekly).
 * NOTE: actual web-push delivery requires VAPID keys and a webpush library; this stub
 * logs what would be sent and writes a row count so the system can be wired without code changes
 * once VAPID secrets are in place.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profiles } = await supabase.from("profiles").select("id, timezone, morning_nudge_local_time, evening_nudge_local_time, notifications_enabled");
    const nowUtc = new Date();
    let scheduled = 0;

    for (const p of profiles || []) {
      if (!p.notifications_enabled) continue;
      const tz = p.timezone || "UTC";
      const localStr = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz, weekday: "short" }).format(nowUtc);
      // localStr like "Sun, 21:00"
      const [dow, hm] = localStr.split(", ");
      const morning = (p.morning_nudge_local_time || "07:00").slice(0, 5);
      const evening = (p.evening_nudge_local_time || "21:00").slice(0, 5);

      let payload: { title: string; body: string; url: string } | null = null;
      if (hm === morning) payload = { title: "Ready to draft today?", body: "5 minutes now saves an hour later.", url: "/today" };
      else if (hm === evening) payload = { title: "Mark today's wins", body: "Close out and see your insight.", url: "/recap" };
      else if (dow === "Sun" && hm === "18:00") payload = { title: "Your week in review", body: "See what you shipped.", url: "/recap/week" };
      if (!payload) continue;

      const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", p.id);
      for (const s of subs || []) {
        // TODO: send via web-push when VAPID keys are configured
        console.log("would push:", { user: p.id, endpoint: s.endpoint, payload });
        scheduled += 1;
      }
    }
    return new Response(JSON.stringify({ scheduled }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});