import { useEffect, useMemo, useState, useRef, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DebouncedTextarea } from "@/components/ui/textarea";
import { useProfile, writeOnboardedFlag } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowRight,
  Sparkles,
  ChevronLeft,
  Square,
  Layers,
  ChevronDown,
  Lock,
  Clock,
  ListChecks,
  Check,
  GripVertical,
  Loader2,
} from "lucide-react";
import { AnimatePresence, motion, PresenceContext } from "framer-motion";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { PRO_FEATURES, PRO_PLANS, ProFeatureCard, ProPlanRow, PaywallTerms } from "@/components/app/proPaywall";
import { usePlanPrices } from "@/hooks/usePlanPrices";

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
  const { user } = useAuth();
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

      // Write the sticky localStorage flag BEFORE navigating. RequireAuth reads
      // this flag synchronously; without it the route guard sees onboarded=false
      // and instantly bounces the user back to /onboarding before the Supabase
      // update round-trip has a chance to complete.
      const uid = user?.id ?? profile?.id;
      if (uid) writeOnboardedFlag(uid);
      try { sessionStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      haptics.notify("success");
      nav("/home");

      if (profile) {
        update(payload as never).catch(() => { /* non-critical */ });
      } else {
        supabase.auth.getSession().then(({ data: { session } }) => {
          const uid = session?.user?.id;
          if (uid) {
            supabase.from("profiles")
              .upsert({ id: uid, ...payload } as never, { onConflict: "id" })
              .then(({ error }) => { if (!error) refresh().catch(() => {}); });
          }
        });
      }
    } catch (e: unknown) {
      console.error("Onboarding finish error:", e);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) writeOnboardedFlag(session.user.id);
        sessionStorage.removeItem(PROGRESS_KEY);
      } catch { /* ignore */ }
      
      haptics.notify("success");
      nav("/home");
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
        // Purchased — advance to the app.
        onSuccess: () => void finish(true),
        // Payments not available here — proceed as free.
        onUnavailable: () => { toast("Payments coming soon — you're set up for free."); void finish(false); },
        // Store error — stay on paywall so the user can retry.
        onError: () => toast.error("Purchase failed — please try again."),
        // Cancelled (no callback) — finally resets busy, user stays on paywall.
      });
    } finally {
      setBusyCheckout(false);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-background flex justify-center overflow-y-auto overscroll-y-contain no-scrollbar">
      <div className="relative w-full max-w-[440px] min-h-full flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px]" style={{ background: "var(--gradient-glow)" }} />

        <div 
          className="relative z-10 flex-1 flex flex-col px-6 pt-[max(env(safe-area-inset-top),14px)] transition-[padding-bottom] duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem + var(--keyboard-inset, 0px))' }}
        >
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

          <AnimatePresence mode="wait">
            <motion.div 
              className="flex-1 flex flex-col" 
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1, ease: "easeOut" }}
            >
              <PresenceContext.Provider value={null}>
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
              </PresenceContext.Provider>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ */
/*  SHARED PRIMITIVES                                                */
/* ================================================================ */

/**
 * AppAuraIcon — A professional, cinematic animation sequence.
 * 1. The icon starts monochrome and stationary.
 * 2. After 1-2 seconds, 80 sparks fly in from random edges at different speeds.
 * 3. When the sparks start hitting the center (around 2.5s), the icon lights up with color,
 *    and the fluid animated background expands in diameter.
 */
const SPARK_COUNT = 80;
const sparks = Array.from({ length: SPARK_COUNT }).map((_, i) => {
  const angle = Math.random() * 360;
  // Distribute particles far outside the container (edges of screen)
  const dist = 220 + Math.random() * 280; 
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad) * dist;
  const y = Math.sin(rad) * dist;
  
  // Wait 1 to 2.5 seconds before starting to fly in
  const delay = 1.0 + Math.random() * 2.5;
  // Flight duration from fast to slow (0.8s - 3.0s)
  const duration = 0.8 + Math.random() * 2.2;

  return { id: i, x, y, duration, delay };
});

function AppAuraIcon() {
  const containerSize = 176;
  const BURST_TIME = 2.4;
  // On light theme sparks and flash use the primary accent colour (blue);
  // on dark they keep the warm white glow.
  const isLight = typeof document !== "undefined" && document.documentElement.classList.contains("light");
  const sparkColor = isLight ? "hsl(var(--primary))" : "#fffce0";
  const sparkGlow = isLight
    ? "0 0 12px 3px hsl(var(--primary) / 0.65)"
    : "0 0 12px 3px rgba(255,252,224,0.9)";
  const flashColor = isLight ? "hsl(var(--primary) / 0.35)" : "#fffce0";
  const iconEndColor = isLight ? "hsl(var(--primary))" : "#fffce0";
  const iconGlow = isLight
    ? "drop-shadow-[0_0_12px_hsl(var(--primary)/0.5)]"
    : "drop-shadow-[0_0_12px_rgba(255,252,224,0.5)]";

  return (
    <div
      className="relative mx-auto flex items-center justify-center"
      style={{ width: containerSize, height: containerSize }}
      aria-hidden
    >
      {/* Sparks flying in to assemble the center */}
      {sparks.map((s) => (
        <motion.div
          key={s.id}
          className="absolute top-1/2 left-1/2 rounded-full z-20 pointer-events-none"
          style={{
            width: 3, height: 3,
            backgroundColor: sparkColor,
            boxShadow: sparkGlow,
            marginLeft: -1.5,
            marginTop: -1.5,
          }}
          initial={{ x: s.x, y: s.y, scale: 0, opacity: 0 }}
          animate={{ x: 0, y: 0, scale: [0, 1.5, 0], opacity: [0, 1, 0] }}
          transition={{ delay: s.delay, duration: s.duration, ease: "easeIn" }}
        />
      ))}

      {/* Central flash when sparks hit the center */}
      <motion.div
        className="absolute top-1/2 left-1/2 w-[140px] h-[140px] rounded-full z-30 pointer-events-none"
        style={{ marginLeft: -70, marginTop: -70, filter: "blur(24px)", backgroundColor: flashColor }}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 1, 0], scale: [0.5, 2, 2.5] }}
        transition={{ delay: BURST_TIME, duration: 1.2, ease: "easeOut" }}
      />

      {/* Ambient fluid aura - expands and fades in exactly when sparks hit */}
      <motion.div 
        className="absolute inset-0 flex items-center justify-center"
        initial={{ opacity: 0, scale: 0 }} 
        animate={{ opacity: 1, scale: 1 }} 
        transition={{ duration: 3.0, ease: "easeOut", delay: BURST_TIME }}
      >
        <div className="relative w-full h-full" style={{ filter: "blur(32px)" }}>
          <motion.div
            className="absolute top-[15%] left-[15%] w-[110px] h-[110px] rounded-full"
            style={{ background: "hsl(var(--primary))" }}
            animate={{ 
              scale: [1, 1.3, 1], 
              x: [0, 20, 0], 
              y: [0, -20, 0],
              opacity: [0.6, 0.9, 0.6]
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-[15%] right-[15%] w-[120px] h-[120px] rounded-full"
            style={{ background: "hsl(280, 100%, 65%)" }}
            animate={{ 
              scale: [1.2, 0.9, 1.2], 
              x: [0, -25, 0], 
              y: [0, 20, 0],
              opacity: [0.5, 0.8, 0.5]
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          />
          <motion.div
            className="absolute top-[25%] right-[25%] w-[90px] h-[90px] rounded-full"
            style={{ background: "hsl(200, 100%, 55%)" }}
            animate={{ 
              scale: [0.9, 1.4, 0.9], 
              x: [0, 15, 0], 
              y: [0, 15, 0],
              opacity: [0.4, 0.7, 0.4]
            }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          />
        </div>
      </motion.div>

      {/* Main Emblem — Static position, colorless at first, fades into color and background */}
      <motion.div
        className="relative z-10 flex items-center justify-center rounded-[32px] border border-white/20 dark:border-white/10"
        style={{
          width: 76,
          height: 76,
          boxShadow: "0 16px 40px -8px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.5)",
          background: "transparent",
        }}
        initial={{ 
          scale: 0, 
          opacity: 0,
        }}
        animate={{ 
          scale: 1, 
          opacity: 1,
        }}
        transition={{ 
          scale: { type: "spring", stiffness: 300, damping: 20, delay: 0.5 },
          opacity: { duration: 0.4, delay: 0.5 },
        }}
      >
        {/* The glassmorphic background gradient fades in when hit */}
        <motion.div 
          className="absolute inset-0 rounded-[32px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 2.0, delay: BURST_TIME }}
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)/0.2) 0%, transparent 100%)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        />
        <div className="absolute inset-0 rounded-[32px] overflow-hidden pointer-events-none">
           <div className="absolute -top-4 -right-4 w-16 h-16 bg-white/40 rounded-full blur-[16px]" />
        </div>
        
        {/* The icon starts monochrome (grey/white), then gains full color */}
        <motion.div
          className="relative z-10 flex items-center justify-center"
          initial={{ color: "hsl(var(--foreground) / 0.5)", filter: "grayscale(100%)" }}
          animate={{ color: iconEndColor, filter: "grayscale(0%)" }}
          transition={{ duration: 2.0, delay: BURST_TIME }}
        >
          <Sparkles className={`h-10 w-10 ${iconGlow}`} strokeWidth={1.5} />
        </motion.div>
      </motion.div>
    </div>
  );
}
// Removed SpiralOrb

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
        <AppAuraIcon />

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, type: "spring", stiffness: 300, damping: 24 }}
        >
          <p className="eyebrow text-center mt-3">DayDraft</p>
          <h1 className="font-display text-[34px] font-semibold leading-[1.08] tracking-tight mt-3 text-balance text-center">
            Your day,<br />planned for you.
          </h1>
          <p className="text-secondary-fg mt-3 text-[15px] leading-[1.55] max-w-[19rem] mx-auto text-center text-balance">
            AI turns your goals into a realistic schedule. Track what shipped, and bill it.
          </p>
        </motion.div>

        {/* ── Divider ──────────────────────────────────── */}
        <motion.div 
          className="flex items-center gap-3 mt-7 mb-6"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 1.4, duration: 0.6, ease: "easeOut" }}
        >
          <div className="flex-1 h-px bg-border/40 origin-right" />
          <span className="text-[11px] text-secondary-fg/55 font-medium flex items-center gap-1.5 shrink-0">
            <motion.span
              animate={{ rotate: [0, 20, -20, 0], scale: [1, 1.2, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 2 }}
              className="inline-block"
            >
              ✦
            </motion.span>
            Help AI plan better
          </span>
          <div className="flex-1 h-px bg-border/40 origin-left" />
        </motion.div>

        {/* ── AI context textarea ───────────────────────── */}
        <motion.div 
          className="relative"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, type: "spring", stiffness: 300, damping: 24 }}
        >
          <DebouncedTextarea
            value={aiAbout}
            onDebouncedChange={onAiAbout}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder + (focused ? "" : "▋")}
            maxLength={500}
            rows={3}
            className="min-h-[88px] surface-card border-soft rounded-2xl text-[14px] resize-none leading-relaxed transition-[border-color,box-shadow] duration-200 focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
            autoFocus={false}
          />
          <p className="mt-1.5 text-[11px] text-secondary-fg/45 text-right">{aiAbout.length}/500</p>
        </motion.div>

        <motion.p 
          className="mt-2 text-[11px] text-secondary-fg/45 text-center leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.7, duration: 0.6 }}
        >
          Sent privately with each plan · never stored beyond your profile
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.8, type: "spring", stiffness: 340, damping: 26 }}
      >
        <Button
          disabled={disabled}
          onClick={onContinue}
          className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-[0_12px_32px_-8px_hsl(var(--primary)/0.6)] mt-6"
        >
          Let's go <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </motion.div>
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
  from = "bottom",
}: {
  time: string;
  title: string;
  typeVar: string;
  mins: number;
  delay: number;
  glow?: boolean;
  /** Which edge the block slides in from */
  from?: "left" | "right" | "bottom";
}) {
  const initial =
    from === "left"  ? { opacity: 0, x: -90 } :
    from === "right" ? { opacity: 0, x:  90 } :
                       { opacity: 0, y:  64 };
  return (
    <motion.div
      initial={initial}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ delay, duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
      className={[
        // NOTE: `transform` is intentionally NOT in the CSS transition list —
        // framer-motion drives transform inline per-frame; a CSS transform
        // transition would re-interpolate every frame and smear the motion.
        // Also: solid (non-glass) background — animating a backdrop-filter is
        // the iOS WebKit jank cliff.
        "group app-card rounded-[18px] px-3.5 py-3.5 border transition-[border-color,box-shadow] duration-300 relative overflow-hidden",
        glow
          ? "ring-[1.5px] ring-primary/40 bg-primary/[0.04] shadow-[0_0_32px_hsl(var(--primary)/0.12)] border-primary/20"
          : "bg-card shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.2)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.05)]"
      ].join(" ")}
      style={glow ? {} : { borderColor: `hsl(${typeVar} / .3)` }}
    >
      {!glow && <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />}
      <div className="flex items-start gap-2 relative z-10">
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
                  className="relative h-8 w-8 rounded-full border-[1.5px] border-border/90 shrink-0 shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
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

function LiveTrackerCard({ baseElapsed, delay = 0.55 }: { baseElapsed: number, delay?: number }) {
  const [elapsed, setElapsed] = useState(baseElapsed);
  const [isSettled, setIsSettled] = useState(false);
  const RATE = 80;

  useEffect(() => {
    // Wait for the spring entrance animation to mostly finish before we
    // start ticking and running CSS animations, which ensures the layout
    // layer isn't fighting with the JS timer or CSS engine for frames.
    const timer = setTimeout(() => setIsSettled(true), (delay + 0.45) * 1000);
    return () => clearTimeout(timer);
  }, [delay]);

  useEffect(() => {
    if (!isSettled) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isSettled]);

  const totalSecs = elapsed;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  const earnings = ((totalSecs / 3600) * RATE).toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 72 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.46, ease: [0.16, 1, 0.3, 1] }}
      // During the slide-in keep it a plain solid card: `bd-none` kills the
      // blur(40px) backdrop-filter and the rotating conic sweep (tracker-hero-clock)
      // is held back — both re-paint every frame and would jank the entrance.
      // Once settled, swap to the full glass + sweep (cheap when static).
      className={`relative overflow-hidden rounded-[28px] hero-glass border border-[color-mix(in_srgb,var(--hero-accent)_45%,hsl(var(--border)/0.5))] px-5 pt-6 pb-5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)] ${isSettled ? "tracker-hero-clock" : "bd-none"}`}
      style={{ "--hero-accent": "hsl(var(--type-deep))" } as CSSProperties}
    >
      <div className="relative">
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: delay + 0.15, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center justify-between"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/70">
            Recording
          </span>
          <span className="text-[12px] font-medium text-secondary-fg/80">
            All stats →
          </span>
        </motion.div>

        {/* Hero timer */}
        <div className="mt-4 flex flex-col items-center text-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} 
            animate={{ opacity: 1, scale: 1 }} 
            transition={{ delay: delay + 0.25, type: "spring", stiffness: 260, damping: 28 }}
            className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.07] px-3 py-1 border border-border/60"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full shadow-[0_0_0_3px_color-mix(in_srgb,var(--hero-accent)_22%,transparent)] ${isSettled ? "animate-pulse" : ""}`}
              style={{ background: "hsl(var(--type-deep))" }}
            />
            <span className="text-[12px] font-medium text-foreground/85 truncate">
              Design review
            </span>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 15 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: delay + 0.38, type: "spring", stiffness: 220, damping: 26 }}
            className={`mt-3 ${isSettled ? "breathe" : ""}`}
          >
            <div className="font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground">
              {fmt(h)}:{fmt(m)}:{fmt(s)}
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: delay + 0.52, type: "spring", stiffness: 260, damping: 26 }}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/10 border border-success/20 px-3 py-1 tabular-nums"
          >
            <span className="text-[11px] font-medium text-success/65">earned</span>
            <span className="text-[14px] font-semibold text-success">${earnings}</span>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: delay + 0.65, type: "spring", stiffness: 260, damping: 26 }}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-7 py-3 text-[14px] font-semibold shadow-[0_8px_22px_-12px_rgba(0,0,0,0.45)]"
          >
            <Square className="h-3.5 w-3.5" fill="currentColor" />
            Stop
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}


/* ── Plan-mode switcher demo (Timeline ⇄ Checklist) ─────────────────
   A faithful, non-interactive replica of the in-app PlanModePill plus a
   morph stage: the timeline cards cross-dissolve into a live checklist whose
   items self-tick. Teaches the real switcher gesture during onboarding. */

/** Replica of DayView's PlanModePill, driven by a `mode` prop (no taps). The
 *  thumb springs across and its colour snaps primary→accent, exactly like the
 *  real control. */
function PlanModeDemoPill({ mode }: { mode: "timeline" | "checklist" }) {
  return (
    <div className="relative h-11 rounded-2xl bg-muted/40 border border-soft p-1 select-none">
      <motion.div
        className="absolute top-1 bottom-1 left-1 rounded-xl shadow-sm"
        style={{
          width: "calc(50% - 4px)",
          background: mode === "checklist" ? "hsl(var(--checklist-accent))" : "hsl(var(--primary))",
        }}
        animate={{ x: mode === "timeline" ? "0%" : "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      />
      <div className="relative grid grid-cols-2 h-full">
        <div className={`relative z-10 flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-xl transition-colors duration-300 ${mode === "timeline" ? "text-primary-foreground" : "text-secondary-fg/70"}`}>
          <Clock className="h-4 w-4" /> Timeline
        </div>
        <div className={`relative z-10 flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-xl transition-colors duration-300 ${mode === "checklist" ? "text-white" : "text-secondary-fg/70"}`}>
          <ListChecks className="h-4 w-4" /> Checklist
        </div>
      </div>
    </div>
  );
}

/** One checklist row: grip · title · circular checkbox. When `done` flips the
 *  accent fill springs in behind a popping check and the title strikes through —
 *  the same satisfying beat as a real tap. */
function ChecklistDemoRow({ title, done }: { title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <GripVertical className="h-3.5 w-3.5 text-secondary-fg/35 shrink-0" aria-hidden />
      <span className={`flex-1 min-w-0 text-[14px] truncate transition-colors duration-300 ${done ? "line-through text-foreground/40" : "text-foreground"}`}>
        {title}
      </span>
      <div className="relative h-[22px] w-[22px] shrink-0">
        <div className={`absolute inset-0 rounded-full border-[1.5px] transition-all duration-200 ${done ? "border-transparent scale-90" : "border-secondary-fg/35"}`} />
        <motion.div
          className="accent-grad accent-glow absolute inset-0 rounded-full flex items-center justify-center"
          initial={false}
          animate={{ scale: done ? 1 : 0.4, opacity: done ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 26 }}
        >
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </motion.div>
      </div>
    </div>
  );
}

const CHECKLIST_DEMO_ITEMS = [
  { id: 1, title: "Buy groceries", doneAt: 650 },
  { id: 2, title: "Email the client", doneAt: 1450 },
  { id: 3, title: "Book dentist", doneAt: null as number | null },
] as const;

/** Accent-themed checklist card. Mounts only when the switcher lands on
 *  Checklist, so its items start self-ticking on mount; the n/total counter and
 *  progress (a GPU `scaleX`, never an animated `width`) climb alongside. */
function ChecklistDemoCard() {
  const total = CHECKLIST_DEMO_ITEMS.length;
  const [done, setDone] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const timers = CHECKLIST_DEMO_ITEMS
      .filter((i) => i.doneAt != null)
      .map((i) => setTimeout(() => {
        setDone((prev) => { const n = new Set(prev); n.add(i.id); return n; });
      }, i.doneAt as number));
    return () => timers.forEach(clearTimeout);
  }, []);

  const doneCount = done.size;

  return (
    <div className="checklist-theme relative app-card checklist-surface rounded-[18px] px-3.5 py-3">
      <div className="relative z-10">
        {/* Header — accent chip · list name · live counter */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="accent-grad accent-glow flex h-[22px] w-[22px] items-center justify-center rounded-[7px]" aria-hidden>
              <ListChecks className="h-3 w-3 text-white" strokeWidth={2.75} />
            </span>
            <span className="text-[14px] font-semibold text-foreground">Errands</span>
          </div>
          <span className="text-[12px] font-semibold tabular-nums" style={{ color: "hsl(var(--accent))" }}>
            {doneCount}/{total}
          </span>
        </div>
        {/* Progress — GPU transform (scaleX), no layout-thrashing width animation */}
        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden mb-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]">
          <motion.div
            className="accent-grad-h h-full w-full rounded-full origin-left"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: doneCount / total }}
            transition={{ type: "spring", stiffness: 200, damping: 30 }}
          />
        </div>
        <div className="divide-y divide-border/25">
          {CHECKLIST_DEMO_ITEMS.map((it) => (
            <ChecklistDemoRow key={it.id} title={it.title} done={done.has(it.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Orchestrates the morph: pill + timeline cards land, then after `switchAt`
 *  the pill flips to Checklist and the layers cross-dissolve.
 *  Perf notes: AnimatePresence keeps only ONE layer mounted once the fade ends
 *  (two shadowed-card layers composited at once is what stuttered); motion is
 *  opacity + translateY only — no `scale` (repaints the card shadow every frame)
 *  and no blur (the iOS WebKit jank cliff). */
function PlanShowcase({ switchAt = 4.0 }: { switchAt?: number }) {
  const [mode, setMode] = useState<"timeline" | "checklist">("timeline");
  useEffect(() => {
    // Defer the countdown to after the first paint so the timer budget isn't
    // consumed by JS mount time (on slow devices mount can take 300-700ms,
    // which would silently eat most of a short switchAt).
    let t: ReturnType<typeof setTimeout>;
    const frame = requestAnimationFrame(() => {
      t = setTimeout(() => setMode("checklist"), switchAt * 1000);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(t); };
  }, [switchAt]);

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <PlanModeDemoPill mode={mode} />
      </motion.div>

      {/* Fixed-height stage so the tracker below never jumps as layers swap. */}
      <div className="relative mt-3.5 h-[164px]">
        <AnimatePresence>
          {mode === "timeline" ? (
            <motion.div
              key="timeline"
              className="absolute inset-x-0 top-0 space-y-3"
              style={{ pointerEvents: "none" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <MockBlock
                time={PLAN_BLOCKS[0].time} title={PLAN_BLOCKS[0].title}
                typeVar={PLAN_BLOCKS[0].typeVar} mins={PLAN_BLOCKS[0].mins}
                delay={0.35} glow={false} from="left"
              />
              <MockBlock
                time={PLAN_BLOCKS[1].time} title={PLAN_BLOCKS[1].title}
                typeVar={PLAN_BLOCKS[1].typeVar} mins={PLAN_BLOCKS[1].mins}
                delay={0.6} glow={false} from="right"
              />
            </motion.div>
          ) : (
            <motion.div
              key="checklist"
              className="absolute inset-x-0 top-0"
              style={{ pointerEvents: "none" }}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <ChecklistDemoCard />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FeaturesShowcaseStep({
  onContinue,
  disabled,
}: {
  onContinue: () => void;
  disabled: boolean;
}) {
  const BASE_ELAPSED = 5432;

  // Top-to-bottom choreography: the pill + timeline cards land first,
  // the tracker rises just after, then the switcher flips to Checklist.
  const T_TIMER  = 0.95;
  const T_BUTTON = 1.25;
  const T_SWITCH = 4.0; // seconds before morph

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col">
        {/* ── Header copy ──────────────────────────────── */}
        <motion.p
          className="eyebrow"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          Plan · Track · Bill
        </motion.p>
        <motion.h1
          className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          Everything your day needs, in one place.
        </motion.h1>

        {/* ── Showcase area ────────────────────────────── */}
        <div className="mt-6 flex-1 relative overflow-x-hidden px-0.5 pb-2">
          {/* Plan demo — timeline cards that morph into a live checklist via
              the real PlanModePill switcher. */}
          <div className="relative z-10">
            <PlanShowcase switchAt={T_SWITCH} />
          </div>

          {/* Timer — rises from below after the plan demo has landed */}
          <div className="mt-4 relative z-20">
            <LiveTrackerCard baseElapsed={BASE_ELAPSED} delay={T_TIMER} />
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: T_BUTTON, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
/*  STEP 2 — Paywall (shared design with the in-app UpgradeSheet)    */
/* ================================================================ */

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
  const [restoring, setRestoring] = useState(false);
  const prices = usePlanPrices();
  const restore = async () => {
    setRestoring(true);
    try {
      const { restorePurchases } = await import("@/lib/revenueCat");
      const { ok, isPro } = await restorePurchases();
      if (!ok) { toast("Restore isn't available here."); return; }
      toast[isPro ? "success" : "message"](isPro ? "Purchases restored — Pro is active." : "No previous purchases found.");
    } finally {
      setRestoring(false);
    }
  };
  const ctaLabel = busyCheckout
    ? "Opening checkout…"
    : plan === "annual"
      ? "Start 7-day free trial"
      : "Continue with Pro";

  return (
    <div className="flex-1 flex flex-col">
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="self-start -mt-2 mb-1 h-9 px-2 inline-flex items-center gap-1 rounded-full text-[13px] text-secondary-fg hover:text-foreground pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} /> Back
      </button>

      {/* One cohesive entrance — the whole panel fades + rises once on mount.
          Nothing animates afterwards (cards are static via animate={false}). */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 flex flex-col"
      >
        {/* Hero */}
        <div className="relative pt-2 pb-4 text-center flex flex-col items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{ background: "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.09) 0%, transparent 80%)" }}
          />
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.07] px-3 py-1 mb-3.5 relative z-10">
            <Lock className="h-2.5 w-2.5 text-primary" strokeWidth={2.5} />
            <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-primary">DayDraft Pro</span>
          </div>
          <h1 className="font-semibold text-[22px] leading-[1.2] tracking-tight text-foreground relative z-10 whitespace-nowrap">
            Unlock the full DayDraft.
          </h1>
        </div>

        {/* Feature cards */}
        <div className="flex flex-col gap-1.5 w-full">
          {PRO_FEATURES.map((feat) => (
            <ProFeatureCard key={feat.id} feat={feat} animate={false} />
          ))}
        </div>

        {/* Plan rows */}
        <div className="flex flex-col gap-1.5 w-full mt-4">
          {PRO_PLANS.map((p) => (
            <ProPlanRow
              key={p.id}
              plan={p}
              active={plan === p.id}
              priceInfo={prices[p.id]}
              onClick={() => { haptics.selection(); onPlan(p.id); }}
            />
          ))}
        </div>

        {/* CTAs */}
        <div className="mt-4 flex flex-col gap-2.5">
          <Button
            onClick={onCheckout}
            disabled={busy}
            className="w-full h-[54px] rounded-[18px] bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-semibold pressable"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {ctaLabel}
          </Button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="w-full h-[46px] rounded-[18px] text-[14px] font-medium text-secondary-fg/70 hover:text-foreground pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            Continue with Free
          </button>
          <button
            type="button"
            onClick={restore}
            disabled={busy || restoring}
            className="w-full text-center text-[12px] text-secondary-fg/55 hover:text-foreground pressable disabled:opacity-50 transition-colors"
          >
            {restoring ? "Restoring…" : "Restore purchases"}
          </button>
          <PaywallTerms planId={plan} priceInfo={prices[plan]} />
        </div>
      </motion.div>
    </div>
  );
}
