import { memo, useEffect, useMemo, useState } from "react";
import { Sparkles, X, Lock, History, Flame, Quote } from "lucide-react";
import { invokeAiCached } from "@/lib/aiCache";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

/**
 * Morning "Insights" card.
 *
 * Sits above the plan-progress slot on Home so the user opens the app to a
 * one-glance briefing: a recap of yesterday, a concrete tip for today,
 * and a short spark line (quote, metaphor, or sharp observation).
 *
 * Backend (`yesterday-debrief`) returns:
 *   { show, date, yesterday: string[], today_tip: string, spark: string }
 * For older deployments the legacy `bullets` field is preserved and used
 * as a fallback when `yesterday` is missing.
 *
 * Behaviour rules — additive only, must never break Home:
 *  - silently hides on any failure (no plan yesterday, no completed tasks,
 *    edge function down, parse error, abort);
 *  - dismissible per-day (X), survives across mounts via localStorage;
 *  - free users see 3 unique-date insights lifetime, then the card shows a
 *    locked teaser that opens the upgrade sheet on tap;
 *  - response is daily-cached (12h) at the AI cache layer so reopening the
 *    Home screen during the day costs nothing.
 *
 * Styling matches the existing `app-card` aesthetic — a subtle primary
 * gradient stripe at the top + the same eyebrow/copy treatment used by
 * "Today's plan" and "Time tracked today" cards.
 */

type InsightsResponse = {
  show?: boolean;
  date?: string;
  title?: string;
  /** New shape. */
  yesterday?: string[];
  today_tip?: string;
  spark?: string;
  /** Legacy shape — older edge fn returns this and nothing else. */
  bullets?: string[];
};

const FREE_LIMIT = 3;
const SEEN_DATES_KEY = "dd_debrief_seen_dates";
const DISMISSED_PREFIX = "dd_debrief_dismissed_";

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
    const trimmed = seen.slice(-90);
    localStorage.setItem(SEEN_DATES_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

function isDismissedToday(): boolean {
  try {
    return localStorage.getItem(`${DISMISSED_PREFIX}${todayYmd()}`) === "1";
  } catch {
    return false;
  }
}

function markDismissedToday(): void {
  try {
    localStorage.setItem(`${DISMISSED_PREFIX}${todayYmd()}`, "1");
  } catch {
    /* ignore */
  }
}

function InsightsCardInner({ timezone }: { timezone?: string | null }) {
  const { isPro } = useEntitlement();
  const getSignal = useAbortOnUnmount();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => isDismissedToday());
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    let alive = true;
    const signal = getSignal();
    (async () => {
      const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        const { data: resp } = await invokeAiCached<InsightsResponse>(
          "yesterday-debrief",
          { timezone: tz, now_iso: new Date().toISOString() },
          {
            ttlMs: 12 * 60 * 60_000,
            persistMs: 12 * 60 * 60_000,
            timeoutMs: 20_000,
            signal,
            cacheKey: `yesterday-debrief:${todayYmd()}:${tz}`,
          },
        );
        if (!alive || signal.aborted) return;
        const usable =
          resp && typeof resp === "object" && resp.show &&
          ((Array.isArray(resp.yesterday) && resp.yesterday.length > 0) ||
            (Array.isArray(resp.bullets) && resp.bullets.length > 0));
        setData(usable ? resp : { show: false });
      } catch {
        if (alive) setData({ show: false });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, dismissed]);

  useEffect(() => {
    if (!data?.show || !data?.date) return;
    if (isPro) return;
    recordSeenDate(data.date);
  }, [data?.show, data?.date, isPro]);

  const seenCount = useMemo(() => readSeenDates().length, [data?.date]);
  const freeQuotaExhausted = !isPro && seenCount > FREE_LIMIT;
  const showLockedTeaser = !isPro && freeQuotaExhausted;

  if (dismissed) return null;
  if (data === null) return null;
  if (!data.show && !showLockedTeaser) return null;

  const dismiss = () => {
    markDismissedToday();
    setDismissed(true);
  };

  if (showLockedTeaser) {
    return (
      <>
        <InsightsShell onDismiss={dismiss} accent locked onClick={() => setUpgradeOpen(true)}>
          <p className="text-[14px] font-medium text-foreground/90 leading-snug">
            Keep your daily Insights flowing.
          </p>
          <p className="mt-1 text-[12px] text-secondary-fg/85 leading-relaxed">
            You've used your free Insights. Upgrade to Pro for a fresh recap, tip, and spark every morning.
          </p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary">
            <Lock className="h-3 w-3" />
            Unlock with Pro
          </span>
        </InsightsShell>
        <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
      </>
    );
  }

  // Real card — three sections.
  const yesterday = (data.yesterday && data.yesterday.length > 0
    ? data.yesterday
    : (data.bullets || [])
  ).slice(0, 2);
  const tip = (data.today_tip || "").trim();
  const spark = (data.spark || "").trim();
  const remaining = isPro ? null : Math.max(0, FREE_LIMIT - seenCount);

  return (
    <InsightsShell onDismiss={dismiss} accent>
      {yesterday.length > 0 && (
        <Section icon={History} eyebrow="Yesterday">
          <ul className="space-y-1.5">
            {yesterday.map((b, i) => (
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
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
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
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-[7px] ${chipBg}`}
          aria-hidden
        >
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

function InsightsShell({
  children,
  onDismiss,
  accent,
  locked,
  onClick,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  accent?: boolean;
  locked?: boolean;
  onClick?: () => void;
}) {
  const wrapperClass = `relative app-card mt-4 px-4 py-3.5 overflow-hidden ${
    onClick ? "cursor-pointer tappable" : ""
  }`;
  return (
    <div
      className={wrapperClass}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
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
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="absolute top-2.5 right-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-secondary-fg/65 hover:text-foreground hover:bg-foreground/[0.06] pressable"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2 mb-2 pr-7">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[8px] bg-primary/[0.12] text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <span className="eyebrow">{locked ? "Insights" : "Insights"}</span>
      </div>
      {children}
    </div>
  );
}

/** Public export — old `YesterdayDebriefCard` name kept so callers don't break. */
export const YesterdayDebriefCard = memo(InsightsCardInner);
export const InsightsCard = YesterdayDebriefCard;
