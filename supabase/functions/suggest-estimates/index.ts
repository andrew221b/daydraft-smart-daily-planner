import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { tasks } = await req.json();
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return new Response(JSON.stringify({ error: "tasks[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    // Pull user patterns to personalise suggestions
    let pattern: any = null;
    const auth = req.headers.get("Authorization");
    if (auth) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: auth } } },
        );
        const { data: u } = await supabase.auth.getUser();
        if (u?.user) {
          const { data: p } = await supabase.from("user_patterns").select("*").eq("user_id", u.user.id).maybeSingle();
          pattern = p;
        }
      } catch (_e) { /* non-fatal */ }
    }

    const overrun = pattern ? Number(pattern.deep_work_overrun_pct || 0) : 0;
    const personal = overrun > 5
      ? `\nThis user typically OVERRUNS deep work by ~${overrun.toFixed(0)}%. Pad deep_work estimates accordingly.`
      : overrun < -5
      ? `\nThis user typically FINISHES deep work ~${Math.abs(overrun).toFixed(0)}% faster than estimated. Trim deep_work estimates.`
      : "";

    const system = `You are an expert time estimator. For each task, return a realistic duration in minutes a typical knowledge worker needs to do it well, plus a 1-line reason.
Rules:
- Round to nearest 5 minutes. Min 10, max 180.
- Deep work (writing, coding, design): 45-90m typical.
- Communication (email, slack, calls): 15-30m typical.
- Routine (errands, admin): 10-20m typical.
- If the title implies a meeting with explicit length, honor it.
- Classify type: deep_work | communication | routine.${personal}`;

    const tools = [{
      type: "function",
      function: {
        name: "suggest_estimates",
        description: "Return a realistic duration estimate for each task.",
        parameters: {
          type: "object",
          properties: {
            estimates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "0-based index of the task in the input list" },
                  estimate_min: { type: "integer" },
                  type: { type: "string", enum: ["deep_work", "communication", "routine"] },
                  reason: { type: "string", description: "Short 1-line reason, max 70 chars" },
                },
                required: ["index", "estimate_min", "type", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["estimates"],
          additionalProperties: false,
        },
      },
    }];

    const userMsg = "Tasks:\n" + tasks.map((t: string, i: number) => `${i}. ${t}`).join("\n");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "suggest_estimates" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit. Try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await resp.text();
      console.error("AI error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("No tool call returned");
    const args = JSON.parse(call.function.arguments);
    return new Response(JSON.stringify(args), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});