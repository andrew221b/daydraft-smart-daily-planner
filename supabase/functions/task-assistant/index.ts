import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { title, type, location, duration_min } = await req.json();
    if (!title || typeof title !== "string") {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const system = `You are a focused execution coach. The user is about to start a single task.
Return:
- 3-5 concrete sub-steps (verb-led, max 8 words each) that break the task down.
- 2-4 useful resource links (real, well-known URLs only — docs, official sites, common tools). If you're not certain a URL is correct, omit it. Do not invent links.
- One pro tip (1 sentence) tailored to the task type.
- If the task looks like writing an email, slack/sms message, or short note (verbs: "email", "write to", "reply", "message", "DM", "text", "send to"), produce a "draft" object:
  • subject (omit/empty for chat messages)
  • body: 3-8 lines, ready to send, friendly-professional, fill placeholders like [Name] / [Date]
  • If the task is NOT a writing task, omit the draft field entirely (do not include empty strings).
Be terse. No fluff. No greetings.`;

    const tools = [{
      type: "function",
      function: {
        name: "task_help",
        description: "Return execution help for a single task.",
        parameters: {
          type: "object",
          properties: {
            substeps: { type: "array", items: { type: "string" } },
            links: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  url: { type: "string" },
                },
                required: ["label", "url"],
                additionalProperties: false,
              },
            },
            tip: { type: "string" },
            draft: {
              type: "object",
              properties: {
                subject: { type: "string" },
                body: { type: "string" },
              },
              required: ["body"],
              additionalProperties: false,
            },
          },
          required: ["substeps", "links", "tip"],
          additionalProperties: false,
        },
      },
    }];

    const userMsg = `Task: ${title}
Type: ${type || "unknown"}
Allotted: ${duration_min || "?"} min${location ? `\nLocation: ${location}` : ""}`;

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
        tool_choice: { type: "function", function: { name: "task_help" } },
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