import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { timezone, now_iso } = await req.json().catch(() => ({}));
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = now_iso ? new Date(now_iso) : new Date();
    const tz = typeof timezone === "string" && timezone ? timezone : "UTC";
    const todayLocal = (() => {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
      } catch {
        return now.toISOString().slice(0, 10);
      }
    })();
    const y = new Date(`${todayLocal}T12:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);

    const { data: plan } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("date", yesterday)
      .maybeSingle();
    if (!plan?.id) {
      return new Response(JSON.stringify({ show: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: blocks } = await supabase
      .from("blocks")
      .select("id,title,type,kind,completed,is_calendar_event,estimated_minutes,actual_minutes,duration_min")
      .eq("plan_id", plan.id)
      .order("position");
    const tasks = (blocks || []).filter((b: any) => b.kind === "task" && !b.is_calendar_event);
    const done = tasks.filter((b: any) => b.completed);
    if (!tasks.length || done.length === 0) {
      return new Response(JSON.stringify({ show: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const doneCount = done.length;
    const totalCount = tasks.length;
    const skipped = tasks.filter((b: any) => !b.completed).map((b: any) => String(b.title || "").trim()).filter(Boolean);
    const deepDone = done.filter((b: any) => b.type === "deep_work");
    const deepOverMin = deepDone.reduce((sum: number, b: any) => {
      const est = Number(b.estimated_minutes || b.duration_min || 0);
      const act = Number(b.actual_minutes || est);
      return sum + Math.max(0, act - est);
    }, 0);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const system = `You are DayDraft's neutral debrief assistant.
Return 2 or 3 bullet points ONLY.
Rules:
- each bullet under 15 words
- direct, neutral tone (no hype, no cheerleading)
- at least one bullet must include a concrete action suggestion for today
- focus on planned vs actual outcomes
- plain text only, no markdown symbols in content`;

    const tools = [{
      type: "function",
      function: {
        name: "build_debrief",
        description: "Create concise yesterday debrief bullets.",
        parameters: {
          type: "object",
          properties: {
            bullets: { type: "array", items: { type: "string" } },
          },
          required: ["bullets"],
          additionalProperties: false,
        },
      },
    }];

    let bullets: string[] = [];
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content:
                `Yesterday stats:\n` +
                `- Completed: ${doneCount}/${totalCount}\n` +
                `- Deep work overrun minutes: ${deepOverMin}\n` +
                `- Skipped tasks: ${skipped.slice(0, 3).join(", ") || "none"}\n`,
            },
          ],
          tools,
          tool_choice: { type: "function", function: { name: "build_debrief" } },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const call = data.choices?.[0]?.message?.tool_calls?.[0];
        const args = call ? JSON.parse(call.function.arguments) : {};
        bullets = Array.isArray(args?.bullets) ? args.bullets : [];
      }
    } catch {
      // fallback below
    }

    const cleaned = bullets
      .map((b) => String(b || "").trim().replace(/^[-•]\s*/, ""))
      .filter(Boolean)
      .slice(0, 3);
    if (!cleaned.length) {
      const fallback = [
        `You completed ${doneCount}/${totalCount} blocks yesterday.`,
        deepOverMin > 0
          ? `Deep work ran ${deepOverMin}m over estimate yesterday.`
          : "Deep work stayed close to estimates yesterday.",
        skipped.length
          ? `Reschedule ${skipped[0]} today as a smaller first step.`
          : "Pick one top task and start it in your first block today.",
      ];
      cleaned.push(...fallback);
    }

    return new Response(
      JSON.stringify({
        show: true,
        date: yesterday,
        title: "Yesterday's debrief",
        bullets: cleaned.slice(0, 3),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
