import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const { data: tok } = await supabase.from("calendar_tokens").select("*").eq("user_id", u.user.id).maybeSingle();
    if (!tok) return json({ events: [] });

    let access = tok.access_token as string | null;
    if (!access || (tok.expires_at && new Date(tok.expires_at) <= new Date())) {
      const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
      const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
      if (!clientId || !clientSecret) return json({ events: [] });
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret,
          refresh_token: tok.refresh_token, grant_type: "refresh_token",
        }),
      });
      const j = await r.json();
      if (j.access_token) {
        access = j.access_token;
        const expires_at = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
        await supabase.from("calendar_tokens").update({ access_token: access, expires_at } as any).eq("user_id", u.user.id);
      } else return json({ events: [], error: "refresh failed" });
    }

    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", start.toISOString());
    url.searchParams.set("timeMax", end.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    const r = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
    const j = await r.json();
    const events = (j.items || []).filter((e: any) => e.start?.dateTime).map((e: any) => {
      const s = new Date(e.start.dateTime);
      const eD = new Date(e.end.dateTime);
      return {
        id: e.id,
        title: e.summary || "(no title)",
        start_time: `${String(s.getHours()).padStart(2,"0")}:${String(s.getMinutes()).padStart(2,"0")}`,
        duration_min: Math.max(15, Math.round((eD.getTime() - s.getTime()) / 60000)),
        location: e.location || null,
      };
    });
    return json({ events });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}