import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { greeting, friendlyDate, peakWindow, todayDateStr } from "@/lib/daydraft";
import { supabase } from "@/integrations/supabase/client";
import { Mic, Sparkles, Zap, ArrowRight, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { SpilloverChips } from "@/components/app/SpilloverChips";
import { StreakBadge } from "@/components/app/StreakBadge";
import { useStreak } from "@/hooks/useStreak";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { Bookmark } from "lucide-react";
import { ClarifySheet, ClarifiedTask } from "@/components/app/ClarifySheet";
import { QuickCaptureButton } from "@/components/app/QuickCapture";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";

const DEFAULT_PLACEHOLDER =
  "Write however you want — AI will figure it out.\n\nE.g. finish deck, call mom 15min, gym, reply to Alex...";

// Detect typed durations (30m, 1h, 90min) so the user gets visual confirmation.
const DURATION_RE = /\b(\d+)\s*(h|hr|hour|hrs|hours|m|min|mins|minutes)\b/gi;
const countTasks = (s: string) =>
  s.split(/\r?\n/).map(l => l.trim()).filter(Boolean).length;
const countDurations = (s: string) => (s.match(DURATION_RE) || []).length;

export default function Today() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const nav = useNavigate();
  const { recordPlanToday } = useStreak();
  const { isPro, planQuotaUsed, planQuotaRemaining, entitlement } = useEntitlement();
  const tour = useTour();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<"quota" | "feature" | "trial-banner">("feature");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasToday, setHasToday] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; raw_input: string }[]>([]);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [yesterdayPreview, setYesterdayPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("plans").select("id").eq("user_id", user.id).eq("date", todayDateStr()).maybeSingle()
      .then(({ data }) => setHasToday(!!data));
    // Pull yesterday's plan for the "Plan like yesterday" card
    supabase.from("plans").select("raw_input").eq("user_id", user.id)
      .lt("date", todayDateStr()).order("date", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data?.raw_input) setYesterdayPreview(data.raw_input); });
    // Pull saved templates
    supabase.from("block_templates").select("id, name, raw_input").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data || []) as any));
    // Pull unconsumed quick captures and auto-prepend
    (async () => {
      const { data: caps } = await supabase.from("quick_captures").select("*").eq("user_id", user.id).eq("consumed", false);
      if (caps && caps.length) {
        const block = caps.map((c: any) => (c.content || "").replace(/^\[today\]\s*/, "")).join("\n");
        setInput(prev => prev ? block + "\n" + prev : block);
        await supabase.from("quick_captures").update({ consumed: true } as any).eq("user_id", user.id).eq("consumed", false);
        toast(`📥 Added ${caps.length} from quick capture`);
      }
    })();
  }, [user?.id]);

  // Auto-start tour on first visit (after profile is loaded).
  useEffect(() => {
    if (!profile?.onboarded) return;
    const t = setTimeout(() => tour.start(TOUR_TODAY), 600);
    return () => clearTimeout(t);
  }, [profile?.onboarded]);

  const useYesterday = async () => {
    if (!user) return;
    const { data } = await supabase.from("plans").select("raw_input").eq("user_id", user.id)
      .lt("date", todayDateStr()).order("date", { ascending: false }).limit(1).maybeSingle();
    if (data?.raw_input) { setInput(data.raw_input); toast.success("Loaded yesterday's tasks"); }
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
    try {
      const { data: q } = await supabase.functions.invoke("check-plan-quota", { body: {} });
      if (q && q.allowed === false) {
        setUpgradeReason("quota");
        setUpgradeOpen(true);
        return;
      }
    } catch {/* fail open */}
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
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
          raw_input: input,
          energy_preference: profile.energy_preference,
          name: profile.display_name,
          clarified_tasks: clarified,
        },
      });
      await minWait;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // upsert plan
      const today = todayDateStr();
      const { data: planRow, error: planErr } = await supabase.from("plans").upsert({
        user_id: user.id, date: today, raw_input: input, ai_summary: data.summary, ai_subtext: data.subtext,
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
      try {
        const res = await recordPlanToday();
        if (res?.freezeUsed) toast("🧊 Streak freeze used — you're safe");
        if (res?.milestone) toast.success(`🔥 ${res.milestone}-day streak! Incredible.`);
      } catch {/* ignore */}
      nav("/today/plan");
    } catch (e: any) {
      toast.error(e.message || "Planning failed");
      nav("/today");
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
          <div className="flex items-center gap-2">
            <div data-tour="today-streak"><StreakBadge /></div>
            <div className="h-10 w-10 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-sm font-medium text-secondary-fg">
              {(profile?.display_name || "·").slice(0,1).toUpperCase()}
            </div>
          </div>
        </div>

        <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 shadow-glow">
          <Zap className="h-3.5 w-3.5 text-primary" fill="currentColor" />
          <span className="text-xs font-medium text-primary">Peak hours: {peakWindow(profile?.energy_preference || "morning")}</span>
        </div>

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
          <SpilloverChips onCarryOver={(titles) => {
            const block = titles.join("\n");
            setInput(prev => prev ? block + "\n" + prev : block);
            toast.success(titles.length === 1 ? "Carried over" : `Carried over ${titles.length} tasks`);
          }} />
          {yesterdayPreview && !input && (
            <button
              onClick={() => { setInput(yesterdayPreview); haptics.tap(); toast.success("Loaded yesterday's tasks"); }}
              className="mb-3 w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-primary/30 bg-primary/5 pressable text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <RotateCw className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">Plan like yesterday</div>
                  <div className="text-xs text-secondary-fg truncate">
                    {yesterdayPreview.split(/\r?\n/).filter(Boolean).slice(0, 3).join(" · ")}
                  </div>
                </div>
              </div>
              <span className="text-xs font-semibold text-primary shrink-0">Use →</span>
            </button>
          )}
          <Textarea
            data-tour="today-input"
            value={input} onChange={e => setInput(e.target.value)} placeholder={DEFAULT_PLACEHOLDER}
            className="min-h-[200px] bg-surface border-border rounded-[20px] p-4 text-base leading-relaxed resize-none focus-visible:ring-primary/40 focus-visible:ring-offset-0 focus-visible:border-primary/40 transition-all" />
          {input.trim() && (
            <div className="absolute bottom-3 right-4 inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-background/80 backdrop-blur border border-border text-[11px] text-secondary-fg pointer-events-none">
              <span className="text-foreground font-medium tabular-nums">{countTasks(input)}</span>
              {countTasks(input) === 1 ? "task" : "tasks"}
              {countDurations(input) > 0 && (
                <span className="text-primary">· {countDurations(input)} timed</span>
              )}
            </div>
          )}
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

        {hasToday && (
          <button onClick={() => nav("/today/plan")} className="mt-4 w-full text-left text-sm text-primary hover:underline">
            View today's existing plan →
          </button>
        )}

        <div className="mt-8">
          <Button data-tour="today-plan" onClick={openClarify} disabled={busy} className="w-full h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}>
            Plan My Day <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="text-xs text-secondary-fg text-center mt-2">
            Next: confirm AI time estimates · pin meetings · then auto-schedule
          </p>
        </div>
      </div>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason={upgradeReason} />
      <ClarifySheet open={clarifyOpen} onOpenChange={setClarifyOpen} rawInput={input} onConfirm={plan} />
    </Shell>
  );
}
