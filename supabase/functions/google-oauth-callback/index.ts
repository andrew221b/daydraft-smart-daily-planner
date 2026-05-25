import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "unauthorized" }, 401);
    const { code, redirect_uri } = await req.json();
    if (!code) return json({ error: "code required" }, 400);

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    if (!clientId || !clientSecret) return json({ error: "Google Calendar OAuth not configured" }, 500);

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri, grant_type: "authorization_code",
      }),
    });
    const tok = await tokenResp.json();
    if (!tokenResp.ok || !tok.refresh_token) {
      return json({ error: "token exchange failed", detail: tok }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    // Pull email
    let email: string | null = null;
    try {
      const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const meJson = await me.json();
      email = meJson.email || null;
    } catch {
      // ignore error, email defaults to null
    }

    const expires_at = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
    await supabase.from("calendar_tokens").upsert({
      user_id: u.user.id,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      expires_at, email,
    } as any, { onConflict: "user_id" });

    return json({ ok: true, email });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}