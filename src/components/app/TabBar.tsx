import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Timer, BarChart2, Settings as SettingsIcon } from "lucide-react";
import { useTimeTracker, fmtHMS } from "@/hooks/useTimeTracker";
import { haptics } from "@/lib/haptics";

const tabs = [
  { to: "/today", icon: Home, label: "Today", tour: "tab-today" },
  { to: "/tracker", icon: Timer, label: "Timer", tour: "tab-tracker" },
  { to: "/history", icon: BarChart2, label: "History", tour: "tab-history" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", tour: "tab-settings" },
];

export const TabBar = () => {
  const { active, elapsedSec } = useTimeTracker();
  const { pathname } = useLocation();
  const prevPath = useRef<string | null>(null);
  useEffect(() => {
    if (prevPath.current !== null && prevPath.current !== pathname) haptics.selection();
    prevPath.current = pathname;
  }, [pathname]);

  return (
    <nav
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(94vw,420px)] z-40"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {active && (
        <div className="mb-2 mx-auto w-max max-w-full px-3 py-1.5 rounded-full bg-background/72 backdrop-blur-xl border border-primary/22 shadow-card flex items-center gap-2 fade-in ring-1 ring-black/[0.04] dark:ring-white/[0.05]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
            <span className="relative h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-[11px] text-secondary-fg">Tracking</span>
          <span className="text-[12px] font-mono-sf tabular-nums text-foreground">{fmtHMS(elapsedSec)}</span>
        </div>
      )}
      <div className="bg-background/[0.68] backdrop-blur-2xl border border-border/45 rounded-[22px] shadow-tab flex items-center px-1 py-1 ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
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
        `relative flex min-h-[46px] flex-col items-center justify-center gap-0.5 flex-1 rounded-[14px] py-1.5 px-0.5 pressable transition-all duration-200 ${
          isActive
            ? "bg-primary/[0.12] text-primary shadow-[inset_0_1px_0_rgba(15,23,42,0.06)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
            : "text-secondary-fg hover:text-foreground/90 hover:bg-foreground/[0.03]"
        }`
      }
      aria-label={label}
    >
      {({ isActive }) => (
        <>
          <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
          <span className="max-w-full truncate px-0.5 text-center text-[9px] font-semibold leading-tight tracking-tight">
            {label}
          </span>
          {pulse && <span className="absolute right-[18%] top-1 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />}
        </>
      )}
    </NavLink>
  );
}
