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

    // Pull start_time + completed_at so we can give the model time-of-day
    // cues ("finished by 17:30", "first deep block started at 11:00") that
    // produce specific bullets instead of generic summaries.
    const { data: blocks } = await supabase
      .from("blocks")
      .select("id,title,type,kind,completed,is_calendar_event,estimated_minutes,actual_minutes,duration_min,start_time,completed_at")
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
    const skipped = tasks
      .filter((b: any) => !b.completed)
      .map((b: any) => String(b.title || "").trim())
      .filter(Boolean);

    // Per-task variance — `variance > 0` overran, `< 0` underran.
    type TaskRow = { title: string; type: string; estMin: number; actMin: number; variance: number };
    const doneRows: TaskRow[] = done.map((b: any): TaskRow => {
      const estMin = Math.max(0, Number(b.estimated_minutes || b.duration_min || 0));
      const actMin = Math.max(0, Number(b.actual_minutes || estMin));
      return {
        title: String(b.title || "").trim().slice(0, 60) || "(untitled)",
        type: String(b.type || "task"),
        estMin,
        actMin,
        variance: actMin - estMin,
      };
    });

    const deepDone = doneRows.filter((b) => b.type === "deep_work");
    const deepOverMin = deepDone.reduce((sum, b) => sum + Math.max(0, b.variance), 0);
    const deepUnderMin = deepDone.reduce((sum, b) => sum + Math.max(0, -b.variance), 0);

    // Headline overrun + underrun — the single biggest specific observation
    // we can offer. Empty when there's no clear outlier.
    const sortedByOverrun = [...doneRows].sort((a, b) => b.variance - a.variance);
    const biggestOverrun = sortedByOverrun[0]?.variance > 5 ? sortedByOverrun[0] : null;
    const biggestUnderrun = sortedByOverrun[sortedByOverrun.length - 1]?.variance < -5
      ? sortedByOverrun[sortedByOverrun.length - 1]
      : null;

    // Time-of-day cues. `start_time` is HH:MM local on plan day. We surface
    // the earliest completed block start and the latest completed_at hour
    // so the model can write "finished by 18:00" / "first block at 11:00".
    const startTimes = done
      .map((b: any) => (typeof b.start_time === "string" ? b.start_time.slice(0, 5) : ""))
      .filter((s: string) => /^\d{2}:\d{2}$/.test(s))
      .sort();
    const firstStart = startTimes[0] || null;
    const completedTimestamps = done
      .map((b: any) => (typeof b.completed_at === "string" ? Date.parse(b.completed_at) : NaN))
      .filter((n: number) => Number.isFinite(n));
    const lastCompletedAt =
      completedTimestamps.length
        ? new Date(Math.max(...completedTimestamps))
        : null;
    const lastCompletedLocal = lastCompletedAt
      ? new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: tz,
        }).format(lastCompletedAt)
      : null;

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const { data: debProf } = await supabase
      .from("profiles")
      .select("ai_planning_rules")
      .eq("id", user.id)
      .maybeSingle();
    const debPrefs =
      typeof debProf?.ai_planning_rules === "string" && debProf.ai_planning_rules.trim()
        ? `\nHonor these recurring user planning preferences where relevant:\n${String(debProf.ai_planning_rules).trim().slice(0, 800)}`
        : "";

    // Tightened system prompt. The previous version was too permissive —
    // produced bullets like "You had a productive day, keep it up" because
    // nothing forbade hype and nothing required specifics. The new contract:
    //   1. Every bullet must include EITHER a specific task title OR a
    //      specific number (count, minutes, time). Generic bullets are out.
    //   2. The action bullet is anchored to today, names a task, and is one
    //      concrete next step — not a platitude.
    //   3. If the data is thin, return fewer bullets. Padding to 3 is worse
    //      than returning 2 honest ones.
    //   4. Hard-banned hype vocabulary.
    const system = `You are DayDraft's debrief assistant. Tone: a thoughtful colleague who skimmed the data — observant, plain, never cheerful.${debPrefs}
Return 2 or 3 bullets that report concrete observations from yesterday's planned-vs-actual.

Required:
- Each bullet must include EITHER a specific task title (quoted in single quotes) OR a specific number (count, minutes, or HH:MM time). Bullets without specifics are rejected.
- Exactly one bullet is an action bullet for today. It must name a specific task title from the data and propose one concrete next step (start earlier / shorten estimate / move to morning / split into a smaller first step / reschedule). Generic actions like "pick one task" are rejected.
- 1 sentence per bullet, ≤ 14 words, plain text, no leading "-" or "•" or "*".

Banned vocabulary (auto-rejected): productive, great, well done, good job, nice work, kudos, awesome, amazing, fantastic, wonderful, congrats, keep it up, you crushed, you smashed.

If you can't produce 3 bullets that each carry a specific observation, return 2. Never pad.

Output ONLY the structured tool call.`;

    const tools = [{
      type: "function",
      function: {
        name: "build_debrief",
        description: "Create concise yesterday debrief bullets.",
        parameters: {
          type: "object",
          properties: {
            bullets: {
              type: "array",
              minItems: 2,
              maxItems: 3,
              items: {
                type: "string",
                description: "One observation bullet. Must contain a task title in single quotes OR a number (count, minutes, HH:MM). ≤14 words.",
              },
            },
          },
          required: ["bullets"],
          additionalProperties: false,
        },
      },
    }];

    // Compact, structured user message so the model has facts not prose.
    // Top 4 overruns + bottom 2 underruns is enough headroom for variety
    // without blowing token budget.
    const topOverruns = sortedByOverrun.filter((r) => r.variance > 5).slice(0, 4);
    const topUnderruns = sortedByOverrun.filter((r) => r.variance < -5).slice(-2);
    const userPayload = {
      completed: `${doneCount}/${totalCount}`,
      first_block_started_at: firstStart,
      last_task_completed_at: lastCompletedLocal,
      deep_work: {
        completed: deepDone.length,
        total_overrun_min: deepOverMin,
        total_underrun_min: deepUnderMin,
      },
      biggest_overrun: biggestOverrun
        ? { title: biggestOverrun.title, over_min: biggestOverrun.variance }
        : null,
      biggest_underrun: biggestUnderrun
        ? { title: biggestUnderrun.title, under_min: Math.abs(biggestUnderrun.variance) }
        : null,
      top_overruns: topOverruns.map((r) => ({ title: r.title, over_min: r.variance })),
      top_underruns: topUnderruns.map((r) => ({ title: r.title, under_min: Math.abs(r.variance) })),
      skipped_titles: skipped.slice(0, 5),
    };

    let bullets: string[] = [];
    try {
      const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-1.5-flash",
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content:
                `Yesterday's data (JSON):\n${JSON.stringify(userPayload, null, 2)}\n\n` +
                `Write 2 or 3 bullets per the contract above.`,
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

    // Post-validation: enforce the contract client-side too. A bullet that
    // contains banned vocabulary OR neither a number nor a task-title quote
    // is filtered out — better to drop a bullet than ship a generic one.
    const BANNED = /\b(productive|great|well done|good job|nice work|kudos|awesome|amazing|fantastic|wonderful|congrats|keep it up|you crushed|you smashed)\b/i;
    const HAS_NUMBER = /\d/;
    const HAS_QUOTED_TITLE = /['‘’"][^'‘’"]{2,}['‘’"]/;
    const allTitles = new Set(doneRows.map((r) => r.title.toLowerCase()).concat(skipped.map((s) => s.toLowerCase())));
    const mentionsKnownTitle = (s: string) => {
      const low = s.toLowerCase();
      for (const t of allTitles) {
        if (t.length >= 3 && low.includes(t)) return true;
      }
      return false;
    };

    const cleaned = bullets
      .map((b) => String(b || "").trim().replace(/^[-•*]\s*/, "").replace(/\s+/g, " "))
      .filter(Boolean)
      .filter((b) => !BANNED.test(b))
      .filter((b) => HAS_NUMBER.test(b) || HAS_QUOTED_TITLE.test(b) || mentionsKnownTitle(b))
      .map((b) => (b.length > 140 ? b.slice(0, 137).trimEnd() + "…" : b))
      .slice(0, 3);

    // Specific fallbacks — only used when the model returned nothing
    // usable. Each line is anchored to a real data point we already have.
    if (!cleaned.length) {
      const fallbackParts: string[] = [];
      fallbackParts.push(`Completed ${doneCount} of ${totalCount} planned tasks${lastCompletedLocal ? `, finishing by ${lastCompletedLocal}.` : "."}`);
      if (biggestOverrun) {
        fallbackParts.push(`'${biggestOverrun.title}' ran ${biggestOverrun.variance}m past its estimate.`);
      } else if (deepUnderMin > 0 && deepDone.length > 0) {
        fallbackParts.push(`Deep work finished ${deepUnderMin}m under estimate across ${deepDone.length} block${deepDone.length === 1 ? "" : "s"}.`);
      }
      if (skipped.length) {
        fallbackParts.push(`Today: restart '${skipped[0]}' as a 25-minute first block.`);
      } else if (biggestOverrun) {
        fallbackParts.push(`Today: pad '${biggestOverrun.title}' by ${Math.min(30, Math.round(biggestOverrun.variance / 5) * 5)}m on the calendar.`);
      } else if (firstStart) {
        fallbackParts.push(`Today: start your first block by ${firstStart} to match yesterday's rhythm.`);
      }
      cleaned.push(...fallbackParts.slice(0, 3));
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
