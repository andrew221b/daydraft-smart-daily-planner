import { memo, useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, CalendarDays, Settings as SettingsIcon, Timer } from "lucide-react";
import { haptics } from "@/lib/haptics";
import type { LucideIcon } from "lucide-react";

// Each tab carries a `prefetch` thunk that imports the matching route
// chunk on first touch. Vite returns the same promise for repeat
// imports, so calling it on every tap is a no-op once the chunk is
// cached. The effect is that the user's finger-down event kicks the
// download *before* the click commits — eliminating the lazy-load
// spinner on tab switches for users whose Shell prefetch hasn't yet
// completed (slow phones, throttled connections, cold app start).
const tabs = [
  { to: "/home", icon: Timer, label: "Track", tour: "tab-home", prefetch: () => import("@/pages/app/Home") },
  { to: "/today", icon: CalendarDays, label: "Plan", tour: "tab-today", prefetch: () => import("@/pages/app/DayView") },
  { to: "/reports", icon: BarChart3, label: "Reports", tour: "tab-reports", prefetch: () => import("@/pages/app/Reports") },
  { to: "/settings", icon: SettingsIcon, label: "Settings", tour: "tab-settings", prefetch: () => import("@/pages/app/Settings") },
] as const;

/** Must match Tailwind gap-1.5 (6px). */
const TAB_GAP_PX = 6;

const activeTabIndex = (pathname: string) => {
  if (
    pathname === "/" ||
    pathname.startsWith("/home") ||
    pathname.startsWith("/tracker") ||
    pathname.startsWith("/focus")
  ) {
    return 0;
  }
  if (pathname.startsWith("/today")) return 1;
  if (pathname.startsWith("/reports")) return 2;
  if (pathname.startsWith("/settings")) return 3;
  return 0;
};

export const TabBar = () => {
  const { pathname } = useLocation();
  const prevPath = useRef<string | null>(null);

  const activeIdx = activeTabIndex(pathname);

  useEffect(() => {
    if (prevPath.current !== null && prevPath.current !== pathname) haptics.selection();
    prevPath.current = pathname;
  }, [pathname]);

  const n = tabs.length;
  const totalGapPx = Math.max(0, n - 1) * TAB_GAP_PX;
  const pillWidthCalc = `(100% - ${totalGapPx}px) / ${n}`;
  const indicatorStyle = {
    width: `calc(${pillWidthCalc})`,
    transform: `translateX(calc(${activeIdx} * (100% + ${TAB_GAP_PX}px))) translateZ(0)`,
    // iOS 26 indicator: tight springy slide with the slightest overshoot.
    transitionTimingFunction: "cubic-bezier(0.34, 1.4, 0.64, 1)",
  } as const;

  return (
    <nav
      // `--keyboard-inset` is updated by `attachVisualViewportInset` whenever
      // the iOS soft keyboard opens/closes. Translating the bar up by that
      // amount keeps it above the keyboard instead of being hidden behind it.
      className="fixed bottom-0 left-1/2 z-40 w-[min(calc(100vw-24px),424px)] px-px"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 10px)",
        transform: "translateX(-50%) translateY(calc(-1 * var(--keyboard-inset, 0px)))",
        transition: "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <div
        // backdrop-blur is the single most expensive thing iOS WebView
        // recomputes every frame. 24px reads almost identical to 64px
        // at a fraction of the GPU cost; bumped the background opacity
        // a touch (70→78%) to keep the surface legible with less blur.
        className="rounded-[26px] border border-border/55 bg-background/78 shadow-[0_16px_48px_-12px_rgb(0,0,0,0.25)] backdrop-blur-xl dark:border-border/40 dark:bg-background/72 dark:shadow-[0_16px_48px_-12px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/[0.08]"
        style={{ WebkitBackdropFilter: "blur(24px)", backdropFilter: "blur(24px)" }}
      >
        <div className="p-1.5">
          <div className="relative isolate flex min-h-[48px] gap-1.5">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-0 rounded-2xl bg-primary/[0.12] ring-1 ring-inset ring-primary/20 transition-transform duration-[320ms] will-change-transform dark:bg-primary/[0.14] dark:ring-primary/[0.26]"
              style={indicatorStyle}
            />
            {tabs.map((it, idx) => (
              <TabItem
                key={it.to}
                to={it.to}
                icon={it.icon}
                label={it.label}
                tour={it.tour}
                prefetch={it.prefetch}
                highlighted={activeIdx === idx}
              />
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
};

const TabItem = memo(function TabItem({
  to,
  icon: Icon,
  label,
  tour,
  prefetch,
  highlighted,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  tour: string;
  prefetch: () => Promise<unknown>;
  highlighted: boolean;
}) {
  // Kick the route chunk download the moment the user's finger touches
  // the tab — gives Vite a head start so by the time the click commits
  // the chunk is ready. `pointerdown` covers both touch and mouse;
  // touchstart on legacy iOS Safari is a belt-and-braces fallback.
  const warmRoute = () => { void prefetch(); };
  return (
    <NavLink
      to={to}
      data-tour={tour}
      onPointerDown={warmRoute}
      onTouchStart={warmRoute}
      onFocus={warmRoute}
      className={`relative z-[1] flex min-h-[46px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 pressable transition-colors duration-200 ease-out ${
        highlighted ? "text-primary" : "text-secondary-fg hover:text-foreground/80"
      }`}
      aria-label={label}
      aria-current={highlighted ? "page" : undefined}
    >
      <Icon
        className={`h-[18px] w-[18px] transition-[transform,stroke-width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          highlighted ? "scale-[1.08]" : "group-hover:scale-[1.02]"
        }`}
        strokeWidth={highlighted ? 2.2 : 1.75}
        aria-hidden
      />
      <span
        className={`max-w-full truncate px-0.5 text-center text-[10px] font-semibold leading-tight tracking-wide transition-[opacity,letter-spacing] duration-200 ${
          highlighted ? "opacity-100 tracking-[0.01em]" : "opacity-[0.6]"
        }`}
      >
        {label}
      </span>
    </NavLink>
  );
});
