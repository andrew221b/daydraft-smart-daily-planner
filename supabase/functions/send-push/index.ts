import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { sendApns, isApnsDeadToken } from "../_shared/apns.ts";
import { sendFcm, isFcmDeadToken } from "../_shared/fcm.ts";

/**
 * Fan-out push sender. Reads `push_tokens` for the target user(s) and
 * dispatches an APNs push to iOS tokens and an FCM push to Android
 * tokens in parallel. Dead tokens (410 / UNREGISTERED / etc.) are
 * deleted on the spot so the table doesn't grow forever.
 *
 * Auth: requires the service-role key, OR a verified user JWT where
 * the user_id in the payload matches the authenticated user (so the
 * client can push to itself for testing).
 *
 * Body shape:
 *   { user_id: string, title: string, body: string,
 *     deep_link?: string,        // resolved by the client deep-link handler
 *     badge?: number,
 *     data?: Record<string,unknown>
 *   }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({})) as {
      user_id?: string;
      title?: string;
      body?: string;
      deep_link?: string;
      badge?: number;
      data?: Record<string, unknown>;
    };

    const { user_id, title, body: messageBody, deep_link, badge } = body;
    if (!user_id || !title || !messageBody) {
      return json({ error: "user_id, title, body required" }, 400);
    }

    // Authorize: either the caller is using the service role key
    // (server-to-server, e.g. from another Edge Function), or it's an
    // end-user pushing to themselves.
    const authHeader = req.headers.get("Authorization") || "";
    const isServiceRole = authHeader === `Bearer ${serviceKey}`;
    if (!isServiceRole) {
      const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await anon.auth.getUser();
      if (!user || user.id !== user_id) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    const { data: tokens, error: tokensErr } = await admin
      .from("push_tokens")
      .select("id, platform, token")
      .eq("user_id", user_id)
      .eq("enabled", true);
    if (tokensErr) throw tokensErr;
    if (!tokens || tokens.length === 0) return json({ sent: 0, dead: 0 });

    const data: Record<string, unknown> = { ...(body.data ?? {}) };
    if (deep_link) data.deepLink = deep_link;

    // Stringify data values for FCM (it only accepts string-to-string
    // map). APNs accepts arbitrary JSON.
    const fcmData: Record<string, string> = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
    );

    const tasks = tokens.map(async (row) => {
      try {
        if (row.platform === "ios") {
          const result = await sendApns(row.token, { title, body: messageBody, badge, data });
          return { row, result, dead: isApnsDeadToken(result) };
        }
        const result = await sendFcm(row.token, { title, body: messageBody, badge, data: fcmData });
        return { row, result, dead: isFcmDeadToken(result) };
      } catch (e) {
        return {
          row,
          result: { ok: false as const, token: row.token, status: 500, reason: e instanceof Error ? e.message : String(e) },
          dead: false,
        };
      }
    });

    const results = await Promise.all(tasks);

    // Retire dead tokens — the device no longer holds a valid
    // registration so any future sends would be wasted.
    const deadIds = results.filter((r) => r.dead).map((r) => r.row.id as string);
    if (deadIds.length) {
      await admin.from("push_tokens").delete().in("id", deadIds);
    }

    const sent = results.filter((r) => r.result.ok).length;
    const failed = results.length - sent;
    return json({ sent, failed, dead: deadIds.length });
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
