import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { ArrowRight, Check, Layers, Sparkles } from "lucide-react";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TONE_OPTIONS, type Tone } from "@/lib/tone";
import { haptics } from "@/lib/haptics";

const PROGRESS_KEY = "dd_onboarding_progress";
const TONE_KEYS = TONE_OPTIONS.map((o) => o.key);

export default function Onboarding() {
  const initial = (() => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      if (!raw) return { step: 0, tone: "professional" as Tone };
      const p = JSON.parse(raw);
      const step = [0, 1, 2, 3, 4].includes(p.step) ? p.step : 0;
      const tone = TONE_KEYS.includes(p.tone) ? (p.tone as Tone) : ("professional" as Tone);
      return { step, tone };
    } catch {
      return { step: 0, tone: "professional" as Tone };
    }
  })();

  const [step, setStep] = useState<number>(initial.step);
  const [tone, setTone] = useState<Tone>(initial.tone);
  const [lateDayHour, setLateDayHour] = useState(19);
  const [timelineMorph, setTimelineMorph] = useState(false);
  const morphTimerRef = useRef<number | null>(null);
  const { update } = useProfile();
  const nav = useNavigate();

  const draftTasks = [
    "Finish investor update",
    "Deep work: onboarding polish",
    "Gym 45m",
    "Inbox zero",
  ];

  const previewBlocks = useMemo(() => {
    const base = [
      { time: "09:00", title: "Deep work: onboarding polish", minutes: 90 },
      { time: "10:45", title: "Finish investor update", minutes: 60 },
      { time: "12:00", title: "Lunch + reset", minutes: 45 },
      { time: "13:15", title: "Inbox zero", minutes: 35 },
      { time: "18:00", title: "Gym 45m", minutes: 45 },
    ];
    if (lateDayHour < 18) return base;
    return [
      { time: "19:10", title: "Finish investor update", minutes: 45 },
      { time: "20:05", title: "Deep work: onboarding polish", minutes: 50 },
      { time: "21:10", title: "Inbox zero", minutes: 20 },
    ];
  }, [lateDayHour]);

  const tonePreview: Record<Tone, string> = {
    professional: "Priority order is clear. We start with the highest-value task.",
    coach: "You have momentum. One focused block now, then we build from there.",
    playful: "Let us turn this chaos into a crisp, satisfying timeline.",
    motivational: "Today is winnable. Start hard, keep tempo, finish proud.",
    tough_love: "No fluff: execute top priorities first, then clean up.",
    philosophical: "Design your attention, and the day will follow.",
    custom: "Your custom voice will shape plans, nudges, and recap language.",
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, tone }));
    } catch {
      // ignore
    }
  }, [step, tone]);

  useEffect(() => {
    return () => {
      if (morphTimerRef.current !== null) {
        window.clearTimeout(morphTimerRef.current);
      }
    };
  }, []);

  const [finishing, setFinishing] = useState(false);

  const finish = async (notif: boolean) => {
    if (finishing) return;
    setFinishing(true);
    let enabled = false;
    try {
      if (notif && pushSupported()) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            await enablePush(session.user.id);
            enabled = true;
          }
        } catch (e: any) {
          if (e?.message && !/VAPID|configured/i.test(e.message)) toast(e.message);
        }
      }
      const tz = (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
          return "UTC";
        }
      })();
      try {
        localStorage.setItem("dd_ai_tone", tone);
      } catch {
        // ignore
      }
      await update({
        ai_tone: tone as any,
        notifications_enabled: enabled,
        onboarded: true,
        timezone: tz,
      } as any);
      try {
        sessionStorage.removeItem(PROGRESS_KEY);
      } catch {
        // ignore
      }
      nav("/home");
    } catch (e: any) {
      toast.error(e?.message || "Could not finish onboarding. Please try again.");
    } finally {
      setFinishing(false);
    }
  };

  const morphToTimeline = () => {
    if (timelineMorph) return;
    haptics.selection();
    setTimelineMorph(true);
    morphTimerRef.current = window.setTimeout(() => {
      haptics.impact("light");
      setStep(2);
      setTimelineMorph(false);
      morphTimerRef.current = null;
    }, 360);
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[440px] min-h-screen flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[240px]" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-14 pb-10 page-enter" key={step}>
          <div className="flex gap-1.5 mb-8">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-[3px] flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-border/70"}`} />
            ))}
          </div>

          {step === 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col justify-center">
                <p className="eyebrow">DayDraft</p>
                <h1 className="font-display text-[38px] font-semibold leading-[1.05] tracking-tight mt-3 text-balance">
                  Let&apos;s design your best day in 60 seconds.
                </h1>
                <p className="text-secondary-fg mt-5 text-[15px] leading-[1.55] max-w-sm">
                  A live preview of how DayDraft turns raw tasks into a focused timeline.
                </p>
                <div className="mt-5 app-card px-4 py-5 space-y-2 fade-in">
                  <div className="text-[11px] uppercase tracking-wider text-secondary-fg inline-flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Day in glass
                  </div>
                  <div className="text-[13px] text-subtle">Input → smart schedule → quick replan when reality moves.</div>
                </div>
              </div>
              <Button disabled={finishing} onClick={() => setStep(1)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium shadow-card">
                Start preview <ArrowRight className="h-4 w-4" />
              </Button>
              <button type="button" disabled={finishing} onClick={() => finish(false)} className="mt-3 text-secondary-fg text-[13px] hover:text-foreground transition-colors mx-auto disabled:opacity-60 disabled:pointer-events-none">
                Skip intro
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="flex-1 flex flex-col">
              <p className="eyebrow">Step 2 of 5</p>
              <h1 className="font-display text-[26px] font-semibold leading-tight mt-2 tracking-tight text-balance">
                Drop tasks as you think
              </h1>
              <p className="text-secondary-fg mt-2 text-[13px] leading-[1.55]">No strict format required.</p>
              <div className="mt-6 app-card px-4 py-5 space-y-2.5 flex-1">
                {draftTasks.map((task, i) => (
                  <div key={task} className="rounded-xl border border-soft surface-soft px-3 py-2 text-[13px] text-foreground fade-in" style={{ animationDelay: `${i * 80}ms` }}>
                    {task}
                  </div>
                ))}
              </div>
              <Button disabled={finishing} onClick={morphToTimeline} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card">
                Build timeline
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 flex flex-col">
              <p className="eyebrow">Step 3 of 5</p>
              <h1 className="font-display text-[26px] font-semibold leading-tight mt-2 tracking-tight text-balance">
                Your day, auto-structured
              </h1>
              <p className="text-secondary-fg mt-2 text-[13px] leading-[1.55]">
                Long work is split into realistic blocks.
              </p>
              <div className="mt-6 space-y-2.5 flex-1">
                {previewBlocks.map((b, i) => (
                  <div key={`${b.time}-${b.title}`} className="rounded-xl border border-soft surface-card px-3 py-2.5 flex items-center gap-3 fade-in" style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="text-[11px] text-secondary-fg font-mono-sf tabular-nums w-12">{b.time}</span>
                    <span className="w-1 h-5 rounded-full bg-primary/75" />
                    <span className="text-[13px] text-foreground flex-1 truncate">{b.title}</span>
                    <span className="text-[11px] text-secondary-fg tabular-nums">{b.minutes}m</span>
                  </div>
                ))}
              </div>
              <Button disabled={finishing} onClick={() => setStep(3)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card">
                Choose AI voice
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="flex-1 flex flex-col">
              <p className="eyebrow">Step 4 of 5</p>
              <h1 className="font-display text-[26px] font-semibold leading-tight mt-2 tracking-tight text-balance">
                How should DayDraft talk to you?
              </h1>
              <p className="text-secondary-fg mt-2 text-[13px] leading-[1.55]">
                Applied to plans, nudges, AI help, and recap insights.
              </p>
              <div className="space-y-2 mt-6 flex-1 overflow-y-auto">
                {TONE_OPTIONS.map((e) => {
                  const active = tone === e.key;
                  return (
                    <button
                      key={e.key}
                      onClick={() => setTone(e.key)}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-[16px] border pressable transition-all backdrop-blur-sm ${active ? "border-accent surface-accent" : "border-soft surface-card hover:border-strong"}`}
                    >
                      <span className="text-lg">{e.emoji}</span>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-[14px]">{e.title}</div>
                        <div className="text-[11.5px] text-secondary-fg leading-snug mt-0.5">{e.sub}</div>
                      </div>
                      <span className={`h-[18px] w-[18px] rounded-full border flex items-center justify-center transition-all shrink-0 ${active ? "border-primary bg-primary" : "border-soft"}`}>
                        {active && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 rounded-xl border border-soft surface-soft px-3 py-2.5 text-[12px] text-subtle fade-in">
                {tonePreview[tone]}
              </div>
              <Button disabled={finishing} onClick={() => setStep(4)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card">
                See how plans adapt
              </Button>
            </div>
          )}

          {step === 4 && (
            <div className="flex-1 flex flex-col">
              <p className="eyebrow">Step 5 of 5</p>
              <h1 className="font-display text-[26px] font-semibold leading-tight mt-2 tracking-tight text-balance">
                Day shifts? Plan adapts.
              </h1>
              <p className="text-secondary-fg mt-2 text-[13px] leading-[1.55]">
                Move the time — see how the planner tightens what&apos;s still doable.
              </p>
              <div className="mt-5 app-card px-4 py-5">
                <div className="flex items-center justify-between text-[12px] text-secondary-fg">
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-primary" /> Afternoon shift preview
                  </span>
                  <span>{String(lateDayHour).padStart(2, "0")}:00</span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={22}
                  step={1}
                  value={lateDayHour}
                  onChange={(e) => setLateDayHour(Number(e.target.value))}
                  className="mt-3 w-full"
                />
              </div>
              <div className="mt-3 space-y-2.5 flex-1">
                {previewBlocks.map((b) => (
                  <div key={`${b.time}-${b.title}`} className="rounded-xl border border-soft surface-card px-3 py-2.5 flex items-center gap-3 fade-in">
                    <span className="text-[11px] text-secondary-fg font-mono-sf tabular-nums w-12">{b.time}</span>
                    <span className="w-1 h-5 rounded-full bg-primary/75" />
                    <span className="text-[13px] text-foreground flex-1 truncate">{b.title}</span>
                  </div>
                ))}
              </div>
              <Button disabled={finishing} onClick={() => finish(true)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card">
                Enable nudges & continue
              </Button>
              <button disabled={finishing} onClick={() => finish(false)} className="mt-3 text-secondary-fg text-[13px] hover:text-foreground transition-colors mx-auto disabled:opacity-60 disabled:pointer-events-none">
                Continue without nudges
              </button>
            </div>
          )}

          {step > 0 && (
            <button
              type="button"
              disabled={timelineMorph || finishing}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="mt-4 text-[12px] text-secondary-fg hover:text-foreground mx-auto disabled:opacity-50 disabled:pointer-events-none"
            >
              Back
            </button>
          )}
        </div>
        {timelineMorph && (
          <div className="absolute inset-0 z-30 px-6 pt-24 pb-10 pointer-events-none">
            <div className="rounded-[22px] border border-accent surface-accent p-4 shadow-elevated animate-in fade-in duration-200">
              <div className="text-[10px] uppercase tracking-[0.14em] text-secondary-fg mb-2">Transforming into timeline</div>
              <div className="space-y-2">
                {previewBlocks.slice(0, 4).map((b, i) => (
                  <div
                    key={`${b.time}-${b.title}-morph`}
                    className="rounded-xl border border-soft surface-card px-3 py-2.5 flex items-center gap-3"
                    style={{
                      opacity: 0.72 + i * 0.07,
                      transform: `translateY(${i * 2}px) scale(${1 - i * 0.01})`,
                      transition: "transform 320ms cubic-bezier(0.22,1,0.36,1), opacity 280ms ease",
                    }}
                  >
                    <span className="text-[11px] text-secondary-fg font-mono-sf tabular-nums w-12">{b.time}</span>
                    <span className="w-1 h-5 rounded-full bg-primary/80" />
                    <span className="text-[13px] text-foreground flex-1 truncate">{b.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
