import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Timer, BarChart2, Settings as SettingsIcon } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed, fmtHMS } from "@/hooks/useTimeTracker";
import { haptics } from "@/lib/haptics";

const tabs = [
  { to: "/today", icon: Home, label: "Today", tour: "tab-today" },
  { to: "/tracker", icon: Timer, label: "Timer", tour: "tab-tracker" },
  { to: "/history", icon: BarChart2, label: "History", tour: "tab-history" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", tour: "tab-settings" },
];

export const TabBar = () => {
  const { active } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const { pathname } = useLocation();
  const prevPath = useRef<string | null>(null);
  const activeIdx = Math.max(0, tabs.findIndex((t) => pathname.startsWith(t.to)));
  const [prevIdx, setPrevIdx] = useState(activeIdx);
  const moveDir = activeIdx > prevIdx ? "tab-indicator-move-right" : activeIdx < prevIdx ? "tab-indicator-move-left" : "";
  useEffect(() => {
    if (prevPath.current !== null && prevPath.current !== pathname) haptics.selection();
    prevPath.current = pathname;
    setPrevIdx(activeIdx);
  }, [pathname, activeIdx]);

  return (
    <nav
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(94vw,420px)] z-40"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {active && (
        <div className="mb-2 mx-auto w-max max-w-full px-3 py-1.5 rounded-full bg-background/88 border border-accent shadow-card flex items-center gap-2 ring-1 ring-black/[0.04] dark:ring-white/[0.05] tracker-status-pill">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-primary tracker-dot-soft-pulse opacity-60" />
            <span className="relative h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-[11px] text-secondary-fg">Tracking</span>
          <span className="text-[12px] font-mono-sf tabular-nums text-foreground min-w-[64px] text-right">{fmtHMS(elapsedSec)}</span>
        </div>
      )}
      <div className="relative bg-background/[0.72] backdrop-blur-2xl border border-soft rounded-[22px] shadow-tab flex items-center px-1 py-1 ring-1 ring-black/[0.04] dark:ring-white/[0.1] overflow-hidden tabbar-luxe">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-8 opacity-70"
          style={{ background: "linear-gradient(180deg, hsl(var(--primary) / 0.24), transparent)" }}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute top-1 bottom-1 rounded-[14px] tab-indicator-liquid-trail ${moveDir}`}
          style={{
            left: `calc(${activeIdx * 25}% + 4px)`,
            width: "calc(25% - 8px)",
          }}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute top-1 bottom-1 rounded-[14px] border border-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_22px_-10px_hsl(var(--primary)/0.52)] tab-indicator-luxe tab-indicator-liquid ${moveDir}`}
          style={{
            background: "linear-gradient(132deg, hsl(var(--primary) / 0.3), hsl(var(--primary-glow) / 0.24))",
            left: `calc(${activeIdx * 25}% + 4px)`,
            width: "calc(25% - 8px)",
          }}
        />
        {tabs.map((it) => (
          <TabItem key={it.to} {...it} pulse={it.to === "/tracker" && !!active} />
        ))}
      </div>
    </nav>
  );
};

function TabItem({ to, icon: Icon, label, tour, pulse }: { to: string; icon: any; label: string; tour: string; pulse?: boolean }) {
  return (
    <NavLink
      to={to}
      data-tour={tour}
      className={({ isActive }) =>
        `relative z-[1] flex min-h-[46px] flex-col items-center justify-center gap-0.5 flex-1 rounded-[14px] py-1.5 px-0.5 pressable transition-all duration-200 ${
          isActive
            ? "text-primary"
            : "text-secondary-fg hover:text-subtle hover:bg-foreground/[0.03]"
        }`
      }
      aria-label={label}
    >
      {({ isActive }) => (
        <>
          <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
          <span className="max-w-full truncate px-0.5 text-center text-[10px] font-semibold leading-tight tracking-tight">
            {label}
          </span>
          {pulse && <span className="absolute right-[18%] top-1 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />}
        </>
      )}
    </NavLink>
  );
}
