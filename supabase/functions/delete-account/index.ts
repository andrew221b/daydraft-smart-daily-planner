import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

/**
 * Permanent account deletion. Wipes every row the caller owns across
 * user-data tables, then deletes the auth.users record so the email
 * can be reused.
 *
 * Auth: caller's JWT (Authorization: Bearer …). We verify it before
 * touching anything; the actual deletes run with the service-role
 * client because most user-data tables have RLS that only allows
 * SELECT/UPDATE for the row owner, not delete-cascade across tables.
 *
 * Body (optional): { confirm: "DELETE" } — defensive guard so a
 * stale or replayed request can't nuke an account without a
 * deliberate confirmation from the client.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    let body: { confirm?: string } = {};
    try { body = await req.json(); } catch { /* empty body — handled below */ }
    if (body.confirm !== "DELETE") {
      return json({ error: "Missing or wrong confirmation token" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const uid = user.id;

    // Order matters: blocks reference plans, so they must go first.
    // Everything else keys directly off user_id, so the order between
    // them doesn't matter — we still serialize each delete to surface
    // any FK error individually instead of as a generic batch failure.
    const { data: plans = [] } = await admin
      .from("plans").select("id").eq("user_id", uid);
    const planIds = (plans ?? []).map((p: { id: string }) => p.id);

    if (planIds.length) {
      const { error } = await admin.from("blocks").delete().in("plan_id", planIds);
      if (error) throw new Error(`blocks: ${error.message}`);
    }

    const userTables = [
      "plans",
      "time_entries",
      "time_categories",
      "block_templates",
      "push_subscriptions",
      "push_tokens",
      "quick_captures",
      "user_patterns",
      "billing_payment_details",
    ] as const;

    for (const table of userTables) {
      const { error } = await admin.from(table).delete().eq("user_id", uid);
      if (error) throw new Error(`${table}: ${error.message}`);
    }

    // Profile keys off `id`, not `user_id`.
    const { error: profileErr } = await admin.from("profiles").delete().eq("id", uid);
    if (profileErr) throw new Error(`profiles: ${profileErr.message}`);

    // Finally, the auth user. Once this succeeds the JWT in the caller's
    // session becomes invalid — the client should immediately sign out.
    const { error: deleteUserErr } = await admin.auth.admin.deleteUser(uid);
    if (deleteUserErr) throw new Error(`auth.users: ${deleteUserErr.message}`);

    return json({ ok: true });
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
