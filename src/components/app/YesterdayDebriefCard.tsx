import { memo, useEffect, useMemo, useState } from "react";
import {
  Sparkles, Lock, History, Flame, Quote,
  HelpCircle, CheckSquare, Zap, ChevronDown, TrendingUp,
} from "lucide-react";
import { invokeAiCached } from "@/lib/aiCache";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { useDayKey } from "@/hooks/useDayKey";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

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
const COLLAPSED_KEY = "dd_insights_collapsed";

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

// ── Mode sub-components ──────────────────────────────────────────────────────

function RiddleSection({ riddle, riddleAnswer, funFact }: {
  riddle: string;
  riddleAnswer: string;
  funFact?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <p className="text-[13.5px] text-foreground/90 leading-relaxed italic">{riddle}</p>
      <button
        type="button"
        onClick={() => setRevealed(true)}
        disabled={revealed}
        className={`mt-3 w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-medium border transition-all duration-200 ${
          revealed
            ? "bg-primary/[0.12] text-primary border-primary/30"
            : "bg-foreground/[0.06] text-secondary-fg/75 border-transparent hover:bg-foreground/[0.10] active:scale-[0.98]"
        }`}
      >
        {revealed ? (
          <span>
            <span className="text-secondary-fg/55 font-normal text-[11px] mr-1.5">Answer:</span>
            <span className="text-foreground/95 font-semibold">{riddleAnswer}</span>
          </span>
        ) : (
          <span className="flex items-center justify-between">
            <span>Tap to reveal answer</span>
            <span className="text-secondary-fg/40 tracking-widest text-[11px]" aria-hidden>● ● ●</span>
          </span>
        )}
      </button>
      {revealed && funFact && (
        <p className="mt-2.5 text-[12px] text-secondary-fg/70 leading-relaxed">{funFact}</p>
      )}
    </div>
  );
}

function QuizSection({ questions }: { questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const allAnswered = questions.length > 0 && Object.keys(answers).length === questions.length;
  const score = questions.reduce((acc, q, i) => acc + (answers[i] === Math.max(0, Math.min(q.correct, q.options.length - 1)) ? 1 : 0), 0);

  return (
    <div className="space-y-4">
      {questions.map((q, qi) => {
        const isAnswered = answers[qi] !== undefined;
        const clampedCorrect = Math.max(0, Math.min(q.correct, q.options.length - 1));
        return (
          <div key={qi}>
            <p className="text-[13px] font-medium text-foreground/90 leading-snug mb-2">{q.q}</p>
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
                    onClick={() => setAnswers((prev) => ({ ...prev, [qi]: oi }))}
                    className={`w-full text-left px-3 py-2 rounded-xl text-[12.5px] border transition-all duration-150 ${
                      showCorrect
                        ? "bg-success/[0.15] text-success border-success/40"
                        : showWrong
                          ? "bg-destructive/[0.12] text-destructive/90 border-destructive/[0.28]"
                          : showDim
                            ? "bg-foreground/[0.03] text-foreground/40 border-transparent"
                            : "bg-foreground/[0.06] text-foreground/80 border-transparent hover:bg-foreground/[0.10] active:scale-[0.99]"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {isAnswered && q.explanation && (
              <p className="mt-2 text-[12px] text-secondary-fg/70 leading-relaxed">{q.explanation}</p>
            )}
          </div>
        );
      })}
      {allAnswered && (
        <p className="mt-2 text-[12px] font-semibold text-primary">
          {score === questions.length ? "Perfect score!" : score > 0 ? `${score}/${questions.length} — solid` : `0/${questions.length} — now you know`}
        </p>
      )}
    </div>
  );
}

function ChallengeSection({ challenge, context }: { challenge: string; context?: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="pl-3 border-l-[2.5px] border-primary/35">
      <p className="text-[14px] font-semibold text-foreground/95 leading-snug">{challenge}</p>
      {context && (
        <>
          <button
            type="button"
            onClick={() => setRevealed(true)}
            disabled={revealed}
            className={`mt-3 w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-medium border transition-all duration-200 ${
              revealed
                ? "bg-primary/[0.12] text-primary border-primary/30"
                : "bg-foreground/[0.06] text-secondary-fg/75 border-transparent hover:bg-foreground/[0.10] active:scale-[0.98]"
            }`}
          >
            {revealed ? (
              <span>
                <span className="text-secondary-fg/55 font-normal text-[11px] mr-1.5">Result:</span>
                <span className="text-foreground/95 font-semibold">{context}</span>
              </span>
            ) : (
              <span className="flex items-center justify-between">
                <span>Tap to reveal result</span>
                <span className="text-secondary-fg/40 tracking-widest text-[11px]" aria-hidden>● ● ●</span>
              </span>
            )}
          </button>
        </>
      )}
    </div>
  );
}

function PhraseOfDay({ phrase }: { phrase: string }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary-fg/50 block mb-1">
        Fact of the day
      </span>
      <p className="text-[13px] text-secondary-fg/85 leading-relaxed">{phrase}</p>
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

// ── Shell ─────────────────────────────────────────────────────────────────────

function InsightsShell({
  children,
  accent,
  icon: Icon = Sparkles,
  eyebrow: eyebrowLabel = "Insights",
  collapsed,
  onToggle,
}: {
  children: React.ReactNode;
  accent?: boolean;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  eyebrow?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative app-card mt-4 overflow-hidden">
      {accent && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.55) 50%, transparent 100%)",
          }}
        />
      )}

      {/* Always-visible tappable header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 pt-3.5 pb-3 pressable"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-[8px] bg-primary/[0.12] text-primary">
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="eyebrow">{eyebrowLabel}</span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-secondary-fg/50 transition-transform duration-300 ${collapsed ? "" : "rotate-180"}`}
          strokeWidth={2}
        />
      </button>

      {/* Collapsible content */}
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

const DEV_MODE_KEY = "dd_insights_dev_mode";
export const INSIGHTS_DEV_MODE_EVENT = "dd_insights_dev_mode_change";

function InsightsCardInner({ timezone }: { timezone?: string | null }) {
  const { isPro } = useEntitlement();
  const getSignal = useAbortOnUnmount();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [devModeTick, setDevModeTick] = useState(0);
  // Re-fetch when the local day rolls over. Default (non-live) so a fresh
  // insight only swaps in on the next foreground after midnight — never yanked
  // out from under someone reading it at 00:00.
  const dayKey = useDayKey();

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  // Listen for dev-mode changes from Settings so the card refetches immediately.
  useEffect(() => {
    const handler = () => setDevModeTick((n) => n + 1);
    window.addEventListener(INSIGHTS_DEV_MODE_EVENT, handler);
    return () => window.removeEventListener(INSIGHTS_DEV_MODE_EVENT, handler);
  }, []);

  useEffect(() => {
    let alive = true;
    const signal = getSignal();
    (async () => {
      const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      let devMode: string | null = null;
      let variation = "";
      try {
        devMode = localStorage.getItem(DEV_MODE_KEY);
        variation = localStorage.getItem("dd_insights_variation") || "";
      } catch {}
      const body: Record<string, string> = { timezone: tz, now_iso: new Date().toISOString() };
      if (devMode) body.force_mode = devMode;
      if (variation) body.variation = variation;
      const cacheKey = `yesterday-debrief:${todayYmd()}:${tz}${devMode ? `:${devMode}` : ""}${variation ? `:v${variation}` : ""}`;
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
        setData(usable ? resp : { show: false });
      } catch {
        if (alive) setData({ show: false });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, devModeTick, dayKey]);

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
  const freeQuotaExhausted = !isPro && seenCount > FREE_LIMIT;
  const showLockedTeaser = !isPro && freeQuotaExhausted;

  if (data === null) return null;
  if (!data.show && !showLockedTeaser) return null;

  if (showLockedTeaser) {
    return (
      <>
        <InsightsShell accent icon={Lock} eyebrow="Insights" collapsed={collapsed} onToggle={toggleCollapsed}>
          <button
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className="w-full text-left"
          >
            <p className="text-[14px] font-medium text-foreground/90 leading-snug">
              Keep your daily Insights flowing.
            </p>
            <p className="mt-1 text-[12px] text-secondary-fg/85 leading-relaxed">
              You've used your free Insights. Upgrade to Pro for a fresh riddle, quiz, or challenge every morning.
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

  const mode = data.mode || "recap";
  const remaining = isPro ? null : Math.max(0, FREE_LIMIT - seenCount);

  const modeIcon =
    mode === "riddle" ? HelpCircle :
    mode === "quiz" ? CheckSquare :
    mode === "challenge" ? Zap :
    Sparkles;
  const modeEyebrow =
    mode === "riddle" ? "Riddle" :
    mode === "quiz" ? "Quick Quiz" :
    mode === "challenge" ? "Challenge" :
    "Insights";

  const yesterdayBullets = (
    data.yesterday && data.yesterday.length > 0 ? data.yesterday : (data.bullets || [])
  ).slice(0, 2);
  const tip = (data.today_tip || "").trim();
  const spark = (data.spark || "").trim();

  return (
    <InsightsShell accent icon={modeIcon} eyebrow={modeEyebrow} collapsed={collapsed} onToggle={toggleCollapsed}>
      {mode === "riddle" && data.riddle ? (
        <RiddleSection riddle={data.riddle} riddleAnswer={data.riddle_answer || ""} funFact={data.fun_fact} />
      ) : mode === "quiz" && Array.isArray(data.quiz) && data.quiz.length > 0 ? (
        <QuizSection questions={data.quiz} />
      ) : mode === "challenge" && data.challenge ? (
        <ChallengeSection challenge={data.challenge} context={data.challenge_context} />
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

      {(data.week_stat || (mode !== "recap" && data.phrase_of_day)) && (
        <div className="mt-3.5 pt-3 border-t border-foreground/[0.07] space-y-2.5">
          {data.week_stat && <WeekStatLine stat={data.week_stat} />}
          {mode !== "recap" && data.phrase_of_day && <PhraseOfDay phrase={data.phrase_of_day} />}
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
