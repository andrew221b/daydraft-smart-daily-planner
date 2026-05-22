import { memo, useEffect, useMemo, useState } from "react";
import { Sunrise, X, Sparkles, Lock } from "lucide-react";
import { invokeAiCached } from "@/lib/aiCache";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

/**
 * Morning "Yesterday's debrief" card.
 *
 * Slot above the plan progress on Home so the user opens the app to a
 * personalised one-glance look back at how yesterday actually went.
 *
 * Behaviour rules — additive only, must never break Home:
 *  - silently hides on any failure (no plan yesterday, no completed tasks,
 *    edge function down, parse error, abort);
 *  - dismissible per-day (X), survives across mounts via localStorage;
 *  - free users see 3 unique-date debriefs lifetime, then the card shows a
 *    locked teaser that opens the upgrade sheet on tap;
 *  - response is daily-cached (24h) at the AI cache layer so reopening the
 *    Home screen during the day costs nothing.
 *
 * Styling matches the existing `app-card` aesthetic — a subtle primary
 * gradient stripe at the top + the same eyebrow/copy treatment used by
 * "Today's plan" and "Time tracked today" cards. Nothing new visually
 * heavy; reads as a sibling of the existing cards.
 */

type DebriefResponse = {
  show?: boolean;
  date?: string;
  title?: string;
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
    // Cap the array so it can't grow forever.
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

function YesterdayDebriefCardInner({ timezone }: { timezone?: string | null }) {
  const { isPro } = useEntitlement();
  const getSignal = useAbortOnUnmount();
  const [data, setData] = useState<DebriefResponse | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => isDismissedToday());
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Once-per-mount fetch. The aiCache layer is keyed on the payload, so
  // remounting (tab switch back to Home) hands back the cached bullets
  // instead of refetching. `persistMs` carries the cache across reloads.
  useEffect(() => {
    if (dismissed) return;
    let alive = true;
    const signal = getSignal();
    (async () => {
      const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        const { data: resp } = await invokeAiCached<DebriefResponse>(
          "yesterday-debrief",
          { timezone: tz, now_iso: new Date().toISOString() },
          {
            // Cache for 12 hours — covers the whole morning + a return visit.
            ttlMs: 12 * 60 * 60_000,
            persistMs: 12 * 60 * 60_000,
            timeoutMs: 20_000,
            signal,
            // Stable key per local day so two opens on the same day hit the
            // cache regardless of `now_iso` jitter.
            cacheKey: `yesterday-debrief:${todayYmd()}:${tz}`,
          },
        );
        if (!alive || signal.aborted) return;
        if (resp && typeof resp === "object" && resp.show && Array.isArray(resp.bullets) && resp.bullets.length > 0) {
          setData(resp);
        } else {
          setData({ show: false });
        }
      } catch {
        if (alive) setData({ show: false });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, dismissed]);

  // Mark this debrief's date as "seen" the first time the card actually
  // renders with bullets. Free-trial counter only ticks on real impressions.
  useEffect(() => {
    if (!data?.show || !data?.date) return;
    if (isPro) return;
    recordSeenDate(data.date);
  }, [data?.show, data?.date, isPro]);

  const seenCount = useMemo(() => readSeenDates().length, [data?.date]);
  const freeQuotaExhausted = !isPro && seenCount > FREE_LIMIT;
  const showLockedTeaser = !isPro && freeQuotaExhausted;

  if (dismissed) return null;
  if (data === null) return null; // still loading, render nothing (no skeleton — keeps Home calm)
  if (!data.show && !showLockedTeaser) return null;

  const dismiss = () => {
    markDismissedToday();
    setDismissed(true);
  };

  if (showLockedTeaser) {
    return (
      <>
        <DebriefShell
          onDismiss={dismiss}
          accent
          locked
          onClick={() => setUpgradeOpen(true)}
        >
          <p className="text-[13.5px] font-medium text-foreground/90 leading-snug">
            Keep getting AI debriefs every morning.
          </p>
          <p className="mt-1 text-[12px] text-secondary-fg/85 leading-relaxed">
            You've used your free debriefs. Upgrade to Pro for daily personalised look-backs.
          </p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary">
            <Lock className="h-3 w-3" />
            Unlock with Pro
          </span>
        </DebriefShell>
        <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
      </>
    );
  }

  // Real debrief
  const bullets = (data.bullets || []).slice(0, 3);
  const remaining = isPro ? null : Math.max(0, FREE_LIMIT - seenCount);

  return (
    <DebriefShell onDismiss={dismiss} accent>
      <ul className="space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-foreground/90 leading-snug">
            <span
              className="mt-[7px] h-1 w-1 rounded-full bg-primary/80 shrink-0"
              aria-hidden
            />
            <span className="min-w-0">{b}</span>
          </li>
        ))}
      </ul>
      {remaining !== null && remaining <= 2 && (
        <p className="mt-3 text-[11px] text-secondary-fg/70">
          {remaining > 0
            ? `${remaining} free debrief${remaining === 1 ? "" : "s"} left — daily with Pro.`
            : "Last free debrief — Pro keeps these going daily."}
        </p>
      )}
    </DebriefShell>
  );
}

/**
 * Visual shell — reused for both real and locked variants. Keeps the
 * morning-card aesthetic in one place so styling stays consistent.
 */
function DebriefShell({
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
      <div className="flex items-center gap-2 mb-2.5 pr-7">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[8px] bg-primary/[0.12] text-primary">
          {locked ? <Sparkles className="h-3.5 w-3.5" /> : <Sunrise className="h-3.5 w-3.5" />}
        </span>
        <span className="eyebrow">Yesterday's debrief</span>
      </div>
      {children}
    </div>
  );
}

export const YesterdayDebriefCard = memo(YesterdayDebriefCardInner);
