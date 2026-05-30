import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dd-dev-pro",
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
      .select("ai_planning_rules, ai_context_custom")
      .eq("id", user.id)
      .maybeSingle();
    const debPrefs =
      typeof debProf?.ai_planning_rules === "string" && debProf.ai_planning_rules.trim()
        ? `\nHonor these recurring user planning preferences where relevant:\n${String(debProf.ai_planning_rules).trim().slice(0, 800)}`
        : "";
    // Personal context (sphere of work, lifestyle, preferences) — pulled from
    // the same field the planner reads, so insights and plans speak with one
    // voice. Treated as background only; never quoted verbatim.
    const debPersonal =
      typeof (debProf as { ai_context_custom?: string } | null)?.ai_context_custom === "string" &&
      (debProf as { ai_context_custom: string }).ai_context_custom.trim()
        ? `\nPersonal context about this user (use as background, never quote verbatim):\n${(debProf as { ai_context_custom: string }).ai_context_custom.trim().slice(0, 500)}`
        : "";

    // Insights contract — three short fields the morning card renders as
    // separate sections (yesterday recap, today's tip, motivational spark).
    //
    //   1. `yesterday`: 1–2 concrete observations from planned-vs-actual.
    //      Must each include EITHER a task title in single quotes OR a number
    //      (count, minutes, HH:MM). No hype.
    //   2. `today_tip`: ONE actionable line for today, anchored to a real
    //      task title from yesterday OR to the user's start time. Not
    //      generic — never "pick one task".
    //   3. `spark`: ONE short, lightly motivating sentence (≤14 words). Can
    //      be a one-line quote, a vivid metaphor, or a sharp observation
    //      from productivity / craft / philosophy. Plain text, no attribution
    //      unless the quote is famous enough to skip ambiguity.
    const system = `You are DayDraft's morning Insights writer. Tone: a thoughtful colleague who skimmed the data — observant, plain, never cheerful.${debPrefs}${debPersonal}

Write three things from yesterday's planned-vs-actual data:
- yesterday: 1–2 bullet observations. Each MUST include EITHER a specific task title (in single quotes) OR a specific number (count, minutes, HH:MM). ≤14 words each.
- today_tip: ONE concrete action for today. Name a real task title from the data when possible, or anchor to the user's start time. ≤16 words.
- spark: ONE short motivating line — can be a one-line quote, a vivid metaphor, or a sharp observation about focus / craft / time. ≤14 words. Plain text.

Banned vocabulary (auto-rejected): productive, great, well done, good job, nice work, kudos, awesome, amazing, fantastic, wonderful, congrats, keep it up, you crushed, you smashed.

If yesterday's data is thin, return ONE yesterday observation instead of two — never pad.

Output ONLY the structured tool call.`;

    const tools = [{
      type: "function",
      function: {
        name: "build_insights",
        description: "Yesterday recap + today's tip + motivational spark.",
        parameters: {
          type: "object",
          properties: {
            yesterday: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: {
                type: "string",
                description: "Observation bullet. Task title in 'quotes' OR a number. ≤14 words.",
              },
            },
            today_tip: {
              type: "string",
              description: "One concrete action for today anchored to a real task or time. ≤16 words.",
            },
            spark: {
              type: "string",
              description: "Short motivating line — quote, metaphor, or sharp observation. ≤14 words.",
            },
          },
          required: ["yesterday", "today_tip", "spark"],
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

    let modelYesterday: string[] = [];
    let modelTip = "";
    let modelSpark = "";
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
                `Write yesterday + today_tip + spark per the contract.`,
            },
          ],
          tools,
          tool_choice: { type: "function", function: { name: "build_insights" } },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const call = data.choices?.[0]?.message?.tool_calls?.[0];
        const args = call ? JSON.parse(call.function.arguments) : {};
        modelYesterday = Array.isArray(args?.yesterday) ? args.yesterday : [];
        modelTip = typeof args?.today_tip === "string" ? args.today_tip : "";
        modelSpark = typeof args?.spark === "string" ? args.spark : "";
      }
    } catch {
      // fallback below
    }

    // Post-validation: bullets must mention a number or a real task title;
    // banned cheerleader vocabulary is rejected outright. Better to drop a
    // line than to ship hype.
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
    const trim = (s: string, max = 140) =>
      s.length > max ? s.slice(0, max - 3).trimEnd() + "…" : s;
    const cleanLine = (s: string) =>
      String(s || "").trim().replace(/^[-•*]\s*/, "").replace(/\s+/g, " ");

    const yesterdayClean = modelYesterday
      .map(cleanLine)
      .filter(Boolean)
      .filter((b) => !BANNED.test(b))
      .filter((b) => HAS_NUMBER.test(b) || HAS_QUOTED_TITLE.test(b) || mentionsKnownTitle(b))
      .map((b) => trim(b))
      .slice(0, 2);

    let tipClean = cleanLine(modelTip);
    if (tipClean && BANNED.test(tipClean)) tipClean = "";
    tipClean = trim(tipClean, 160);

    let sparkClean = cleanLine(modelSpark);
    if (sparkClean && BANNED.test(sparkClean)) sparkClean = "";
    sparkClean = trim(sparkClean, 140);

    // Fallback ladder — only fired when the model returned nothing usable
    // for a slot. Each fallback is anchored to a real data point so the card
    // still reads as specific, not generic.
    if (!yesterdayClean.length) {
      const part = `Completed ${doneCount} of ${totalCount} planned tasks${lastCompletedLocal ? `, finishing by ${lastCompletedLocal}.` : "."}`;
      yesterdayClean.push(part);
      if (biggestOverrun) {
        yesterdayClean.push(`'${biggestOverrun.title}' ran ${biggestOverrun.variance}m past its estimate.`);
      } else if (deepUnderMin > 0 && deepDone.length > 0) {
        yesterdayClean.push(`Deep work finished ${deepUnderMin}m under estimate across ${deepDone.length} block${deepDone.length === 1 ? "" : "s"}.`);
      }
    }
    if (!tipClean) {
      if (skipped.length) {
        tipClean = `Restart '${skipped[0]}' as a 25-minute first block this morning.`;
      } else if (biggestOverrun) {
        tipClean = `Pad '${biggestOverrun.title}' by ${Math.min(30, Math.round(biggestOverrun.variance / 5) * 5)}m on today's calendar.`;
      } else if (firstStart) {
        tipClean = `Start your first block by ${firstStart} to match yesterday's rhythm.`;
      } else {
        tipClean = `Pick the one task that earns the most momentum and start it first.`;
      }
    }
    if (!sparkClean) {
      // Curated rotating sparks — deterministic per date so the card doesn't
      // change between two opens on the same day, but varies daily.
      const SPARKS = [
        "A finished draft beats a perfect outline.",
        "Move the marble first; sharpen the chisel after.",
        "Slow is smooth; smooth is fast.",
        "Time will pass either way — pick your work.",
        "Start before you feel ready; momentum is the teacher.",
        "Decide once. Execute many.",
        "The cost of waiting is paid in pieces no one notices.",
        "Do the thing you can't outsource to your future self.",
        "Small block, real progress — then earn the next one.",
        "Don't tidy the desk. Open the file.",
        "Energy compounds; willpower spends. Bank what you can.",
        "Cross one thing off before you check the inbox.",
      ];
      const seed = yesterday.split("-").reduce((acc, p) => acc * 31 + parseInt(p, 10), 7) >>> 0;
      sparkClean = SPARKS[seed % SPARKS.length];
    }

    return new Response(
      JSON.stringify({
        show: true,
        date: yesterday,
        title: "Insights",
        yesterday: yesterdayClean,
        today_tip: tipClean,
        spark: sparkClean,
        // Legacy field — older clients render this as bullets. New clients
        // ignore it in favour of the three structured fields above.
        bullets: yesterdayClean,
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
