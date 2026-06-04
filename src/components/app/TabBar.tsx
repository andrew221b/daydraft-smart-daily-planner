import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, CalendarDays, Settings as SettingsIcon, Timer } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform, useVelocity } from "framer-motion";
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

  // Measure the row width so the indicator can spring on an absolute pixel
  // offset instead of percent-of-parent. Springs need a numeric target.
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => setRowWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pillWidth = rowWidth > 0 ? (rowWidth - totalGapPx) / n : 0;
  const targetX = activeIdx * (pillWidth + TAB_GAP_PX);

  // Liquid-rubber indicator: a real spring drives x, and we derive scaleX /
  // scaleY from |velocity| so the pill squashes & stretches mid-flight, then
  // settles. Stiffness/damping tuned for "weighty but lively" — overshoots
  // ~6%, no oscillation, ~380ms total travel feel.
  const x = useSpring(0, { stiffness: 360, damping: 22, mass: 1 });
  const initialized = useRef(false);

  useEffect(() => {
    if (rowWidth === 0) return;
    if (!initialized.current) {
      x.jump(targetX);
      initialized.current = true;
    } else {
      x.set(targetX);
    }
  }, [targetX, rowWidth, x]);

  const velocity = useVelocity(x);
  const absVelocity = useTransform(velocity, (v) => Math.min(2400, Math.abs(v)));
  // Stretch along travel direction (scaleX > 1), squash on the cross-axis
  // (scaleY < 1) — classic Disney rubber animation.
  const stretchRaw = useTransform(absVelocity, [0, 2400], [1, 1.18]);
  const squashRaw = useTransform(absVelocity, [0, 2400], [1, 0.9]);
  const scaleX = useSpring(stretchRaw, { stiffness: 220, damping: 26 });
  const scaleY = useSpring(squashRaw, { stiffness: 220, damping: 26 });

  return (
    <nav
      // Full-width so the frosted glass covers the side gaps (12 px each side)
      // and the home indicator zone — exactly like native iOS tab bars.
      // Blur lives on the nav itself (a plain rectangle, no radius clip) so
      // WKWebView can't produce hard rounded-corner artefacts.
      // `--keyboard-inset` keeps the bar above the soft keyboard.
      className="fixed bottom-0 inset-x-0 z-40 bg-transparent"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 10px)",
        transform: "translateY(calc(-1 * var(--keyboard-inset, 0px)))",
        transition: "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        touchAction: "manipulation",
      }}
    >
      {/* The gradient blur under the pill */}
      <div 
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[-1]"
        style={{
          height: "max(env(safe-area-inset-bottom), 10px)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          maskImage: "linear-gradient(to bottom, transparent, black 80%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, black 80%)",
        }}
      />
      {/* Centering wrapper — pill stays max 424 px wide, centred */}
      <div className="mx-auto w-[min(calc(100vw-24px),424px)] px-px">
      {/* Inner pill — frosted glass */}
      <div
        className="relative rounded-[28px] backdrop-blur-xl bg-background/62 border border-white/20 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.15),inset_0_1px_1px_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.1)]"
      >
        <div className="p-1.5">
          <div ref={rowRef} className="relative isolate flex min-h-[48px] gap-1.5">
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-0 rounded-2xl bg-primary/[0.16] ring-1 ring-inset ring-primary/30 shadow-[0_6px_22px_-10px_hsl(var(--primary)/0.55)] will-change-transform dark:bg-primary/[0.2] dark:ring-primary/[0.36] dark:shadow-[0_6px_24px_-10px_hsl(var(--primary)/0.65)]"
              style={{
                width: pillWidth || `calc((100% - ${totalGapPx}px) / ${n})`,
                x,
                scaleX,
                scaleY,
              }}
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
      className={`relative z-[1] flex min-h-[46px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 transition-[color,opacity] duration-200 ease-out active:opacity-65 -webkit-tap-highlight-color-transparent ${
        highlighted ? "text-primary" : "text-secondary-fg hover:text-foreground/80"
      }`}
      style={{ WebkitTapHighlightColor: "transparent" }}
      aria-label={label}
      aria-current={highlighted ? "page" : undefined}
    >
      <Icon
        className={`h-[18px] w-[18px] transition-[transform,stroke-width] duration-200 ease-[cubic-bezier(0.34,1.4,0.64,1)] ${
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
