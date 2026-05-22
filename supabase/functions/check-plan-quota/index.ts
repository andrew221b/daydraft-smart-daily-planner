import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const FREE_LIMIT = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: userRes, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
    const user = userRes.user;

    // Pro / trial bypasses quota. Dev-only: x-dd-dev-pro:1 also bypasses
    // so the Settings "Simulate Pro" toggle unlocks server-side gating.
    const devProHeader = req.headers.get("x-dd-dev-pro") === "1";
    if (devProHeader) return json({ allowed: true, used: 0, limit: null, tier: "pro" });
    const { data: sub } = await supabase.from("subscriptions").select("status, trial_ends_at").eq("user_id", user.id).maybeSingle();
    const isPro = sub?.status === "active" ||
      (sub?.status === "trialing" && sub?.trial_ends_at && new Date(sub.trial_ends_at) > new Date());
    if (isPro) return json({ allowed: true, used: 0, limit: null, tier: sub?.status === "active" ? "pro" : "trial" });

    let sinceStr: string;
    try {
      const body = await req.json();
      sinceStr =
        typeof body?.since_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.since_date)
          ? body.since_date
          : (() => {
              const s = new Date();
              s.setDate(s.getDate() - 6);
              return s.toISOString().slice(0, 10);
            })();
    } catch {
      const s = new Date();
      s.setDate(s.getDate() - 6);
      sinceStr = s.toISOString().slice(0, 10);
    }

    const { data: plans } = await supabase
      .from("plans")
      .select("date, blocks(id)")
      .eq("user_id", user.id)
      .gte("date", sinceStr);
    const used = new Set(
      (plans || [])
        .filter((p: { blocks?: { id: string }[] | null }) => Array.isArray(p.blocks) && p.blocks.length > 0)
        .map((p: { date: string }) => p.date),
    ).size;
    const allowed = used < FREE_LIMIT;
    return json({ allowed, used, limit: FREE_LIMIT, tier: "free" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}