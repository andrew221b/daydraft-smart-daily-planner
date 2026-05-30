import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import {
  ArrowRight,
  Sparkles,
  ChevronLeft,
  Square,
  FileDown,
  Wallet,
  Zap,
  Compass,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";

const PROGRESS_KEY = "dd_onboarding_progress_v6";
const STEPS = 3;
type StepIdx = 0 | 1 | 2;

type Progress = {
  step: StepIdx;
  aiAbout: string;
};

const readProgress = (): Progress => {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<Progress>;
    const validStep = ([0, 1, 2] as StepIdx[]).includes(p.step as StepIdx);
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
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px]" style={{ background: "var(--gradient-glow)" }} />

        <div className="relative z-10 flex-1 flex flex-col px-6 pt-[max(env(safe-area-inset-top),14px)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          {/* Nav bar */}
          <div className="flex items-center justify-between h-9 -mx-1 mb-4">
            {step === 1 ? (
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

            {step < 2 ? (
              <button
                type="button"
                onClick={() => goTo(2)}
                disabled={finishing}
                className="h-9 px-3 text-[13px] font-medium text-secondary-fg hover:text-foreground pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                Skip
              </button>
            ) : (
              <span className="h-9 w-9" />
            )}
          </div>

          {/* Progress bar — 3 segments */}
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
            {step === 0 && (
              <WelcomeSetupStep
                aiAbout={aiAbout}
                onAiAbout={setAiAbout}
                onContinue={() => goTo(1)}
                disabled={finishing}
              />
            )}
            {step === 1 && (
              <FeaturesShowcaseStep
                onContinue={() => goTo(2)}
                disabled={finishing}
              />
            )}
            {step === 2 && (
              <PaywallStep
                plan={plan}
                onPlan={setPlan}
                onCheckout={tryCheckout}
                onSkip={() => finish(false)}
                onBack={() => goTo(1)}
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

/* ================================================================ */
/*  SHARED PRIMITIVES                                                */
/* ================================================================ */

/** Orbital twinkling star that flies in from out of bounds, then orbits. */
function OrbitingStar({
  size = 4,
  radius = 60,
  startAngle = 0,
  duration = 14,
  delay = 0,
  hue = "primary",
  flyInOrigin = { x: -300, y: -200 },
}: {
  size?: number;
  radius?: number;
  startAngle?: number;
  duration?: number;
  delay?: number;
  hue?: "primary" | "indigo" | string;
  flyInOrigin?: { x: number; y: number };
}) {
  const color =
    hue === "primary"
      ? "hsl(var(--primary))"
      : hue === "indigo"
        ? "hsl(253 100% 65%)"
        : `hsl(${hue})`;

  const points = Array.from({ length: 9 }, (_, i) => {
    const t = ((startAngle + (i / 8) * 360) * Math.PI) / 180;
    return { x: Math.cos(t) * radius, y: Math.sin(t) * radius * 0.78 };
  });

  return (
    <motion.div
      className="absolute top-1/2 left-1/2 rounded-full z-20"
      style={{
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        background: color,
        boxShadow: `0 0 ${size * 2}px ${size * 0.5}px ${color}, 0 0 ${size * 4}px ${size}px ${color}55`,
      }}
      initial={{ x: flyInOrigin.x, y: flyInOrigin.y, opacity: 0, scale: 0 }}
      animate={{
        x: [flyInOrigin.x, points[0].x, ...points.map(p => p.x)],
        y: [flyInOrigin.y, points[0].y, ...points.map(p => p.y)],
        opacity: [0, 1, 0.55, 1, 0.7, 1, 0.55, 0.85, 0.5, 0.95, 0.55],
        scale: [0, 1.5, 0.85, 1.15, 0.95, 1.1, 0.85, 1.05, 0.8, 1.1, 0.85],
      }}
      transition={{
        // The first 2 keyframes (fly-in) take a specific fraction of the time,
        // then it loops smoothly
        duration: duration + 1.5,
        times: [0, 1.5 / (duration + 1.5), ...points.map((_, i) => (1.5 + (i / 8) * duration) / (duration + 1.5))],
        repeat: Infinity,
        ease: "easeInOut",
        delay,
      }}
    />
  );
}

/** 
 * AILogoStarry — A very premium AI icon replacing the old mascot.
 * Stars fly in from off-screen, settle into orbit, while the background
 * breathes with a dynamic glowing aura.
 */
function AILogoStarry() {
  const containerSize = 176;

  return (
    <div
      className="relative mx-auto"
      style={{ width: containerSize, height: containerSize }}
      aria-hidden
    >
      {/* Ambient background "breathing glow" */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle, hsl(var(--primary)/0.65) 0%, hsl(250 80% 55%/0.45) 50%, transparent 75%)" }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [1, 1.25, 1.05, 1.2, 1], opacity: [0, 0.65, 1, 0.75, 0.95, 0.65], rotate: [0, 45, -15, 35, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-4 rounded-full"
        style={{ background: "radial-gradient(circle, hsl(280 75% 62%/0.7) 0%, hsl(var(--primary)/0.4) 60%, transparent 80%)" }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [1.15, 0.95, 1.12, 0.98, 1.15], opacity: [0, 0.55, 0.95, 0.65, 0.9, 0.55], rotate: [0, -35, 20, -15, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
      />

      {/* The wow effect: stars flying in from the edges and orbiting */}
      <OrbitingStar size={7} radius={82} startAngle={0} duration={14} delay={0.2} hue="primary" flyInOrigin={{ x: -250, y: -200 }} />
      <OrbitingStar size={5} radius={70} startAngle={140} duration={11} delay={0.8} hue="indigo" flyInOrigin={{ x: 250, y: -150 }} />
      <OrbitingStar size={6} radius={88} startAngle={220} duration={17} delay={1.4} hue="primary" flyInOrigin={{ x: 180, y: 250 }} />
      <OrbitingStar size={4} radius={64} startAngle={310} duration={9} delay={0.5} hue="indigo" flyInOrigin={{ x: -200, y: 150 }} />
      <OrbitingStar size={3.5} radius={92} startAngle={80} duration={20} delay={1.1} hue="primary" flyInOrigin={{ x: 0, y: -250 }} />

      {/* Main AI Icon — A glassmorphism sphere with sparkles */}
      <motion.div
        className="absolute top-1/2 left-1/2 z-10 flex items-center justify-center rounded-full"
        style={{
          width: 72,
          height: 72,
          marginLeft: -36,
          marginTop: -36,
          background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(253 100% 60%) 100%)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25), inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -4px 8px rgba(0,0,0,0.2)",
        }}
        initial={{ scale: 0.5, opacity: 0, y: 20 }}
        animate={{
          scale: 1,
          opacity: 1,
          y: [0, -6, 0, 4, 0],
        }}
        transition={{ 
          scale: { type: "spring", stiffness: 200, damping: 20, delay: 0.1 },
          opacity: { duration: 0.4, delay: 0.1 },
          y: { duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.5 }
        }}
      >
        <Sparkles className="h-[34px] w-[34px] text-white" strokeWidth={1.5} />
      </motion.div>
    </div>
  );
}

/* ================================================================ */
/*  STEP 0 — Welcome + AI Setup (merged)                            */
/* ================================================================ */

/** Animates placeholder text for the textarea: types → pauses → erases → repeats. */
function useTypingPlaceholder(examples: string[], speed = 38) {
  const [display, setDisplay] = useState("");
  const idxRef = useRef(0);
  const dirRef = useRef<"typing" | "erasing">("typing");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const target = examples[idxRef.current];
      if (dirRef.current === "typing") {
        setDisplay((d) => {
          const next = target.slice(0, d.length + 1);
          if (next === target) {
            dirRef.current = "erasing";
            timer = setTimeout(tick, 1800);
          } else {
            timer = setTimeout(tick, speed);
          }
          return next;
        });
      } else {
        setDisplay((d) => {
          const next = d.slice(0, -1);
          if (next === "") {
            dirRef.current = "typing";
            idxRef.current = (idxRef.current + 1) % examples.length;
            timer = setTimeout(tick, 500);
          } else {
            timer = setTimeout(tick, speed * 0.55);
          }
          return next;
        });
      }
    };
    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [examples, speed]);

  return display;
}

const AI_EXAMPLES = [
  "e.g. I work from home, dog walk at 1 pm, no hard tasks after 4 pm.",
  "e.g. Freelance dev, most focused 9–12, gym on Mon/Wed/Fri.",
  "e.g. Student, mornings are best, part-time job 3–6 pm weekdays.",
];

function WelcomeSetupStep({
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
  const [focused, setFocused] = useState(false);
  const placeholder = useTypingPlaceholder(AI_EXAMPLES);
  const mood = focused && aiAbout.length > 0 ? "happy" : focused ? "thinking" : "neutral";

  return (
    <div className="flex-1 flex flex-col">
      {/* ── AI Logo + headline ─────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center">
        <AILogoStarry />

        <p className="eyebrow text-center mt-1">DayDraft</p>
        <h1 className="font-display text-[34px] font-semibold leading-[1.08] tracking-tight mt-3 text-balance text-center">
          Your day,<br />planned for you.
        </h1>
        <p className="text-secondary-fg mt-3 text-[15px] leading-[1.55] max-w-[19rem] mx-auto text-center text-balance">
          AI turns your goals into a realistic schedule. Track what shipped, and bill it.
        </p>

        {/* ── Divider ──────────────────────────────────── */}
        <div className="flex items-center gap-3 mt-7 mb-6">
          <div className="flex-1 h-px bg-border/40" />
          <span className="text-[11px] text-secondary-fg/55 font-medium flex items-center gap-1.5">
            <motion.span
              animate={{ rotate: [0, 20, -20, 0], scale: [1, 1.2, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 2 }}
              className="inline-block"
            >
              ✦
            </motion.span>
            Help AI plan better
          </span>
          <div className="flex-1 h-px bg-border/40" />
        </div>

        {/* ── AI context textarea ───────────────────────── */}
        <div className="relative">
          <Textarea
            value={aiAbout}
            onChange={(e) => onAiAbout(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder + (focused ? "" : "▋")}
            maxLength={500}
            rows={3}
            className="min-h-[88px] surface-card border-soft rounded-2xl text-[14px] resize-none leading-relaxed transition-[border-color,box-shadow] duration-200 focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
            autoFocus={false}
          />
          <p className="mt-1.5 text-[11px] text-secondary-fg/45 text-right">{aiAbout.length}/500</p>
        </div>

        <p className="mt-2 text-[11px] text-secondary-fg/45 text-center leading-relaxed">
          Sent privately with each plan · never stored beyond your profile
        </p>
      </div>

      <Button
        disabled={disabled}
        onClick={onContinue}
        className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-[0_12px_32px_-8px_hsl(var(--primary)/0.6)] mt-6"
      >
        Let's go <ArrowRight className="h-4 w-4 ml-1.5" />
      </Button>
    </div>
  );
}

/* ================================================================ */
/*  STEP 1 — Features: Plan · Track · Bill (merged)                 */
/* ================================================================ */

const PLAN_BLOCKS = [
  { time: "9:00", title: "Design review", typeVar: "--type-deep",    mins: 45 },
  { time: "10:00", title: "Client call",   typeVar: "--type-comm",    mins: 30 },
  { time: "10:45", title: "Deep work",     typeVar: "--type-deep",    mins: 90 },
] as const;

/** A real-app-styled block row, matching SortableBlock aesthetics perfectly. */
function MockBlock({
  time,
  title,
  typeVar,
  mins,
  delay,
  glow = false,
}: {
  time: string;
  title: string;
  typeVar: string;
  mins: number;
  delay: number;
  glow?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 320, damping: 26 }}
      className={[
        "group app-card rounded-[18px] px-3.5 py-3.5 shadow-sm border transition-[border-color,box-shadow,transform] duration-300",
        glow 
          ? "ring-[1.5px] ring-primary/40 bg-primary/[0.04] shadow-[0_0_32px_hsl(var(--primary)/0.12)] border-primary/20 scale-[1.02]" 
          : "bg-[linear-gradient(165deg,hsl(var(--type-deep)/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] border-[hsl(var(--type-deep)/.22)]"
      ].join(" ")}
      style={{
         ...(glow ? {} : {
            background: `linear-gradient(165deg, hsl(${typeVar} / .06) 0%, hsl(var(--surface) / .72) 58%, hsl(var(--surface-elevated) / .65) 100%)`,
            borderColor: `hsl(${typeVar} / .22)`
         })
      } as any}
    >
      <div className="flex items-start gap-2">
        {/* Invisible drag handle placeholder for exact padding match */}
        <div className="w-6 h-8 shrink-0 flex items-center justify-center text-secondary-fg/30" aria-hidden>
          {glow && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
        </div>

        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="shrink-0 h-6 px-1.5 inline-flex items-center justify-center text-secondary-fg/70 text-[10px] font-mono-sf tabular-nums">
            {time}
          </div>

          {/* Accent stripe */}
          <div className="w-[4px] h-8 rounded-full shrink-0" style={{ background: `hsl(var(${typeVar}))` }} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 leading-tight text-[14px] font-medium text-foreground">
              <span className="flex-1 min-w-0 truncate">{title}</span>
              {!glow && <Layers className="h-3 w-3 text-secondary-fg shrink-0" aria-hidden />}
              {glow && <Sparkles className="h-3 w-3 text-primary/70 shrink-0" aria-hidden />}
            </div>
            <div className="text-[11px] text-secondary-fg mt-[3px] tabular-nums leading-none">
              <span className="text-faint">{mins}m</span>
            </div>
            
            {glow && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success border border-success/25 px-2 py-0.5 text-[11px] font-medium leading-none"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Tracking now
              </motion.div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {glow ? (
              <button
                type="button"
                className="shrink-0 h-8 rounded-full bg-success/15 text-success border border-success/30 inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-medium"
              >
                <Square className="h-3 w-3" fill="currentColor" /> Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="relative h-8 w-8 rounded-full border-[1.5px] border-border/60 shrink-0 shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
                  aria-hidden
                />
                <div className="shrink-0 h-[18px] w-[18px] flex items-center justify-center text-secondary-fg/30 pointer-events-none">
                  <ChevronDown className="h-3 w-3" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Live ticking tracker card matching HomeTrackerHero. */
function LiveTrackerCard({ baseElapsed }: { baseElapsed: number }) {
  const [elapsed, setElapsed] = useState(baseElapsed);
  const RATE = 80;

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const totalSecs = elapsed;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  const earnings = ((totalSecs / 3600) * RATE).toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 1.2, type: "spring", stiffness: 280, damping: 26 }}
      className="relative overflow-hidden rounded-[28px] hero-glass border border-[color-mix(in_srgb,var(--hero-accent)_45%,hsl(var(--border)/0.5))] px-5 pt-6 pb-5 tracker-hero-clock shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)]"
      style={{ "--hero-accent": "hsl(var(--type-deep))" } as any}
    >
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/70">
            Recording
          </span>
          <span className="text-[12px] font-medium text-secondary-fg/80">
            All stats →
          </span>
        </div>

        {/* Hero timer */}
        <div className="mt-4 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.07] px-3 py-1 border border-border/30">
            <span
              className="h-1.5 w-1.5 rounded-full animate-pulse shadow-[0_0_0_3px_color-mix(in_srgb,var(--hero-accent)_22%,transparent)]"
              style={{ background: "hsl(var(--type-deep))" }}
            />
            <span className="text-[12px] font-medium text-foreground/85 truncate">
              Design review
            </span>
          </div>

          <div className="mt-3 breathe">
            <div className="font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground">
              {fmt(h)}:{fmt(m)}:{fmt(s)}
            </div>
          </div>
          
          <div
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/10 border border-success/20 px-3 py-1 tabular-nums"
          >
            <span className="text-[11px] font-medium text-success/65">earned</span>
            <span className="text-[14px] font-semibold text-success">${earnings}</span>
          </div>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-7 py-3 text-[14px] font-semibold shadow-[0_8px_22px_-12px_rgba(0,0,0,0.45)]">
            <Square className="h-3.5 w-3.5" fill="currentColor" />
            Stop
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Animated flowing dots connector between plan and tracker panels. */
function FlowConnector() {
  return (
    <motion.div 
      className="flex items-center justify-center gap-2 py-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.9, duration: 1 }}
    >
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="h-[5px] w-[5px] rounded-full"
            style={{ background: "hsl(var(--primary))" }}
            animate={{ y: [0, -5, 0], opacity: [0.25, 0.85, 0.25] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.22, ease: "easeInOut" }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function FeaturesShowcaseStep({
  onContinue,
  disabled,
}: {
  onContinue: () => void;
  disabled: boolean;
}) {
  // Cycle which block glows as "active"
  const [activeBlock, setActiveBlock] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setActiveBlock((i) => (i === 0 ? 1 : 0)); // Ping pong between 0 and 1 for demo
    }, 3200);
    return () => clearInterval(t);
  }, []);

  // 5432s ≈ 1h 30m 32s
  const BASE_ELAPSED = 5432;

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col">
        {/* ── Header copy ──────────────────────────────── */}
        <motion.p 
          className="eyebrow"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Plan · Track · Bill
        </motion.p>
        <motion.h1 
          className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          Everything your day needs, in one place.
        </motion.h1>

        {/* ── Showcase area ────────────────────────────── */}
        <div className="mt-6 flex-1 relative">
          
          <div className="space-y-3 relative z-10">
            {PLAN_BLOCKS.slice(0, 2).map((b, i) => (
              <MockBlock
                key={b.title}
                time={b.time}
                title={b.title}
                typeVar={b.typeVar}
                mins={b.mins}
                delay={0.2 + i * 0.25}
                glow={activeBlock === i}
              />
            ))}
          </div>

          <FlowConnector />

          <div className="relative z-20 -mt-1">
            <LiveTrackerCard baseElapsed={BASE_ELAPSED} />
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5, type: "spring" }}
      >
        <Button
          disabled={disabled}
          onClick={onContinue}
          className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-card mt-6"
        >
          Continue <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </motion.div>
    </div>
  );
}

/* ================================================================ */
/*  STEP 2 — Paywall (enhanced animations)                          */
/* ================================================================ */

const PAYWALL_HIGHLIGHTS = [
  { Icon: Zap,      label: "Unlimited AI planning" },
  { Icon: FileDown, label: "Polished PDF reports"  },
  { Icon: Compass,  label: "Smart drift nudges"    },
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
        {/* Badge + title */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, type: "spring", stiffness: 300, damping: 24 }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full surface-accent border border-accent self-start"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="eyebrow text-primary">DayDraft Pro</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 24 }}
          className="font-display text-[28px] font-semibold leading-tight tracking-tight mt-3 text-balance"
        >
          Unlock the full DayDraft.
        </motion.h1>

        {/* Feature highlight grid */}
        <div className="mt-4 flex items-center gap-3">
          {PAYWALL_HIGHLIGHTS.map(({ Icon, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.88, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 320, damping: 22 }}
              className="flex-1 flex flex-col items-center gap-1.5 rounded-2xl border border-accent bg-card/30 p-3 text-center"
            >
              <motion.div
                className="h-8 w-8 rounded-[10px] surface-accent border border-accent flex items-center justify-center"
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 2.5 + i * 0.7, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
              >
                <Icon className="h-4 w-4 text-primary" />
              </motion.div>
              <span className="text-[11px] font-medium text-foreground/80 leading-tight">{label}</span>
            </motion.div>
          ))}
        </div>

        {/* Pricing */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, type: "spring", stiffness: 280, damping: 26 }}
          className="flex flex-col gap-2.5 mt-5"
        >
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
        </motion.div>
      </div>

      {/* CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.48, type: "spring", stiffness: 280, damping: 26 }}
        className="mt-5 flex flex-col gap-2.5"
      >
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
        <p className="text-[11px] text-secondary-fg/50 text-center">
          Cancel anytime · No surprise add-ons
        </p>
      </motion.div>
    </div>
  );
}

/* ================================================================ */
/*  SHARED: Pricing card                                             */
/* ================================================================ */

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
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={[
        "relative text-left rounded-[18px] border p-4 transition-[border-color,background-color,box-shadow] duration-200 overflow-hidden w-full",
        active
          ? "border-primary bg-primary/5 shadow-[0_0_28px_-6px_hsl(var(--primary)/0.22)]"
          : "border-soft surface-card hover:border-primary/30",
      ].join(" ")}
    >
      {badge && (
        <span className="absolute top-0 right-0 text-[10px] font-bold px-2.5 py-1 rounded-bl-[12px] bg-primary text-primary-foreground uppercase tracking-wider">
          {badge}
        </span>
      )}
      <div className={`text-[12px] font-medium uppercase tracking-wide ${active ? "text-primary" : "text-secondary-fg"}`}>
        {title}
      </div>
      <div className={`font-display text-[22px] font-bold tabular-nums mt-1 ${active ? "text-foreground" : "text-foreground/90"}`}>
        {price}
      </div>
      <div className={`text-[12px] mt-0.5 ${active ? "text-primary/80" : "text-secondary-fg/80"}`}>
        {sub}
      </div>
    </motion.button>
  );
}
