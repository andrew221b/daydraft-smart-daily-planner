import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

/**
 * Nightly cron: rebuild rolling user_patterns from the last 30 days of blocks.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const since = new Date(); since.setDate(since.getDate() - 30);
    // Optional { user_id } body scopes this to one user — used for on-demand
    // recompute (e.g. right after seeding test data) instead of waiting for the
    // nightly batch. No body (the cron's call shape) keeps the old behavior.
    let targetUserId: string | null = null;
    try {
      const body = await req.json();
      if (typeof body?.user_id === "string" && /^[0-9a-f-]{36}$/i.test(body.user_id)) targetUserId = body.user_id;
    } catch { /* no/empty body — nightly cron */ }
    const users = targetUserId
      ? [{ id: targetUserId }]
      : ((await supabase.from("profiles").select("id")).data || []);
    let updated = 0;
    for (const u of users || []) {
      const { data: plans } = await supabase.from("plans").select("id").eq("user_id", u.id).gte("date", since.toISOString().slice(0,10));
      const ids = (plans || []).map((p: any) => p.id);
      if (!ids.length) continue;
      const { data: bs } = await supabase.from("blocks").select("*").in("plan_id", ids);
      const tasks = (bs || []).filter((b: any) => b.kind === "task");
      if (!tasks.length) continue;

      const completionByHour: Record<string, { done: number; total: number }> = {};
      const abandoned: Record<string, number> = {};
      let deepPlanned = 0, deepDone = 0;
      for (const t of tasks) {
        const h = (t.start_time || "09:00").slice(0, 2);
        completionByHour[h] = completionByHour[h] || { done: 0, total: 0 };
        completionByHour[h].total += 1;
        if (t.completed) completionByHour[h].done += 1;
        if (!t.completed) abandoned[t.type] = (abandoned[t.type] || 0) + 1;
        if (t.type === "deep_work") {
          deepPlanned += t.duration_min;
          if (t.completed) deepDone += t.duration_min;
        }
      }
      // overrun: if done < planned, the user under-finished — overrun% as planned-vs-done gap
      const overrun = deepPlanned > 0 ? Math.round(((deepPlanned - deepDone) / deepPlanned) * 100) : 0;
      const completion_by_hour = Object.fromEntries(
        Object.entries(completionByHour).map(([h, v]) => [h, Math.round((v.done / v.total) * 100)])
      );
      const abandoned_types = Object.entries(abandoned).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

      await supabase.from("user_patterns").upsert({
        user_id: u.id,
        deep_work_overrun_pct: overrun,
        completion_by_hour,
        abandoned_types,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "user_id" });
      updated += 1;
    }
    return new Response(JSON.stringify({ updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});