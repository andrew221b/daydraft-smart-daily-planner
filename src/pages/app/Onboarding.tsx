import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import {
  ArrowRight,
  Sparkles,
  ChevronLeft,
  Play,
  Square,
  FileDown,
  Wallet,
  Zap,
  Compass,
} from "lucide-react";
import { motion } from "framer-motion";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";

const PROGRESS_KEY = "dd_onboarding_progress_v5";
const STEPS = 5;
type StepIdx = 0 | 1 | 2 | 3 | 4;



type Progress = {
  step: StepIdx;
  aiAbout: string;
};

const readProgress = (): Progress => {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<Progress>;
    const validStep = ([0, 1, 2, 3, 4] as StepIdx[]).includes(p.step as StepIdx);
    return {
      step: validStep ? (p.step as StepIdx) : 0,
      aiAbout: typeof p.aiAbout === "string" ? p.aiAbout : "",
    };
  } catch {
    return { step: 0, aiAbout: "" };
  }
};

export default function Onboarding() {
  const initial = useMemo(readProgress, []);
  const [step, setStep] = useState<StepIdx>(initial.step);
  const [aiAbout, setAiAbout] = useState(initial.aiAbout);
  const [plan, setPlan] = useState<"weekly" | "monthly" | "annual">("annual");
  const [finishing, setFinishing] = useState(false);
  const [busyCheckout, setBusyCheckout] = useState(false);

  const { profile, update, refresh } = useProfile();
  const nav = useNavigate();

  useEffect(() => {
    try {
      const snapshot: Partial<Progress> = { step, aiAbout };
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore — sessionStorage can fail in private mode */
    }
  }, [step, aiAbout]);

  const goTo = (s: StepIdx) => {
    haptics.selection();
    setStep(s);
  };
  const goNext = () => goTo(Math.min(STEPS - 1, step + 1) as StepIdx);
  const goBack = () => goTo(Math.max(0, step - 1) as StepIdx);

  const finish = async (notif: boolean) => {
    if (finishing) return;
    setFinishing(true);
    let pushEnabled = false;
    try {
      if (notif && pushSupported()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            await enablePush(session.user.id);
            pushEnabled = true;
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : null;
          if (msg && !/VAPID|configured/i.test(msg)) toast(msg);
        }
      }

      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
      try { localStorage.setItem("dd_ai_tone", "professional"); } catch { /* ignore */ }

      const payload = {
        ai_tone: "professional",
        ai_context_custom: aiAbout.trim() || null,
        notifications_enabled: pushEnabled,
        onboarded: true,
        timezone: tz,
      };

      if (profile) {
        await update(payload as never);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          const { error } = await supabase
            .from("profiles")
            .upsert({ id: uid, ...payload } as never, { onConflict: "id" });
          if (error) throw error;
          await refresh();
        }
      }

      try { sessionStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      haptics.notify("success");
      nav("/home");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not finish onboarding. Please try again.";
      toast.error(msg);
    } finally {
      setFinishing(false);
    }
  };

  const tryCheckout = async () => {
    if (busyCheckout) return;
    setBusyCheckout(true);
    haptics.tap();
    try {
      await startCheckout(plan, {
        onUnavailable: () => toast("Payments coming soon — you're set up for free."),
      });
    } finally {
      setBusyCheckout(false);
      finish(true);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-background flex justify-center overflow-y-auto overscroll-y-contain no-scrollbar">
      <div className="relative w-full max-w-[440px] min-h-full flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[280px]" style={{ background: "var(--gradient-glow)" }} />

        <div className="relative z-10 flex-1 flex flex-col px-6 pt-[max(env(safe-area-inset-top),14px)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <div className="flex items-center justify-between h-9 -mx-1 mb-4">
            {step > 0 && step < 4 ? (
              <button
                type="button"
                onClick={goBack}
                disabled={finishing}
                aria-label="Back"
                className="h-9 w-9 inline-flex items-center justify-center rounded-full text-secondary-fg hover:text-foreground hover:bg-foreground/5 pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
              </button>
            ) : (
              <span className="h-9 w-9" />
            )}

            {step > 0 && step < 4 ? (
              <button
                type="button"
                onClick={() => goTo(4)}
                disabled={finishing}
                className="h-9 px-3 text-[13px] font-medium text-secondary-fg hover:text-foreground pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                Skip
              </button>
            ) : (
              <span className="h-9 w-9" />
            )}
          </div>

          <div className="flex gap-1.5 mb-7">
            {Array.from({ length: STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${
                  i <= step ? "bg-primary" : "bg-border/70"
                }`}
              />
            ))}
          </div>

          <div className="flex-1 flex flex-col page-enter" key={step}>
            {step === 0 && <WelcomeStep onContinue={() => goTo(1)} disabled={finishing} />}
            {step === 1 && <PlanShowcaseStep onContinue={() => goTo(2)} disabled={finishing} />}
            {step === 2 && <TrackShowcaseStep onContinue={() => goTo(3)} disabled={finishing} />}
            {step === 3 && (
              <SetupStep
                aiAbout={aiAbout}
                onAiAbout={setAiAbout}
                onContinue={() => goTo(4)}
                disabled={finishing}
              />
            )}
            {step === 4 && (
              <PaywallStep
                plan={plan}
                onPlan={setPlan}
                onCheckout={tryCheckout}
                onSkip={() => finish(false)}
                onBack={() => goTo(3)}
                busyCheckout={busyCheckout}
                finishing={finishing}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 0 — Welcome                                                  */
/* ------------------------------------------------------------------ */

/** Small star dot that twinkles at a random phase. */
function StarDot({ style }: { style: React.CSSProperties }) {
  return (
    <motion.div
      className="absolute h-1.5 w-1.5 rounded-full bg-primary"
      animate={{
        scale: [0.6, 1.4, 0.6],
        opacity: [0.3, 1, 0.3],
      }}
      transition={{
        duration: 1.8 + Math.random() * 1.4,
        repeat: Infinity,
        ease: "easeInOut",
        delay: Math.random() * 2,
      }}
      style={style}
    />
  );
}

function WelcomeStep({ onContinue, disabled }: { onContinue: () => void; disabled: boolean }) {
  return (
    <div className="flex-1 flex flex-col fade-in">
      <div className="flex-1 flex flex-col justify-center">
        {/* Animated AI icon */}
        <div className="relative w-36 h-36 mx-auto mb-8 flex items-center justify-center">
          {/* Breathing outer glow blob */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ background: "radial-gradient(circle, hsl(var(--primary)/0.55) 0%, hsl(250 80% 55%/0.35) 50%, transparent 75%)" }}
            animate={{ scale: [1, 1.12, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          />
          {/* Slower secondary blob, offset phase */}
          <motion.div
            className="absolute inset-4 rounded-full"
            style={{ background: "radial-gradient(circle, hsl(280 70% 60%/0.5) 0%, hsl(var(--primary)/0.3) 60%, transparent 80%)" }}
            animate={{ scale: [1.05, 0.92, 1.05], opacity: [0.5, 0.85, 0.5] }}
            transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
          />
          {/* Third inner glow */}
          <motion.div
            className="absolute inset-8 rounded-full"
            style={{ background: "radial-gradient(circle, hsl(var(--primary)/0.6) 0%, transparent 70%)" }}
            animate={{ scale: [0.9, 1.15, 0.9], opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 1.6 }}
          />

          {/* Twinkling star dots around the icon */}
          <StarDot style={{ top: "10%", left: "18%" }} />
          <StarDot style={{ top: "8%", right: "20%" }} />
          <StarDot style={{ bottom: "14%", left: "12%" }} />
          <StarDot style={{ bottom: "10%", right: "16%" }} />
          <StarDot style={{ top: "45%", left: "4%" }} />
          <StarDot style={{ top: "42%", right: "3%" }} />

          {/* Icon box — floats gently */}
          <motion.div
            className="relative z-10 w-[68px] h-[68px] rounded-[1.5rem] bg-background/95 border border-white/15 dark:border-white/8 backdrop-blur-xl flex items-center justify-center shadow-[0_12px_40px_rgba(0,0,0,0.22),inset_0_1px_1px_rgba(255,255,255,0.18)]"
            animate={{ y: [-4, 4, -4] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            {/* Sparkles icon — periodic shimmer flash */}
            <motion.div
              animate={{
                scale: [1, 1.18, 1, 1],
                opacity: [1, 1, 1, 1],
                filter: [
                  "brightness(1)",
                  "brightness(1.6) drop-shadow(0 0 8px hsl(var(--primary)))",
                  "brightness(1.1)",
                  "brightness(1)",
                ],
              }}
              transition={{
                duration: 0.7,
                repeat: Infinity,
                repeatDelay: 2.3,
                ease: "easeInOut",
              }}
            >
              <Sparkles className="h-8 w-8 text-primary" strokeWidth={1.6} />
            </motion.div>
          </motion.div>
        </div>

        <p className="eyebrow text-center">DayDraft</p>
        <h1 className="font-display text-[34px] font-semibold leading-[1.08] tracking-tight mt-3 text-balance text-center">
          Your day, planned for you.
        </h1>
        <p className="text-secondary-fg mt-4 text-[15px] leading-[1.55] max-w-[20rem] mx-auto text-center text-balance">
          AI turns your goals into a realistic schedule. Track what shipped, and bill it.
        </p>
      </div>

      <Button
        disabled={disabled}
        onClick={onContinue}
        className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-[0_12px_32px_-8px_hsl(var(--primary)/0.6)] mt-6"
      >
        Get started <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Plan showcase                                            */
/* ------------------------------------------------------------------ */

const MOCK_PLAN_TASKS = [
  { time: "9:00", label: "Design review", color: "#7C3AED", mins: 45 },
  { time: "10:00", label: "Client meeting", color: "#EC4899", mins: 30 },
  { time: "10:45", label: "Deep work", color: "#0EA5E9", mins: 90 },
  { time: "12:30", label: "Lunch break", color: "#10B981", mins: 45 },
];

function PlanMockup() {
  return (
    <div className="rounded-2xl border border-border/30 bg-background/40 backdrop-blur-sm overflow-hidden">
      {/* Fake AI header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/20">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </motion.div>
        <span className="text-[11px] font-semibold text-secondary-fg/80">AI built your day</span>
        <div className="ml-auto flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1 w-1 rounded-full bg-primary"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
            />
          ))}
        </div>
      </div>

      <div className="px-3.5 py-3 space-y-2">
        {MOCK_PLAN_TASKS.map((task, i) => (
          <motion.div
            key={task.label}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.35, type: "spring", stiffness: 280, damping: 28 }}
            className="flex items-center gap-2.5"
          >
            <span className="text-[10px] font-mono tabular-nums text-secondary-fg/60 w-9 shrink-0">{task.time}</span>
            <div
              className="h-6 rounded-lg flex items-center px-2 gap-1.5 flex-1"
              style={{ background: `${task.color}22`, border: `1px solid ${task.color}40` }}
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: task.color }} />
              <span className="text-[12px] font-medium truncate" style={{ color: task.color }}>{task.label}</span>
              <span className="ml-auto text-[10px] font-mono" style={{ color: `${task.color}99` }}>{task.mins}m</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function PlanShowcaseStep({ onContinue, disabled }: { onContinue: () => void; disabled: boolean }) {
  return (
    <div className="flex-1 flex flex-col fade-in">
      <div className="flex-1 flex flex-col">
        <p className="eyebrow">Smart planning</p>
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance">
          Schedules that respect your day.
        </h1>
        <p className="text-secondary-fg mt-2 text-[14px] leading-snug max-w-sm">
          Tell AI what's on your plate — it time-blocks your entire day in seconds.
        </p>

        <div className="mt-6">
          <PlanMockup />
        </div>
      </div>

      <Button
        disabled={disabled}
        onClick={onContinue}
        className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-card mt-6"
      >
        Continue <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Track & bill showcase                                    */
/* ------------------------------------------------------------------ */

function TrackerMockup() {
  const [elapsed, setElapsed] = useState(0);
  const RATE = 80;

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const totalSecs = 5432 + elapsed; // start at 1:30:32 + live ticking
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  const earnings = ((totalSecs / 3600) * RATE).toFixed(2);

  return (
    <div className="rounded-2xl border border-border/30 bg-background/40 backdrop-blur-sm overflow-hidden">
      {/* Active timer header */}
      <div className="px-4 pt-4 pb-3 border-b border-border/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <motion.div
              className="h-2 w-2 rounded-full bg-green-500"
              animate={{ opacity: [1, 0.35, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
            <span className="text-[12px] font-semibold text-foreground/80">Client work</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-2 py-1">
            <Square className="h-2.5 w-2.5 text-destructive" fill="currentColor" />
            <span className="text-[10px] font-semibold text-destructive">Stop</span>
          </div>
        </div>
        <div className="font-mono text-[36px] font-bold tabular-nums tracking-tight text-foreground">
          {fmt(h)}:{fmt(m)}:{fmt(s)}
        </div>
      </div>

      {/* Earnings row */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5 text-primary/70" />
          <span className="text-[12px] text-secondary-fg/70">Earned at $80/h</span>
        </div>
        <motion.span
          key={earnings}
          initial={{ opacity: 0.6, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-[14px] font-display font-bold text-primary tabular-nums"
        >
          ${earnings}
        </motion.span>
      </div>

      {/* Export row */}
      <div className="px-4 pb-3">
        <div className="rounded-xl bg-primary/8 border border-primary/15 px-3 py-2 flex items-center gap-2">
          <FileDown className="h-3.5 w-3.5 text-primary/70 shrink-0" />
          <span className="text-[12px] text-foreground/75 flex-1">Ready to export as PDF invoice</span>
          <span className="text-[10px] text-primary font-semibold">Export</span>
        </div>
      </div>
    </div>
  );
}

function TrackShowcaseStep({ onContinue, disabled }: { onContinue: () => void; disabled: boolean }) {
  return (
    <div className="flex-1 flex flex-col fade-in">
      <div className="flex-1 flex flex-col">
        <p className="eyebrow">Track & bill</p>
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance">
          Hours that turn into invoices.
        </h1>
        <p className="text-secondary-fg mt-2 text-[14px] leading-snug max-w-sm">
          One tap starts the timer. Stop it and export a polished PDF your clients will pay.
        </p>

        <div className="mt-6">
          <TrackerMockup />
        </div>
      </div>

      <Button
        disabled={disabled}
        onClick={onContinue}
        className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-card mt-6"
      >
        Continue <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3 — AI personalisation                                       */
/* ------------------------------------------------------------------ */

function SetupStep({
  aiAbout,
  onAiAbout,
  onContinue,
  disabled,
}: {
  aiAbout: string;
  onAiAbout: (v: string) => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col fade-in">
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-center mb-6 mt-2">
          <motion.div
            className="h-14 w-14 rounded-[18px] flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--primary)/0.18) 0%, hsl(var(--primary)/0.08) 100%)", border: "1px solid hsl(var(--primary)/0.25)" }}
            animate={{ scale: [1, 1.06, 1], opacity: [0.85, 1, 0.85] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="h-6 w-6 text-primary" strokeWidth={1.6} />
          </motion.div>
        </div>

        <p className="eyebrow text-center">Personalise AI</p>
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance text-center">
          Tell AI about your day.
        </h1>
        <p className="text-secondary-fg mt-2 text-[14px] leading-snug text-center max-w-[280px] mx-auto">
          The more context it has, the better your plans will fit your real life.
        </p>

        <div className="mt-8">
          <Textarea
            value={aiAbout}
            onChange={(e) => onAiAbout(e.target.value)}
            placeholder="e.g. I work from home, walk the dog at 1 pm, prefer no hard tasks after 4 pm."
            maxLength={500}
            className="min-h-[120px] surface-card border-soft rounded-2xl text-[14px] resize-none leading-relaxed"
            autoFocus={false}
          />
          <p className="mt-2 text-[11px] text-secondary-fg/60 text-right">{aiAbout.length}/500</p>
        </div>

        <p className="mt-4 text-[12px] text-secondary-fg/50 text-center leading-relaxed">
          Sent privately with each plan · never stored beyond your session
        </p>
      </div>

      <Button
        disabled={disabled}
        onClick={onContinue}
        className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-card mt-6"
      >
        Continue <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4 — Paywall                                                  */
/* ------------------------------------------------------------------ */

const PAYWALL_HIGHLIGHTS = [
  { Icon: Zap, label: "Unlimited AI planning" },
  { Icon: FileDown, label: "Polished PDF reports" },
  { Icon: Compass, label: "Smart drift nudges" },
];

function PaywallStep({
  plan,
  onPlan,
  onCheckout,
  onSkip,
  onBack,
  busyCheckout,
  finishing,
}: {
  plan: "weekly" | "monthly" | "annual";
  onPlan: (p: "weekly" | "monthly" | "annual") => void;
  onCheckout: () => void;
  onSkip: () => void;
  onBack: () => void;
  busyCheckout: boolean;
  finishing: boolean;
}) {
  const busy = busyCheckout || finishing;

  return (
    <div className="flex-1 flex flex-col fade-in">
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="self-start -mt-2 mb-2 h-9 px-2 inline-flex items-center gap-1 rounded-full text-[13px] text-secondary-fg hover:text-foreground pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} /> Back
      </button>

      <div className="flex-1 flex flex-col">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full surface-accent border border-accent self-start">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="eyebrow text-primary">DayDraft Pro</span>
        </div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight mt-3 text-balance">
          Unlock the full DayDraft.
        </h1>

        {/* Compact 3-item highlight row — icons only + label, no body text */}
        <div className="mt-4 flex items-center gap-3">
          {PAYWALL_HIGHLIGHTS.map(({ Icon, label }) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1.5 rounded-2xl border border-accent bg-card/30 p-3 text-center">
              <div className="h-8 w-8 rounded-[10px] surface-accent border border-accent flex items-center justify-center">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <span className="text-[11px] font-medium text-foreground/80 leading-tight">{label}</span>
            </div>
          ))}
        </div>

        {/* Pricing cards */}
        <div className="flex flex-col gap-2.5 mt-5">
          <PlanCard
            active={plan === "annual"} onClick={() => onPlan("annual")}
            title="Annual" price="$59.99" sub="$4.99/mo · save 50%" badge="Best Value"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <PlanCard
              active={plan === "monthly"} onClick={() => onPlan("monthly")}
              title="Monthly" price="$9.99" sub="per month"
            />
            <PlanCard
              active={plan === "weekly"} onClick={() => onPlan("weekly")}
              title="Weekly" price="$3.99" sub="per week"
            />
          </div>
        </div>
      </div>

      {/* CTA area */}
      <div className="mt-5 flex flex-col gap-2.5">
        <Button
          onClick={onCheckout}
          disabled={busy}
          className="w-full h-[54px] rounded-[18px] bg-primary hover:bg-primary/92 text-primary-foreground text-[16px] font-semibold pressable shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.6)]"
        >
          {busyCheckout ? "Opening checkout…" : "Start with Pro"}
        </Button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="w-full h-[48px] rounded-[18px] border border-border/35 bg-transparent text-[14px] font-medium text-secondary-fg/80 hover:text-foreground hover:bg-foreground/[0.04] pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
        >
          Continue with Free
        </button>
        <p className="text-[11px] text-secondary-fg/55 text-center">
          Cancel anytime · No surprise add-ons
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared bits                                                        */
/* ------------------------------------------------------------------ */

function PlanCard({
  active,
  onClick,
  title,
  price,
  sub,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  price: string;
  sub: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "relative text-left rounded-[18px] border p-4 pressable transition-[border-color,background-color,box-shadow] duration-200 overflow-hidden",
        active
          ? "border-primary bg-primary/5 shadow-[0_0_24px_-6px_hsl(var(--primary)/0.2)]"
          : "border-soft surface-card hover:border-primary/30",
      ].join(" ")}
    >
      {badge && (
        <span className="absolute top-0 right-0 text-[10px] font-bold px-2.5 py-1 rounded-bl-[12px] bg-primary text-primary-foreground uppercase tracking-wider">
          {badge}
        </span>
      )}
      <div className={`text-[12px] font-medium uppercase tracking-wide ${active ? "text-primary" : "text-secondary-fg"}`}>{title}</div>
      <div className={`font-display text-[22px] font-bold tabular-nums mt-1 ${active ? "text-foreground" : "text-foreground/90"}`}>{price}</div>
      <div className={`text-[12px] mt-0.5 ${active ? "text-primary/80" : "text-secondary-fg/80"}`}>{sub}</div>
    </button>
  );
}
