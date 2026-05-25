import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { remaining_blocks, ended_block, current_time } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
    if (!Array.isArray(remaining_blocks) || !ended_block) {
      return new Response(JSON.stringify({ error: "remaining_blocks and ended_block required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You are a micro-rescheduling assistant for a productivity app.
Return exactly 2 short options for how to adapt the rest of the day after a timer stop.
Hard constraints:
- Keep each option label under 20 words.
- Keep labels actionable and specific.
- Do not chat; do not ask questions.
- Return 2 options with actions using this schema:
  1) shift_later: { type: "shift_later", minutes: integer 5..20 }
  2) shorten_next_break: { type: "shorten_next_break", target_minutes: integer 3..10 }
- Prefer options that are realistic for remaining tasks.
- Example labels:
  "Shift everything 12m later"
  "Cut your next break to 5m and stay on track"`;

    const tools = [{
      type: "function",
      function: {
        name: "reschedule_options",
        description: "Return two concise rescheduling options with machine actions.",
        parameters: {
          type: "object",
          properties: {
            options: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  action: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: ["shift_later", "shorten_next_break"] },
                      minutes: { type: "integer" },
                      target_minutes: { type: "integer" },
                    },
                    required: ["type"],
                    additionalProperties: false,
                  },
                },
                required: ["label", "action"],
                additionalProperties: false,
              },
            },
          },
          required: ["options"],
          additionalProperties: false,
        },
      },
    }];

    const userMsg = `Current time: ${String(current_time || "unknown")}
Ended block: ${JSON.stringify(ended_block)}
Remaining blocks: ${JSON.stringify(remaining_blocks).slice(0, 4000)}`;

    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-1.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "reschedule_options" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("No tool call returned");
    const args = JSON.parse(call.function.arguments);
    const safeOptions = (Array.isArray(args?.options) ? args.options : [])
      .slice(0, 2)
      .map((o: any, idx: number) => {
        const raw = String(o?.label || "");
        const words = raw.trim().split(/\s+/).filter(Boolean);
        const label = words.length > 20 ? words.slice(0, 20).join(" ") : raw.trim();
        if (!label) {
          return idx === 0
            ? { label: "Shift everything 10m later", action: { type: "shift_later", minutes: 10 } }
            : { label: "Cut your next break to 5m and stay on track", action: { type: "shorten_next_break", target_minutes: 5 } };
        }
        return { label, action: o.action };
      });
    while (safeOptions.length < 2) {
      safeOptions.push(
        safeOptions.length === 0
          ? { label: "Shift everything 10m later", action: { type: "shift_later", minutes: 10 } }
          : { label: "Cut your next break to 5m and stay on track", action: { type: "shorten_next_break", target_minutes: 5 } },
      );
    }
    return new Response(JSON.stringify({ options: safeOptions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

