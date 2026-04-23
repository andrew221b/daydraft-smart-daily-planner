import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { raw_input } = await req.json();
    if (!raw_input || typeof raw_input !== "string" || !raw_input.trim()) {
      return new Response(JSON.stringify({ tasks: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const system = `You split a free-form to-do brain dump into a clean list of distinct tasks.

The user writes in any language, with typos, abbreviations, slang. Items may be separated by:
- new lines
- commas
- semicolons
- the words "and", "plus", "then", "also", "и", "плюс", "потом", "также", "et", "y", etc.
- bullets (-, *, •, 1., 2.)
- or just spaces between obvious phrases

Rules:
- Output one task per distinct intent. NEVER merge two different things into one task.
- Preserve the user's original language and wording — fix only obvious typos.
- Keep inline duration/time hints attached to their task ("call mom 15min", "gym at 7pm").
- Strip filler words ("ok so", "i need to", "todo:", "также надо").
- A single task with a duration ("write report 2h") stays ONE task — do not split by time.
- If the input is genuinely a single task, return one item.
- Never invent tasks the user did not write.
- Trim each task. No trailing punctuation.`;

    const tools = [{
      type: "function",
      function: {
        name: "split_tasks",
        description: "Return the cleaned list of distinct tasks.",
        parameters: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: { type: "string" },
              description: "Array of distinct task strings in the user's original language.",
            },
          },
          required: ["tasks"],
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
          { role: "user", content: raw_input },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "split_tasks" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit. Try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await resp.text();
      console.error("AI error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("No tool call returned");
    const args = JSON.parse(call.function.arguments);
    const tasks = Array.isArray(args.tasks) ? args.tasks.map((s: string) => String(s).trim()).filter(Boolean) : [];
    return new Response(JSON.stringify({ tasks }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});