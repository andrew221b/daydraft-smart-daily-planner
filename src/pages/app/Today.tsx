import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  friendlyDate,
  todayDateStr,
  dateStr,
  parseDateStr,
  friendlyDateFor,
  fmtTime,
  Block,
  typeColor,
} from "@/lib/daydraft";
import { getTone, t as toneCopy, greetingFor } from "@/lib/tone";
import {
  Mic,
  Sparkles,
  ArrowRight,
  CalendarDays,
  MoreHorizontal,
  Bookmark,
  Plus,
  Pencil,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ProBadge } from "@/components/app/ProBadge";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { ClarifySheet, ClarifiedTask } from "@/components/app/ClarifySheet";
import { QuickCaptureButton } from "@/components/app/QuickCapture";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const DEFAULT_PLACEHOLDER =
  "Brain-dump your day…\nfinish deck · gym 45m · call mom 15m · ship invoice";

export default function Today() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const nav = useNavigate();
  const { isPro, planQuotaRemaining, entitlement } = useEntitlement();
  const tour = useTour();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<"quota" | "feature" | "trial-banner">("feature");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasPlanForDate, setHasPlanForDate] = useState(false);
  const [planBlocks, setPlanBlocks] = useState<Block[]>([]);
  const [planSummary, setPlanSummary] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; raw_input: string }[]>([]);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [planDate, setPlanDate] = useState<string>(todayDateStr());
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [pendingCaptureIds, setPendingCaptureIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("plans").select("id, ai_summary").eq("user_id", user.id).eq("date", planDate).maybeSingle();
      if (!p) { setHasPlanForDate(false); setPlanBlocks([]); setPlanSummary(null); return; }
      const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", p.id).order("position");
      const list = (bs || []) as Block[];
      setHasPlanForDate(list.length > 0);
      setPlanBlocks(list);
      setPlanSummary(list.length > 0 ? (p.ai_summary || null) : null);
    })();
    supabase.from("block_templates").select("id, name, raw_input").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data || []) as any));
    (async () => {
      const { data: caps } = await supabase.from("quick_captures").select("*").eq("user_id", user.id).eq("consumed", false);
      if (!caps || !caps.length) { setPendingCaptureIds([]); return; }
      const matching = caps.filter((c: any) => {
        const content: string = c.content || "";
        const forMatch = content.match(/^\[for:(\d{4}-\d{2}-\d{2})\]\s*/);
        if (forMatch) return forMatch[1] === planDate;
        return planDate === todayDateStr();
      });
      if (!matching.length) { setPendingCaptureIds([]); return; }
      const block = matching.map((c: any) => (c.content || "")
        .replace(/^\[today\]\s*/, "")
        .replace(/^\[for:\d{4}-\d{2}-\d{2}\]\s*/, "")
      ).join("\n");
      setInput(prev => prev ? block + "\n" + prev : block);
      setComposerOpen(true);
      setPendingCaptureIds(matching.map((c: any) => c.id));
      toast(`Added ${matching.length} from quick capture`);
    })();
  }, [user?.id, planDate]);

  useEffect(() => {
    if (!profile?.onboarded) return;
    if (profile.tour_seen && (profile.tour_seen as any).today) return;
    const t = setTimeout(() => tour.start(TOUR_TODAY), 800);
    return () => clearTimeout(t);
  }, [profile?.onboarded, profile?.tour_seen]);

  const useYesterday = async () => {
    if (!user) return;
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
    if (raw) { setInput(raw); setComposerOpen(true); toast.success("Loaded previous tasks"); }
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
    setComposerOpen(true);
    toast.success(`Loaded "${t.name}"`);
  };

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Voice input not supported in this browser"); return; }
    const r = new SR(); r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e: any) => { setInput(prev => prev + (prev ? "\n" : "") + e.results[0][0].transcript); setComposerOpen(true); };
    r.onerror = () => toast.error("Couldn't capture voice");
    r.start();
    toast("Listening…");
  };

  const openClarify = async () => {
    if (!input.trim()) { toast.error("Add at least one task"); return; }
    if (!user || !profile) return;
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
          active_hours_start: (profile as any).active_hours_start || "09:00",
          active_hours_end: (profile as any).active_hours_end || "22:00",
          ai_tone: (profile as any).ai_tone || "motivational",
          ai_tone_custom: (profile as any).ai_tone_custom || null,
        },
      });
      await minWait;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

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
      if (pendingCaptureIds.length) {
        try {
          await supabase.from("quick_captures").update({ consumed: true } as any)
            .in("id", pendingCaptureIds);
        } catch {/* ignore */}
        setPendingCaptureIds([]);
      }
      try {
        const trackTitles = clarified
          .filter(t => t.track_time)
          .map(t => t.title.trim().toLowerCase());
        localStorage.setItem(
          `dd_track_titles_${planRow.id}`,
          JSON.stringify(trackTitles),
        );
      } catch {/* ignore */}
      nav(planDate === todayDateStr() ? "/today/plan" : `/today/plan?date=${planDate}`);
    } catch (e: any) {
      toast.error(e.message || "Planning failed");
      nav(planDate === todayDateStr() ? "/today" : `/today?date=${planDate}`);
    } finally { setBusy(false); }
  };

  const showTrialBanner = entitlement?.tier === "trial" && (entitlement.daysLeftInTrial ?? 99) <= 3;

  // Derive a glanceable plan summary
  const planStats = useMemo(() => {
    const tasks = planBlocks.filter(b => b.kind === "task");
    const done = tasks.filter(b => b.completed).length;
    const totalMin = tasks.reduce((s, b) => s + b.duration_min, 0);
    return { tasks, done, total: tasks.length, hours: Math.round(totalMin / 6) / 10 };
  }, [planBlocks]);

  const isToday = planDate === todayDateStr();
  const tone = getTone(profile as any);

  return (
    <Shell>
      <div className="px-6 pt-12">
        {/* ── Header ─────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{friendlyDate()}</p>
            <h1 className="font-display text-[28px] font-semibold leading-[1.1] mt-1.5 truncate">
              {greetingFor(tone, profile?.display_name)}
            </h1>
          </div>
          <ProBadge />
        </div>

        {/* ── Plan — primary surface when present ─ */}
        {hasPlanForDate ? (
          <div className="mt-7">
            <button
              onClick={() => nav(isToday ? "/today/plan" : `/today/plan?date=${planDate}`)}
              className="w-full text-left rounded-[20px] bg-surface border border-border p-5 pressable hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow text-primary">{isToday ? "Today's plan" : friendlyDateFor(parseDateStr(planDate))}</span>
                <span className="text-[11px] text-secondary-fg tabular-nums">
                  <span className="text-foreground font-semibold">{planStats.done}</span>
                  /{planStats.total} · {planStats.hours}h
                </span>
              </div>

              {planSummary && (
                <p className="font-display text-[18px] leading-snug text-foreground mt-3">
                  {planSummary}
                </p>
              )}

              {/* First 3 blocks — peek */}
              <div className="mt-4 space-y-2">
                {planStats.tasks.slice(0, 3).map(b => (
                  <div key={b.id} className="flex items-center gap-3">
                    <span className="text-[11px] text-secondary-fg font-mono-sf w-10 tabular-nums">{fmtTime(b.start_time)}</span>
                    <span className="w-1 h-4 rounded-full" style={{ background: typeColor(b.type) }} />
                    <span className={`text-[13.5px] flex-1 truncate ${b.completed ? "line-through text-secondary-fg" : "text-foreground"}`}>
                      {b.title}
                    </span>
                  </div>
                ))}
                {planStats.total > 3 && (
                  <div className="text-[11.5px] text-secondary-fg pl-[52px]">+ {planStats.total - 3} more</div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-[12.5px] text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open plan <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>

            {/* Re-plan affordance — quiet */}
            <button
              onClick={() => setComposerOpen(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 h-10 rounded-full text-[12.5px] text-secondary-fg hover:text-foreground border border-border bg-surface/50 pressable"
            >
              <Pencil className="h-3.5 w-3.5" /> Add more or re-plan
            </button>
          </div>
        ) : (
          /* ── Empty state — single question ── */
          <div className="mt-10">
            <p className="font-display text-[22px] leading-snug text-foreground">
              {toneCopy(tone, "plan_cta") || "What's on your plate today?"}
            </p>
            <p className="text-[13.5px] text-secondary-fg mt-2 leading-relaxed">
              Brain-dump in any format. AI shapes it into a focused day.
            </p>

            <Button
              onClick={() => setComposerOpen(true)}
              data-tour="today-plan"
              className="w-full mt-6 h-14 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15.5px] font-semibold pressable shadow-card"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Plan my day
            </Button>

            <div className="mt-3 flex items-center gap-2">
              <button onClick={voice}
                className="flex-1 h-11 rounded-xl border border-border bg-surface/50 text-[12.5px] text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center gap-1.5">
                <Mic className="h-3.5 w-3.5" /> Speak it
              </button>
              <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex-1 h-11 rounded-xl border text-[12.5px] font-medium pressable inline-flex items-center justify-center gap-1.5",
                      isToday
                        ? "bg-surface/50 border-border text-secondary-fg hover:text-foreground"
                        : "bg-primary/10 border-primary/30 text-primary"
                    )}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    {isToday ? "Today" : friendlyDateFor(parseDateStr(planDate))}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={parseDateStr(planDate)}
                    onSelect={(d) => { if (d) { setPlanDate(dateStr(d)); setDatePopoverOpen(false); } }}
                    disabled={(d) => { const today = new Date(); today.setHours(0,0,0,0); return d < today; }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <button
                onClick={() => setMoreOpen(true)}
                className="h-11 w-11 rounded-xl border border-border bg-surface/50 text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center"
                aria-label="More"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Trial / quota whisper ─────────── */}
        {showTrialBanner && (
          <button onClick={() => { setUpgradeReason("trial-banner"); setUpgradeOpen(true); }}
            className="mt-5 w-full flex items-center justify-between px-4 h-11 rounded-xl border border-primary/25 bg-primary/[0.06] pressable">
            <span className="text-[12.5px] text-foreground">{entitlement!.daysLeftInTrial} days left in trial</span>
            <span className="text-[12px] font-semibold text-primary">Upgrade →</span>
          </button>
        )}
        {!isPro && planQuotaRemaining === 0 && !showTrialBanner && (
          <p className="mt-4 text-[11.5px] text-secondary-fg">
            Free plans for this week are used.{" "}
            <button onClick={() => { setUpgradeReason("feature"); setUpgradeOpen(true); }}
              className="text-primary hover:underline">Go unlimited</button>
          </p>
        )}
      </div>

      {/* ─── Composer sheet — write tasks here ─── */}
      <Sheet open={composerOpen} onOpenChange={setComposerOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] border-border bg-popover p-5 max-h-[88vh]">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="font-display text-[18px]">
              {hasPlanForDate ? "Add or re-plan" : (isToday ? "Plan today" : `Plan ${friendlyDateFor(parseDateStr(planDate))}`)}
            </SheetTitle>
          </SheetHeader>
          <Textarea
            data-tour="today-input"
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={DEFAULT_PLACEHOLDER}
            className="min-h-[180px] bg-surface-elevated border-border rounded-2xl p-4 text-[15px] leading-relaxed resize-none placeholder:text-secondary-fg/60 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40"
          />
          <div className="flex items-center gap-2 mt-3">
            <button onClick={voice}
              className="h-9 w-9 rounded-lg border border-border bg-surface text-secondary-fg pressable hover:text-foreground inline-flex items-center justify-center"
              aria-label="Voice"
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
              <PopoverTrigger asChild>
                <button className={cn(
                  "h-9 px-3 rounded-lg border text-[12px] font-medium pressable inline-flex items-center gap-1.5",
                  isToday ? "border-border bg-surface text-secondary-fg" : "border-primary/30 bg-primary/10 text-primary"
                )}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  {isToday ? "Today" : friendlyDateFor(parseDateStr(planDate))}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={parseDateStr(planDate)}
                  onSelect={(d) => { if (d) { setPlanDate(dateStr(d)); setDatePopoverOpen(false); } }}
                  disabled={(d) => { const today = new Date(); today.setHours(0,0,0,0); return d < today; }}
                  initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <button onClick={() => setMoreOpen(true)}
              className="ml-auto h-9 w-9 rounded-lg border border-border bg-surface text-secondary-fg pressable hover:text-foreground inline-flex items-center justify-center">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={openClarify} disabled={busy}
            className="w-full mt-3 h-12 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-semibold pressable">
            {hasPlanForDate ? "Re-plan with these" : "Generate plan"} <ArrowRight className="h-4 w-4" />
          </Button>
        </SheetContent>
      </Sheet>

      {/* ── More sheet ─────────────────────── */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] border-border bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="font-display text-[18px]">Quick actions</SheetTitle>
          </SheetHeader>
          <div className="space-y-1">
            <MoreRow onClick={() => { setMoreOpen(false); useYesterday(); }} icon={<Sparkles className="h-4 w-4" />} label="Use yesterday's tasks" />
            <MoreRow onClick={() => { setMoreOpen(false); saveAsTemplate(); }} icon={<Bookmark className="h-4 w-4" />} label="Save current as template" />
            {templates.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border">
                <div className="px-3 py-1.5 eyebrow">Templates</div>
                {templates.map(t => (
                  <MoreRow key={t.id} onClick={() => { setMoreOpen(false); applyTemplate(t); }} icon={<Bookmark className="h-4 w-4" />} label={t.name} />
                ))}
              </div>
            )}
            <div className="pt-1">
              <QuickCaptureButton variant="chip" className="w-full justify-center" />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason={upgradeReason} />
      <ClarifySheet open={clarifyOpen} onOpenChange={setClarifyOpen} rawInput={input} onConfirm={plan} planDate={planDate} />
    </Shell>
  );
}

const MoreRow = ({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) => (
  <button onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl pressable hover:bg-surface-elevated text-[14px] text-foreground"
  >
    <span className="text-secondary-fg">{icon}</span>
    <span className="flex-1 text-left">{label}</span>
  </button>
);
