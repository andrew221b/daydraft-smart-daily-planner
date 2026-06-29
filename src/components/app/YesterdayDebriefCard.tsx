import { memo, useEffect, useMemo, useState } from "react";
import {
  Sparkles, Lock, History, Flame, Quote,
  HelpCircle, CheckSquare, Zap, ChevronDown, TrendingUp,
  Eye, Check, X, Lightbulb,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invokeAiCached, invalidateAiCache } from "@/lib/aiCache";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { useDayKey } from "@/hooks/useDayKey";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useAuth } from "@/hooks/useAuth";
import { useTabVisible } from "@/components/app/PersistentTabs";
import { haptics } from "@/lib/haptics";
import { todayDateStr } from "@/lib/daydraft";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

/* ── Per-mode visual identity ──────────────────────────────────────────────
   Each daily mode gets its own accent + icon + framing so a riddle reads as a
   riddle, a challenge as a challenge — no more flat "info soup" where every
   mode looks identical. Accents are raw HSL triplets (matches the codebase
   convention of inlining `hsl(${triplet})`). Only one mode shows per day, so
   the palette is about mood, not side-by-side contrast. */
type Mode = "recap" | "riddle" | "quiz" | "challenge";
type ModeTheme = {
  accent: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  label: string;
  kicker: string;
};
const MODE_THEME: Record<Mode, ModeTheme> = {
  recap:     { accent: "211 100% 50%", icon: Sparkles,   label: "Insights",          kicker: "Yesterday, reviewed" },
  riddle:    { accent: "258 90% 66%",  icon: HelpCircle,  label: "Today's Riddle",    kicker: "Think it through" },
  quiz:      { accent: "190 95% 45%",  icon: CheckSquare, label: "Quick Quiz",        kicker: "Test yourself" },
  challenge: { accent: "28 96% 56%",   icon: Zap,         label: "Today's Challenge", kicker: "A small twist" },
};

type QuizQuestion = {
  q: string;
  options: string[];
  correct: number;
  explanation?: string;
};

type InsightsResponse = {
  show?: boolean;
  date?: string;
  title?: string;
  mode?: "recap" | "riddle" | "quiz" | "challenge";
  // recap
  yesterday?: string[];
  today_tip?: string;
  spark?: string;
  bullets?: string[];
  // riddle
  riddle?: string;
  riddle_answer?: string;
  fun_fact?: string;
  // quiz
  quiz?: QuizQuestion[];
  // challenge
  challenge?: string;
  challenge_context?: string;
  // all modes
  phrase_of_day?: string;
  week_stat?: string;
};

const FREE_LIMIT = 3;
const SEEN_DATES_KEY = "dd_debrief_seen_dates";
// The "what will the AI cook up today?" teaser is held for at least this long
// the FIRST time the card loads each day, so the reveal is a deliberate moment
// instead of a single-frame flash when the insight is already cached.
const TEASER_SHOWN_KEY = "dd_insights_teaser_date";
const MIN_TEASER_MS = 1600;

const todayYmd = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function readSeenDates(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_DATES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function recordSeenDate(yesterday: string): void {
  try {
    const seen = readSeenDates();
    if (seen.includes(yesterday)) return;
    seen.push(yesterday);
    localStorage.setItem(SEEN_DATES_KEY, JSON.stringify(seen.slice(-90)));
  } catch { /* ignore */ }
}

function teaserShownToday(): boolean {
  try { return localStorage.getItem(TEASER_SHOWN_KEY) === todayYmd(); } catch { return false; }
}

function markTeaserShown(): void {
  try { localStorage.setItem(TEASER_SHOWN_KEY, todayYmd()); } catch { /* ignore */ }
}

// ── Frozen daily insight ─────────────────────────────────────────────────────
// Once a usable insight is shown for the day it is FROZEN verbatim and reused
// until the next day — across remounts, app resumes, entitlement re-reads, or an
// AI-cache invalidation. This is what stops the riddle/quiz being silently
// regenerated when you navigate back to Home, which would wipe the answers the
// user already gave (they're keyed to that exact content). The freeze slot is
// keyed by day + user + tz + any dev override, so a new day / account / dev
// refresh still pulls fresh content; only USABLE insights are ever frozen, so a
// data-less "show:false" hiccup still retries on the next foreground.
const FROZEN_KEY = "dd_insights_frozen";
function readFrozenInsight(key: string): InsightsResponse | null {
  try {
    const raw = localStorage.getItem(FROZEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: string; data?: InsightsResponse };
    return parsed?.key === key && parsed.data ? parsed.data : null;
  } catch { return null; }
}
function writeFrozenInsight(key: string, data: InsightsResponse): void {
  try { localStorage.setItem(FROZEN_KEY, JSON.stringify({ key, data })); } catch { /* ignore */ }
}

// ── Mode sub-components ──────────────────────────────────────────────────────

/**
 * Spoiler reveal — the shared "tap to see the answer" surface used by riddles
 * and challenges. Before tap: the answer sits behind a soft blur (a redacted
 * spoiler, the iMessage hidden-text feel) under an accent prompt. On tap it
 * un-blurs and crisps into a labelled answer panel. One tactile, premium
 * gesture instead of a flat grey button.
 */
function SpoilerReveal({ accent, label, value, hint, hintLabel }: {
  accent: string;
  label: string;
  value: string;
  hint?: string;
  /** Eyebrow for the explanation that appears under the revealed answer. */
  hintLabel?: string;
}) {
  const today = todayDateStr();
  const cacheKey = `dd_insights_spoiler:${today}:${label}`;

  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(cacheKey);
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(open));
    } catch {
      // Ignore storage errors
    }
  }, [open, cacheKey]);
  return (
    <div className="mt-3.5">
      <button
        type="button"
        disabled={open}
        onClick={() => { if (!open) { setOpen(true); haptics.selection(); } }}
        aria-label={open ? undefined : `Reveal ${label.toLowerCase()}`}
        className="relative block w-full overflow-hidden rounded-2xl text-left transition-all duration-300 active:scale-[0.985]"
        style={{
          border: `1px solid hsl(${accent} / ${open ? 0.3 : 0.18})`,
          background: open
            ? `linear-gradient(135deg, hsl(${accent} / 0.15) 0%, hsl(${accent} / 0.04) 100%)`
            : `hsl(${accent} / 0.05)`,
        }}
      >
        <div className="px-4 py-3">
          <span
            className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.18em]"
            style={{ color: `hsl(${accent})` }}
          >
            {label}
          </span>
          <div className="relative">
            <p
              className="text-[14px] font-semibold leading-snug text-foreground/95 transition-all duration-500"
              style={{ filter: open ? "blur(0px)" : "blur(7px)", opacity: open ? 1 : 0.45 }}
            >
              {value}
            </p>
            {!open && (
              <span
                className="absolute inset-0 flex items-center justify-center gap-1.5 text-[12.5px] font-semibold"
                style={{ color: `hsl(${accent})` }}
              >
                <Eye className="h-4 w-4" strokeWidth={2.2} />
                Tap to reveal
              </span>
            )}
          </div>
        </div>
      </button>
      <AnimatePresence>
        {open && hint && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3">
              <span
                className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.16em]"
                style={{ color: `hsl(${accent} / 0.85)` }}
              >
                {hintLabel || "Here's why"}
              </span>
              <p className="text-[12.5px] leading-relaxed text-secondary-fg/80">{hint}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RiddleSection({ accent, riddle, riddleAnswer, funFact }: {
  accent: string;
  riddle: string;
  riddleAnswer: string;
  funFact?: string;
}) {
  return (
    <div>
      <p className="text-[15px] font-medium italic leading-relaxed text-foreground/95">{riddle}</p>
      <SpoilerReveal accent={accent} label="Answer" value={riddleAnswer} hint={funFact} />
    </div>
  );
}

function QuizSection({ accent, questions }: { accent: string; questions: QuizQuestion[] }) {
  const today = todayDateStr();
  const cacheKey = `dd_insights_quiz:${today}`;

  const [answers, setAnswers] = useState<Record<number, number>>(() => {
    try {
      const stored = localStorage.getItem(cacheKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(answers));
    } catch {
      // Ignore storage errors
    }
  }, [answers, cacheKey]);

  const allAnswered = questions.length > 0 && Object.keys(answers).length === questions.length;
  const score = questions.reduce((acc, q, i) => acc + (answers[i] === Math.max(0, Math.min(q.correct, q.options.length - 1)) ? 1 : 0), 0);

  return (
    <div className="space-y-3">
      {questions.map((q, qi) => {
        const isAnswered = answers[qi] !== undefined;
        const clampedCorrect = Math.max(0, Math.min(q.correct, q.options.length - 1));
        return (
          <div
            key={qi}
            className="rounded-2xl p-3"
            style={{ background: "hsl(var(--foreground) / 0.03)", border: "1px solid hsl(var(--border) / 0.3)" }}
          >
            <div className="mb-2.5 flex items-start gap-2">
              <span
                className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
                style={{ background: `hsl(${accent} / 0.16)`, color: `hsl(${accent})` }}
              >
                {qi + 1}
              </span>
              <p className="text-[13.5px] font-semibold leading-snug text-foreground/95">{q.q}</p>
            </div>
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => {
                const isCorrectOpt = oi === clampedCorrect;
                const isSelected = answers[qi] === oi;
                const showCorrect = isAnswered && isCorrectOpt;
                const showWrong = isAnswered && isSelected && !isCorrectOpt;
                const showDim = isAnswered && !isCorrectOpt && !isSelected;
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => {
                      setAnswers((prev) => ({ ...prev, [qi]: oi }));
                      if (oi === clampedCorrect) haptics.notify("success");
                      else haptics.impact("light");
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] transition-all duration-150 ${
                      showCorrect
                        ? "bg-success/[0.15] text-success border-success/40"
                        : showWrong
                          ? "bg-destructive/[0.12] text-destructive/90 border-destructive/[0.28]"
                          : showDim
                            ? "bg-foreground/[0.02] text-foreground/40 border-transparent"
                            : "bg-foreground/[0.06] text-foreground/85 border-transparent active:scale-[0.99]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">{opt}</span>
                    {showCorrect && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} />}
                    {showWrong && <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} />}
                  </button>
                );
              })}
            </div>
            {isAnswered && q.explanation && (
              <p className="mt-2.5 text-[12px] leading-relaxed text-secondary-fg/70">{q.explanation}</p>
            )}
          </div>
        );
      })}
      {allAnswered && (
        <div
          className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12.5px] font-semibold"
          style={{ background: `hsl(${accent} / 0.1)`, border: `1px solid hsl(${accent} / 0.22)`, color: `hsl(${accent})` }}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
          {score === questions.length
            ? "Perfect score"
            : score > 0
              ? `${score}/${questions.length} — solid`
              : `0/${questions.length} — now you know`}
        </div>
      )}
    </div>
  );
}

function ChallengeSection({ accent, challenge, context }: { accent: string; challenge: string; context?: string }) {
  return (
    <div>
      <p className="text-[15.5px] font-semibold leading-snug text-foreground">{challenge}</p>
      {context && <SpoilerReveal accent={accent} label="Result" value={context} />}
    </div>
  );
}

/**
 * Fact of the day — given its own framed panel instead of being crammed under a
 * hairline. A distinct, quiet "did you know" surface tinted to the mode accent.
 */
function FactOfDay({ accent, phrase }: { accent: string; phrase: string }) {
  return (
    <div
      className="mt-4 rounded-2xl p-3.5"
      style={{
        background: `linear-gradient(135deg, hsl(${accent} / 0.08) 0%, transparent 72%)`,
        border: `1px solid hsl(${accent} / 0.16)`,
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Lightbulb className="h-3 w-3" style={{ color: `hsl(${accent})` }} strokeWidth={2.4} />
        <span className="text-[9.5px] font-bold uppercase tracking-[0.18em]" style={{ color: `hsl(${accent})` }}>
          Fact of the day
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-foreground/85">{phrase}</p>
    </div>
  );
}

function WeekStatLine({ stat }: { stat: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <TrendingUp className="h-[11px] w-[11px] text-secondary-fg/40 shrink-0" strokeWidth={2} />
      <p className="text-[11.5px] text-secondary-fg/60 leading-snug">{stat}</p>
    </div>
  );
}

// ── Loading teaser (lives in the header so it's visible while collapsed) ──────

const MYSTERY_LINES = [
  "A riddle to crack?",
  "A quiz to ace?",
  "A challenge to conquer?",
  "A fact to blow your mind?",
  "Something you didn't see coming?",
];

/**
 * The "what's the AI cooking up today?" teaser. It renders inline as the card's
 * kicker (subtitle) — the header is the only thing visible while the card is
 * collapsed (its default), so the intrigue belongs there, not in a hidden body.
 * Cycles the teasing lines with a soft fade + a trio of bouncing dots.
 */
function TeaserKicker() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const cycle = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % MYSTERY_LINES.length);
        setVisible(true);
      }, 260);
    }, 1700);
    return () => clearInterval(cycle);
  }, []);

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className="inline-flex gap-[3px]">
        {[0, 160, 320].map((d) => (
          <span
            key={d}
            className="h-1 w-1 rounded-full bg-primary/60 animate-bounce"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </span>
      <AnimatePresence mode="wait">
        {visible && (
          <motion.span
            key={idx}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.22 }}
            className="inline-block"
          >
            {MYSTERY_LINES[idx]}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function InsightsShell({
  children,
  accent = "211 100% 50%",
  icon: Icon = Sparkles,
  eyebrow: eyebrowLabel = "Insights",
  kicker,
  collapsed,
  onToggle,
}: {
  children: React.ReactNode;
  accent?: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  eyebrow?: string;
  kicker?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative app-card overflow-hidden">
      {/* Accent hairline + soft top-corner glow give each mode its own light. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent 0%, hsl(${accent} / 0.6) 50%, transparent 100%)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -left-8 -top-10 h-32 w-32 rounded-full"
        style={{ background: `radial-gradient(circle, hsl(${accent} / 0.13) 0%, transparent 70%)` }}
      />

      {/* Always-visible tappable header — a confident feature title, not a chip. */}
      <button
        type="button"
        onClick={onToggle}
        className="relative flex w-full items-center gap-3 px-4 pt-3.5 pb-3 pressable"
        aria-expanded={!collapsed}
      >
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
          style={{
            background: `linear-gradient(135deg, hsl(${accent} / 0.95) 0%, hsl(${accent} / 0.62) 100%)`,
            boxShadow: `0 4px 12px -2px hsl(${accent} / 0.5), inset 0 1px 0 rgba(255,255,255,0.28)`,
          }}
        >
          <Icon className="h-[18px] w-[18px] text-white" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[13px] font-bold leading-tight tracking-tight text-foreground font-display">
            {eyebrowLabel}
          </span>
          {kicker && (
            <span className="mt-0.5 block text-[11px] leading-tight text-secondary-fg/60">{kicker}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-secondary-fg/50 transition-transform duration-300 ${collapsed ? "" : "rotate-180"}`}
          strokeWidth={2}
        />
      </button>

      {/* Collapsible content */}
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────



function InsightsCardInner({ timezone }: { timezone?: string | null }) {
  const { user } = useAuth();
  const userId = user?.id;
  const { isPro, loading: entLoading } = useEntitlement();
  const getSignal = useAbortOnUnmount();
  const [data, setData] = useState<InsightsResponse | null>(null);
  // true = fetching (or initial). Used to show a loading placeholder
  // instead of stale content while the edge fn responds on a new day.
  const [fetching, setFetching] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Re-fetch when the local day rolls over. Default (non-live) so a fresh
  // insight only swaps in on the next foreground after midnight — never yanked
  // out from under someone reading it at 00:00.
  const dayKey = useDayKey();

  // Invalidate cache when user changes (account switch)
  useEffect(() => {
    invalidateAiCache("yesterday-debrief");
  }, [userId]);

  const toggleCollapsed = () => {
    setCollapsed((c) => !c);
  };

  // Reset to collapsed whenever the user leaves the Track tab (or drills into
  // Focus). The tab stays mounted in PersistentTabs, so without this an
  // expanded card would still be open on return — the user wants Insights to
  // always start closed and only open on an explicit tap.
  const tabVisible = useTabVisible();
  useEffect(() => {
    if (!tabVisible) setCollapsed(true);
  }, [tabVisible]);



  useEffect(() => {
    let alive = true;
    let teaserTimer: ReturnType<typeof setTimeout> | null = null;
    const signal = getSignal();
    // Insights are a Pro feature. Free users never fetch (saves the AI call) and
    // fall through to the locked upsell teaser. Wait out the entitlement load so
    // a Pro user doesn't briefly see the lock on a cold start.
    if (entLoading) return;
    if (!isPro) { setFetching(false); return; }
    // Show loading placeholder immediately (hides stale content from previous day).
    setFetching(true);
    // First load of the day → deliberately linger on the teaser so the "what's
    // the AI cooking up?" moment is actually seen, even on an instant cache hit.
    const startedAt = Date.now();
    const enforceTeaser = !teaserShownToday();
    (async () => {
      const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const body: Record<string, string> = { timezone: tz, now_iso: new Date().toISOString() };
      const cacheKey = `yesterday-debrief:${userId}:${todayYmd()}:${tz}`;
      // Already settled on today's insight? Reuse it verbatim — never regenerate
      // within the day (it would wipe the riddle/quiz the user is mid-answer on).
      const frozen = readFrozenInsight(cacheKey);
      if (frozen) {
        if (!alive || signal.aborted) return;
        setData(frozen);
        if (enforceTeaser) markTeaserShown();
        setFetching(false);
        return;
      }
      try {
        const { data: resp } = await invokeAiCached<InsightsResponse>(
          "yesterday-debrief",
          body,
          {
            ttlMs: 24 * 60 * 60_000,
            persistMs: 24 * 60 * 60_000,
            timeoutMs: 20_000,
            signal,
            cacheKey,
          },
        );
        if (!alive || signal.aborted) return;
        const usable =
          resp && typeof resp === "object" && resp.show &&
          (
            (Array.isArray(resp.yesterday) && resp.yesterday.length > 0) ||
            (Array.isArray(resp.bullets) && resp.bullets.length > 0) ||
            (typeof resp.riddle === "string" && resp.riddle.length > 0) ||
            (Array.isArray(resp.quiz) && resp.quiz.length > 0) ||
            (typeof resp.challenge === "string" && resp.challenge.length > 0)
          );
        // Don't let an empty/error response stick for the cache's 24h TTL. The
        // server now returns an evergreen mode even on data-less days, so a
        // non-usable result is a transient hiccup — drop it so the next
        // foreground (or day roll) retries instead of showing a blank card all
        // day. (Dev-refresh already invalidates; this covers the auto path.)
        if (!usable) invalidateAiCache("yesterday-debrief");
        // Freeze the resolved insight for the rest of the day so it can't be
        // regenerated (and the user's answers lost) on a remount/resume.
        if (usable) writeFrozenInsight(cacheKey, resp);
        setData(usable ? resp : { show: false });
      } catch {
        if (alive) {
          invalidateAiCache("yesterday-debrief");
          setData({ show: false });
        }
      } finally {
        if (alive) {
          const remaining = enforceTeaser ? Math.max(0, MIN_TEASER_MS - (Date.now() - startedAt)) : 0;
          if (remaining > 0) {
            teaserTimer = setTimeout(() => {
              if (!alive) return;
              markTeaserShown();
              setFetching(false);
            }, remaining);
          } else {
            if (enforceTeaser) markTeaserShown();
            setFetching(false);
          }
        }
      }
    })();
    return () => { alive = false; if (teaserTimer) clearTimeout(teaserTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, dayKey, isPro, entLoading]);

  useEffect(() => {
    if (!data?.show || !data?.date) return;
    if (isPro) return;
    recordSeenDate(data.date);
  }, [data?.show, data?.date, isPro]);

  // Eagerly count today's date so the gate fires on the correct day.
  // The recordSeenDate effect runs after this render, so without this the
  // quota check is always one day behind (users get FREE_LIMIT+1 free days).
  const seenCount = useMemo(() => {
    const dates = readSeenDates();
    if (data?.date && !isPro && !dates.includes(data.date)) return dates.length + 1;
    return dates.length;
  }, [data?.date, isPro]);
  // Insights are Pro-only — every free user sees the locked upsell teaser.
  const showLockedTeaser = !isPro;

  // While fetching (new day or initial load), show a placeholder so there's
  // no invisible-then-flicker transition. The card is collapsed by default so
  // it's unobtrusive; if the user opens it they see the loading state.
  if (fetching) {
    // Teaser lives entirely in the header (eyebrow + animated kicker) so it's
    // visible while the card is collapsed — no hidden body to miss.
    return (
      <InsightsShell icon={Sparkles} eyebrow="Today's Surprise" kicker={<TeaserKicker />} collapsed={collapsed} onToggle={toggleCollapsed}>
        {null}
      </InsightsShell>
    );
  }

  // Pro-only gate. Checked BEFORE the data guards because free users never
  // fetch, so `data` stays null for them — they should still see the teaser.
  if (showLockedTeaser) {
    return (
      <>
        <InsightsShell icon={Lock} eyebrow="Insights" kicker="Pro feature" collapsed={collapsed} onToggle={toggleCollapsed}>
          <button
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className="w-full text-left"
          >
            <p className="text-[14px] font-medium text-foreground/90 leading-snug">
              A fresh spark every morning.
            </p>
            <p className="mt-1 text-[12px] text-secondary-fg/85 leading-relaxed">
              Daily Insights are a Pro feature — a new riddle, quiz, or challenge each day, plus a look back at yesterday.
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary">
              <Lock className="h-3 w-3" />
              Unlock with Pro
            </span>
          </button>
        </InsightsShell>
        <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
      </>
    );
  }

  if (data === null) return null;
  if (!data.show) return null;

  const mode: Mode = (data.mode as Mode) || "recap";
  const remaining = isPro ? null : Math.max(0, FREE_LIMIT - seenCount);

  const theme = MODE_THEME[mode] ?? MODE_THEME.recap;
  const accent = theme.accent;

  const yesterdayBullets = (
    data.yesterday && data.yesterday.length > 0 ? data.yesterday : (data.bullets || [])
  ).slice(0, 2);
  const tip = (data.today_tip || "").trim();
  const spark = (data.spark || "").trim();

  return (
    <InsightsShell accent={accent} icon={theme.icon} eyebrow={theme.label} kicker={theme.kicker} collapsed={collapsed} onToggle={toggleCollapsed}>
      {mode === "riddle" && data.riddle ? (
        <RiddleSection key={data.date || ""} accent={accent} riddle={data.riddle} riddleAnswer={data.riddle_answer || ""} funFact={data.fun_fact} />
      ) : mode === "quiz" && Array.isArray(data.quiz) && data.quiz.length > 0 ? (
        <QuizSection key={data.date || ""} accent={accent} questions={data.quiz} />
      ) : mode === "challenge" && data.challenge ? (
        <ChallengeSection key={data.date || ""} accent={accent} challenge={data.challenge} context={data.challenge_context} />
      ) : (
        <>
          {yesterdayBullets.length > 0 && (
            <Section icon={History} eyebrow="Yesterday">
              <ul className="space-y-1.5">
                {yesterdayBullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13.5px] text-foreground/90 leading-snug">
                    <span className="mt-[7px] h-1 w-1 rounded-full bg-primary/75 shrink-0" aria-hidden />
                    <span className="min-w-0">{b}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {tip && (
            <Section icon={Flame} eyebrow="Today's tip" tone="primary">
              <p className="text-[13.5px] text-foreground/95 leading-snug">{tip}</p>
            </Section>
          )}
          {spark && (
            <Section icon={Quote} eyebrow="Spark" tone="muted">
              <p className="text-[12.5px] italic text-secondary-fg/95 leading-snug">{spark}</p>
            </Section>
          )}
        </>
      )}

      {mode !== "recap" && data.phrase_of_day && <FactOfDay accent={accent} phrase={data.phrase_of_day} />}

      {data.week_stat && (
        <div className="mt-3 pt-3 border-t border-foreground/[0.07]">
          <WeekStatLine stat={data.week_stat} />
        </div>
      )}

      {remaining !== null && remaining <= 2 && (
        <p className="mt-3 text-[11px] text-secondary-fg/70">
          {remaining > 0
            ? `${remaining} free insight${remaining === 1 ? "" : "s"} left — daily with Pro.`
            : "Last free insight — Pro keeps these going daily."}
        </p>
      )}
    </InsightsShell>
  );
}

function Section({
  icon: Icon,
  eyebrow,
  tone = "default",
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  eyebrow: string;
  tone?: "default" | "primary" | "muted";
  children: React.ReactNode;
}) {
  const chipBg =
    tone === "primary"
      ? "bg-primary/[0.14] text-primary"
      : tone === "muted"
        ? "bg-foreground/[0.06] text-secondary-fg/85"
        : "bg-primary/[0.10] text-primary/90";
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-[7px] ${chipBg}`} aria-hidden>
          <Icon className="h-3 w-3" strokeWidth={2.4} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/75">
          {eyebrow}
        </span>
      </div>
      <div className="pl-[26px]">{children}</div>
    </div>
  );
}

export const YesterdayDebriefCard = memo(InsightsCardInner);
export const InsightsCard = YesterdayDebriefCard;
