import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { raw_input, energy_preference, name, mode, start_time } = await req.json();
    if (!raw_input || typeof raw_input !== "string") {
      return new Response(JSON.stringify({ error: "raw_input required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    // Optional: pull user_patterns + calendar events if authenticated
    let pattern: any = null;
    let calendarEvents: any[] = [];
    const auth = req.headers.get("Authorization");
    if (auth) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: auth } } }
        );
        const { data: u } = await supabase.auth.getUser();
        if (u?.user) {
          const { data: p } = await supabase.from("user_patterns").select("*").eq("user_id", u.user.id).maybeSingle();
          pattern = p;
          // Pro: pull today's calendar events if connected
          const { data: sub } = await supabase.from("subscriptions").select("status").eq("user_id", u.user.id).maybeSingle();
          const isPro = sub?.status === "active" || sub?.status === "trialing";
          const { data: tok } = await supabase.from("calendar_tokens").select("user_id").eq("user_id", u.user.id).maybeSingle();
          if (isPro && tok) {
            const ev = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/fetch-calendar-events`, {
              headers: { Authorization: auth, "Content-Type": "application/json" },
            });
            if (ev.ok) {
              const j = await ev.json();
              calendarEvents = j.events || [];
            }
          }
        }
      } catch (_e) { /* non-fatal */ }
    }

    const peakMap: Record<string, string> = {
      morning: "8:00 to 12:00",
      midday: "11:00 to 15:00",
      night: "19:00 to 23:00",
    };
    const peak = peakMap[energy_preference] || peakMap.morning;
    const defaultStart = energy_preference === "night" ? 18 : 9;
    const startHour = start_time ? start_time.split(":")[0] : String(defaultStart).padStart(2, "0");

    const isReplan = mode === "replan";
    const patternHints = pattern ? `
User patterns (use to compound intelligence):
- Deep work overrun: ${Number(pattern.deep_work_overrun_pct || 0).toFixed(0)}% (account for it; pad deep blocks if positive)
- Top abandoned types: ${JSON.stringify(pattern.abandoned_types || [])}
- Completion by hour: ${JSON.stringify(pattern.completion_by_hour || {})}` : "";

    const calHints = calendarEvents.length ? `
FIXED calendar events you must schedule around (do not move, do not duplicate; emit them as kind="task" with type="communication" and a reasoning that mentions "from your calendar"):
${calendarEvents.map((e: any) => `- ${e.start_time} (${e.duration_min}m) ${e.title}`).join("\n")}` : "";

    const system = `You are DayDraft, an expert productivity planner. Build a realistic, energy-aware schedule from a raw task list.
Rules:
- Front-load deep work in the user's peak window (${peak}).
- Batch communication into 1-2 blocks, ideally after the peak.
- Insert one 15-min break after ~2h of deep work, and a 60-min lunch around 12:00 (or 18:00 for night owls).
- Each task block: 25-90 min. Keep total day under 8 working hours.
- Day starts around ${startHour}:00.${isReplan ? " This is a MID-DAY RE-PLAN — start now and only schedule what's left." : ""}
- Classify each task as deep_work, communication, or routine.
- Use kind="task" for actual tasks, "break" for breaks, "lunch" for lunch.
- Extract location hints from raw text (e.g. "gym at 2pm", "lunch at Blue Bottle Mission") and include a short location string.
- For EVERY task, include a one-sentence "reasoning" explaining placement (e.g. "Deep work first — your peak").
- Summary: short, e.g. "5 tasks · 3 focus blocks · Done by 5pm".
- Subtext: one short sentence.${patternHints}${calHints}`;

    const tools = [{
      type: "function",
      function: {
        name: "build_schedule",
        description: "Return a structured day schedule.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            subtext: { type: "string" },
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start_time: { type: "string", description: "HH:MM 24h" },
                  duration_min: { type: "integer" },
                  title: { type: "string" },
                  type: { type: "string", enum: ["deep_work", "communication", "routine"] },
                  kind: { type: "string", enum: ["task", "break", "lunch"] },
                  reasoning: { type: "string" },
                  location: { type: "string" },
                },
                required: ["start_time", "duration_min", "title", "type", "kind"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "subtext", "blocks"],
          additionalProperties: false,
        },
      },
    }];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Name: ${name || "User"}\nRaw tasks:\n${raw_input}` },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "build_schedule" } },
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
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
