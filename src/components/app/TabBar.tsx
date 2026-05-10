import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Timer, BarChart2, Settings as SettingsIcon } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed } from "@/hooks/useTimeTracker";
import { haptics } from "@/lib/haptics";
import type { LucideIcon } from "lucide-react";

const tabs = [
  { to: "/tracker", icon: Timer, label: "Timer", tour: "tab-tracker" },
  { to: "/today", icon: Home, label: "Today", tour: "tab-today" },
  { to: "/history", icon: BarChart2, label: "History", tour: "tab-history" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", tour: "tab-settings" },
];

const fmtMMSS = (s: number) => {
  const mm = Math.floor(s / 60);
  const ss = Math.max(0, Math.floor(s % 60));
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

export const TabBar = () => {
  const { active } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const { pathname } = useLocation();
  const prevPath = useRef<string | null>(null);
  const activeIdx = Math.max(0, tabs.findIndex((t) => pathname.startsWith(t.to)));
  const trackerLabel = active ? fmtMMSS(elapsedSec) : "Timer";

  useEffect(() => {
    if (prevPath.current !== null && prevPath.current !== pathname) haptics.selection();
    prevPath.current = pathname;
  }, [pathname]);

  const tabCount = tabs.length;

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(calc(100vw-24px),424px)] z-40"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}
    >
      <div className="relative rounded-[28px] p-[1.5px] tabbar-shell-glow tabbar-outer-ring">
        <div
          className="relative bg-background/[0.78] backdrop-blur-2xl border border-soft/90 rounded-[26px] shadow-tab flex items-center px-1.5 py-1.5 ring-1 ring-black/[0.04] dark:ring-white/[0.09] overflow-hidden tabbar-luxe tabbar-glass-fix"
          style={
            {
              "--tab-active": activeIdx,
              "--tab-n": tabCount,
            } as CSSProperties
          }
        >
          <span
            aria-hidden
            className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-[20px] border border-primary/35 tab-indicator-liquid tab-indicator-pill-glow"
            style={{
              background: "linear-gradient(145deg, hsl(var(--primary) / 0.34), hsl(var(--primary-glow) / 0.22))",
              width: "calc((100% - 12px) / var(--tab-n))",
              left: "calc(6px + (100% - 12px) * var(--tab-active) / var(--tab-n))",
            }}
          />
          {tabs.map((it) => (
            <TabItem key={it.to} {...it} label={it.to === "/tracker" ? trackerLabel : it.label} pulse={it.to === "/tracker" && !!active} />
          ))}
        </div>
      </div>
    </nav>
  );
};

function TabItem({ to, icon: Icon, label, tour, pulse }: { to: string; icon: LucideIcon; label: string; tour: string; pulse?: boolean }) {
  return (
    <NavLink
      to={to}
      data-tour={tour}
      className={({ isActive }) =>
        `relative z-[1] flex min-h-[48px] flex-col items-center justify-center gap-0.5 flex-1 rounded-[14px] py-1.5 px-0.5 pressable transition-colors duration-300 ease-out ${
          isActive
            ? "text-primary"
            : "text-secondary-fg hover:text-subtle"
        }`
      }
      aria-label={label}
    >
      {({ isActive }) => (
        <>
          <Icon className={`h-[18px] w-[18px] transition-transform duration-300 ease-out ${isActive ? "scale-[1.06] -translate-y-px" : "scale-100"}`} strokeWidth={isActive ? 2.1 : 1.8} aria-hidden />
          <span className={`max-w-full truncate px-0.5 text-center text-[10px] font-semibold leading-tight tracking-tight transition-all duration-300 ease-out ${isActive ? "opacity-100 translate-y-0" : "opacity-[0.88] translate-y-px"}`}>
            {label}
          </span>
          {pulse && <span className="absolute left-1/2 -translate-x-1/2 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan-300 tab-live-dot-pulse" aria-hidden />}
        </>
      )}
    </NavLink>
  );
}
