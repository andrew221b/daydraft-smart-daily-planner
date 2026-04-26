import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { greeting, friendlyDate, todayDateStr, dateStr, parseDateStr, isFutureDateStr, friendlyDateFor } from "@/lib/daydraft";
import { Mic, Sparkles, ArrowRight, CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SpilloverChips } from "@/components/app/SpilloverChips";
import { ProBadge } from "@/components/app/ProBadge";
import { TodayInsight } from "@/components/app/TodayInsight";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { Bookmark } from "lucide-react";
import { ClarifySheet, ClarifiedTask } from "@/components/app/ClarifySheet";
import { QuickCaptureButton } from "@/components/app/QuickCapture";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";

const DEFAULT_PLACEHOLDER =
  "Write however you want — AI will figure it out.\n\nE.g. finish deck, call mom 15min, gym, reply to Alex...";

export default function Today() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const nav = useNavigate();
  const { isPro, planQuotaUsed, planQuotaRemaining, entitlement } = useEntitlement();
  const tour = useTour();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<"quota" | "feature" | "trial-banner">("feature");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasPlanForDate, setHasPlanForDate] = useState(false);
  const [existingSummary, setExistingSummary] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; raw_input: string }[]>([]);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  // Date the user is planning for. Defaults to today; can be set to any future date.
  const [planDate, setPlanDate] = useState<string>(todayDateStr());
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  // Captures previewed into the textarea — consumed only after a successful plan.
  const [pendingCaptureIds, setPendingCaptureIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    // A plan is "real" only if it has at least one block. An emptied plan
    // (user deleted every task) shouldn't show the "View existing plan" CTA.
    (async () => {
      const { data: p } = await supabase.from("plans").select("id, ai_summary").eq("user_id", user.id).eq("date", planDate).maybeSingle();
      if (!p) { setHasPlanForDate(false); setExistingSummary(null); return; }
      const { count } = await supabase.from("blocks").select("id", { count: "exact", head: true }).eq("plan_id", p.id);
      const has = (count ?? 0) > 0;
      setHasPlanForDate(has);
      setExistingSummary(has ? (p.ai_summary || null) : null);
    })();
    // Pull saved templates
    supabase.from("block_templates").select("id, name, raw_input").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data || []) as any));
    // Pull unconsumed quick captures matching the day being planned.
    // IMPORTANT: we only PREVIEW them in the textarea here — we do NOT
    // mark them consumed yet. They get consumed inside `plan()` once the
    // user actually creates a plan. Otherwise abandoning the screen would
    // silently swallow the user's notes forever.
    (async () => {
      const { data: caps } = await supabase.from("quick_captures").select("*").eq("user_id", user.id).eq("consumed", false);
      if (!caps || !caps.length) { setPendingCaptureIds([]); return; }
      const matching = caps.filter((c: any) => {
        const content: string = c.content || "";
        const forMatch = content.match(/^\[for:(\d{4}-\d{2}-\d{2})\]\s*/);
        if (forMatch) return forMatch[1] === planDate;
        // Untagged or [today] — only valid when planning today.
        return planDate === todayDateStr();
      });
      if (!matching.length) { setPendingCaptureIds([]); return; }
      const block = matching.map((c: any) => (c.content || "")
        .replace(/^\[today\]\s*/, "")
        .replace(/^\[for:\d{4}-\d{2}-\d{2}\]\s*/, "")
      ).join("\n");
      setInput(prev => prev ? block + "\n" + prev : block);
      setPendingCaptureIds(matching.map((c: any) => c.id));
      toast(`📥 Added ${matching.length} from quick capture`);
    })();
  }, [user?.id, planDate]);

  // Auto-start tour ONCE for new users (after onboarding). `tour.start` is a no-op if `tour_seen.today` is true.
  useEffect(() => {
    if (!profile?.onboarded) return;
    if (profile.tour_seen && (profile.tour_seen as any).today) return;
    const t = setTimeout(() => tour.start(TOUR_TODAY), 800);
    return () => clearTimeout(t);
  }, [profile?.onboarded, profile?.tour_seen]);

  const useYesterday = async () => {
    if (!user) return;
    // Use the most recent plan strictly BEFORE the date we're planning for
    // *that actually had tasks*. Skip planless `raw_input` shells (which can
    // happen after a failed AI generation) and strip any `[for:..]` /
    // `[today]` quick-capture markers that were injected last time — those
    // pollute the textarea otherwise.
    const { data } = await supabase
      .from("plans")
      .select("raw_input, blocks!inner(id)")
      .eq("user_id", user.id)
      .lt("date", planDate)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = (data?.raw_input || "")
      .split(/\r?\n/)
      .map(line => line.replace(/^\[(today|for:\d{4}-\d{2}-\d{2})\]\s*/i, "").trim())
      .filter(Boolean)
      .join("\n");
    if (raw) { setInput(raw); toast.success("Loaded previous tasks"); }
    else toast("No previous tasks found");
  };

  const saveAsTemplate = async () => {
    if (!user || !input.trim()) { toast.error("Add tasks first"); return; }
    const name = prompt("Template name", "My standard day");
    if (!name) return;
    const { data, error } = await supabase.from("block_templates").insert({
      user_id: user.id, name, raw_input: input,
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    setTemplates(t => [data as any, ...t]);
    toast.success("Template saved");
  };

  const applyTemplate = (t: { raw_input: string; name: string }) => {
    setInput(t.raw_input);
    toast.success(`Loaded "${t.name}"`);
  };

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Voice input not supported in this browser"); return; }
    const r = new SR(); r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e: any) => setInput(prev => prev + (prev ? "\n" : "") + e.results[0][0].transcript);
    r.onerror = () => toast.error("Couldn't capture voice");
    r.start();
    toast("Listening...");
  };

  const openClarify = async () => {
    if (!input.trim()) { toast.error("Add at least one task"); return; }
    if (!user || !profile) return;
    // Quota only applies to today. Future plans are unmetered to encourage planning ahead.
    if (planDate === todayDateStr()) {
      try {
        const { data: q } = await supabase.functions.invoke("check-plan-quota", { body: {} });
        if (q && q.allowed === false) {
          setUpgradeReason("quota");
          setUpgradeOpen(true);
          return;
        }
      } catch {/* fail open */}
    }
    // Warn if planning tomorrow while today is still un-planned (streak risk).
    if (planDate !== todayDateStr()) {
      const { data: todayPlan } = await supabase.from("plans").select("id").eq("user_id", user.id).eq("date", todayDateStr()).maybeSingle();
      if (!todayPlan) {
        toast("Heads up: you haven't planned today yet — your streak only counts today's plan.", { duration: 4500 });
      }
    }
    setClarifyOpen(true);
  };

  const plan = async (clarified: ClarifiedTask[]) => {
    if (!user || !profile) return;
    haptics.impact("medium");
    setClarifyOpen(false);
    setBusy(true);
    sessionStorage.setItem("dd_planning_input", input);
    nav("/today/planning");
    try {
      const minWait = new Promise(r => setTimeout(r, 1500));
      // Pre-compute hours already committed today so the AI gets a real
      // budget. We count: completed blocks on the planning date + any
      // already-scheduled non-completed blocks (we'll replace those, but
      // their duration_min still represents intent).
      let hoursAlreadyCommitted = 0;
      try {
        if (planDate === todayDateStr()) {
          const { data: existingPlan } = await supabase
            .from("plans").select("id").eq("user_id", user.id).eq("date", planDate).maybeSingle();
          if (existingPlan?.id) {
            const { data: completed } = await supabase
              .from("blocks").select("duration_min")
              .eq("plan_id", existingPlan.id).eq("completed", true);
            const min = (completed || []).reduce((s: number, b: any) => s + (b.duration_min || 0), 0);
            hoursAlreadyCommitted = min / 60;
          }
        }
      } catch {/* non-fatal */}
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
          raw_input: input,
          energy_preference: profile.energy_preference,
          name: profile.display_name,
          clarified_tasks: clarified,
          plan_date: planDate,
          now_iso: new Date().toISOString(),
          timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          hours_already_committed: hoursAlreadyCommitted,
        },
      });
      await minWait;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // upsert plan for the chosen date (today by default, can be a future date)
      const { data: planRow, error: planErr } = await supabase.from("plans").upsert({
        user_id: user.id, date: planDate, raw_input: input, ai_summary: data.summary, ai_subtext: data.subtext,
      }, { onConflict: "user_id,date" }).select().single();
      if (planErr) throw planErr;

      await supabase.from("blocks").delete().eq("plan_id", planRow.id);
      const blocks = (data.blocks || []).map((b: any, i: number) => ({
        plan_id: planRow.id, user_id: user.id,
        start_time: b.start_time, duration_min: b.duration_min, title: b.title,
        type: b.type, kind: b.kind, position: i,
        ai_reasoning: b.reasoning ?? null,
        location: b.location ?? null,
        location_lat: b.location_lat ?? null,
        location_lng: b.location_lng ?? null,
      }));
      if (blocks.length) await supabase.from("blocks").insert(blocks);
      // Now that a plan exists, mark previewed captures as consumed.
      if (pendingCaptureIds.length) {
        try {
          await supabase.from("quick_captures").update({ consumed: true } as any)
            .in("id", pendingCaptureIds);
        } catch {/* ignore */}
        setPendingCaptureIds([]);
      }
      // Persist user's per-task time-tracking choices for Focus to read.
      // We key by normalized title within the plan, since AI may rename
      // blocks slightly when scheduling.
      try {
        const trackTitles = clarified
          .filter(t => t.track_time)
          .map(t => t.title.trim().toLowerCase());
        localStorage.setItem(
          `dd_track_titles_${planRow.id}`,
          JSON.stringify(trackTitles),
        );
      } catch {/* ignore */}
      // (streaks removed — planning no longer triggers a streak update)
      nav(planDate === todayDateStr() ? "/today/plan" : `/today/plan?date=${planDate}`);
    } catch (e: any) {
      toast.error(e.message || "Planning failed");
      nav(planDate === todayDateStr() ? "/today" : `/today?date=${planDate}`);
    } finally { setBusy(false); }
  };

  const showTrialBanner = entitlement?.tier === "trial" && (entitlement.daysLeftInTrial ?? 99) <= 3;

  return (
    <Shell>
      <div className="px-6 pt-12">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight">{greeting()}{profile?.display_name ? `, ${profile.display_name}` : ""}</h1>
            <p className="text-secondary-fg text-sm mt-1">{friendlyDate()}</p>
          </div>
          <ProBadge />
        </div>

        <TodayInsight />

        {showTrialBanner && (
          <button onClick={() => { setUpgradeReason("trial-banner"); setUpgradeOpen(true); }}
            className="mt-3 w-full flex items-center justify-between px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 pressable">
            <div className="text-left">
              <div className="text-sm font-medium text-foreground">{entitlement!.daysLeftInTrial} days left in trial</div>
              <div className="text-xs text-secondary-fg">Tap to keep DayDraft Pro</div>
            </div>
            <span className="text-xs font-semibold text-primary">Upgrade →</span>
          </button>
        )}

        {!isPro && planQuotaRemaining <= 2 && planQuotaRemaining > 0 && (
          <div className="mt-3 text-[11px] text-secondary-fg">
            {planQuotaRemaining} of {planQuotaUsed + planQuotaRemaining} free plans left this week.
            <button onClick={() => { setUpgradeReason("feature"); setUpgradeOpen(true); }}
              className="ml-1 text-primary hover:underline">Go unlimited</button>
          </div>
        )}

        <div className="mt-6 relative">
          <SpilloverChips planDate={planDate} onCarryOver={(titles) => {
            const block = titles.join("\n");
            setInput(prev => prev ? block + "\n" + prev : block);
            toast.success(titles.length === 1 ? "Carried over" : `Carried over ${titles.length} tasks`);
          }} />
          <Textarea
            data-tour="today-input"
            value={input} onChange={e => setInput(e.target.value)} placeholder={DEFAULT_PLACEHOLDER}
            className="min-h-[200px] bg-surface border-border rounded-[20px] p-4 text-base leading-relaxed resize-none focus-visible:ring-primary/40 focus-visible:ring-offset-0 focus-visible:border-primary/40 transition-all" />
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          <QuickCaptureButton variant="chip" className="" />
          <button data-tour="today-voice" onClick={voice}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-foreground">
            <Mic className="h-3.5 w-3.5" /> Voice
          </button>
          <button data-tour="today-yesterday" onClick={useYesterday} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Use yesterday's
          </button>
          <button data-tour="today-template" onClick={saveAsTemplate} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-foreground">
            <Bookmark className="h-3.5 w-3.5" /> Save template
          </button>
          {templates.map(t => (
            <button key={t.id} onClick={() => applyTemplate(t)} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary/5 border border-primary/30 text-xs text-primary pressable hover:bg-primary/10">
              {t.name}
            </button>
          ))}
        </div>

        {hasPlanForDate && (
          <button
            onClick={() => nav(planDate === todayDateStr() ? "/today/plan" : `/today/plan?date=${planDate}`)}
            className="mt-4 w-full text-left rounded-xl bg-primary/5 border border-primary/20 px-3 py-2.5 pressable hover:border-primary/40 transition-colors"
          >
            <div className="text-[11px] uppercase tracking-wider text-primary font-semibold">
              {planDate === todayDateStr() ? "Today's plan" : `Plan for ${friendlyDateFor(parseDateStr(planDate))}`}
            </div>
            <div className="text-sm text-foreground mt-0.5 truncate">
              {existingSummary || "Open plan →"}
            </div>
          </button>
        )}

        <div className="mt-8">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] text-secondary-fg uppercase tracking-wider">Plan for</span>
            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs pressable",
                    planDate === todayDateStr()
                      ? "bg-surface border-border text-secondary-fg"
                      : "bg-primary/10 border-primary/30 text-primary"
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {friendlyDateFor(parseDateStr(planDate))}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={parseDateStr(planDate)}
                  onSelect={(d) => { if (d) { setPlanDate(dateStr(d)); setDatePopoverOpen(false); } }}
                  disabled={(d) => {
                    const today = new Date(); today.setHours(0,0,0,0);
                    return d < today;
                  }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <Button data-tour="today-plan" onClick={openClarify} disabled={busy} className="w-full h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}>
            {planDate === todayDateStr() ? "Plan My Day" : `Plan ${friendlyDateFor(parseDateStr(planDate))}`} <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="text-xs text-secondary-fg text-center mt-2">
            Next: confirm AI time estimates · pin meetings · then auto-schedule
          </p>
        </div>
      </div>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason={upgradeReason} />
      <ClarifySheet open={clarifyOpen} onOpenChange={setClarifyOpen} rawInput={input} onConfirm={plan} planDate={planDate} />
    </Shell>
  );
}
