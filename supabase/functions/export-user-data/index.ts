import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

/**
 * GDPR-style data export. Returns every row the caller owns across
 * the user-data tables as a single JSON document. The shape mirrors
 * the DB schema 1:1 so the export round-trips cleanly if we ever add
 * an import path.
 *
 * Auth: the caller's JWT (Authorization: Bearer …) is required. We
 * authenticate it with the anon key first, then run the actual reads
 * with the service-role client so the export isn't bound by RLS
 * (we still scope every query to the authenticated user_id).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const uid = user.id;

    // Plans first — needed to scope blocks (which key off plan_id, not user_id).
    const { data: plans = [] } = await admin
      .from("plans").select("*").eq("user_id", uid);
    const planIds = (plans ?? []).map((p: { id: string }) => p.id);

    // Run the rest in parallel — none of them depend on each other.
    const [
      profile,
      blocks,
      categories,
      entries,
      patterns,
      templates,
      pushSubs,
      pushTokens,
      quickCaptures,
      billing,
    ] = await Promise.all([
      admin.from("profiles").select("*").eq("id", uid).maybeSingle(),
      planIds.length
        ? admin.from("blocks").select("*").in("plan_id", planIds)
        : Promise.resolve({ data: [] }),
      admin.from("time_categories").select("*").eq("user_id", uid),
      admin.from("time_entries").select("*").eq("user_id", uid),
      admin.from("user_patterns").select("*").eq("user_id", uid).maybeSingle(),
      admin.from("block_templates").select("*").eq("user_id", uid),
      admin.from("push_subscriptions").select("*").eq("user_id", uid),
      admin.from("push_tokens").select("*").eq("user_id", uid),
      admin.from("quick_captures").select("*").eq("user_id", uid),
      admin.from("billing_payment_details").select("*").eq("user_id", uid),
    ]);

    const payload = {
      meta: {
        export_version: 1,
        generated_at: new Date().toISOString(),
        user_id: uid,
        user_email: user.email ?? null,
        app: "DayDraft",
      },
      profile: profile.data ?? null,
      user_patterns: patterns.data ?? null,
      plans: plans ?? [],
      blocks: blocks.data ?? [],
      time_categories: categories.data ?? [],
      time_entries: entries.data ?? [],
      block_templates: templates.data ?? [],
      push_subscriptions: pushSubs.data ?? [],
      push_tokens: pushTokens.data ?? [],
      quick_captures: quickCaptures.data ?? [],
      billing_payment_details: billing.data ?? [],
    };

    const filename = `daydraft-export-${uid.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
