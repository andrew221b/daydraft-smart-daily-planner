import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Timer, BarChart2, Settings as SettingsIcon } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed } from "@/hooks/useTimeTracker";
import { haptics } from "@/lib/haptics";

const tabs = [
  { to: "/today", icon: Home, label: "Today", tour: "tab-today" },
  { to: "/tracker", icon: Timer, label: "Timer", tour: "tab-tracker" },
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
  const [prevIdx, setPrevIdx] = useState(activeIdx);
  const [travelDir, setTravelDir] = useState<"left" | "right" | null>(null);
  const moveDir = travelDir === "right" ? "tab-indicator-move-right" : travelDir === "left" ? "tab-indicator-move-left" : "";
  const trackerLabel = active ? fmtMMSS(elapsedSec) : "Timer";

  useEffect(() => {
    if (prevPath.current !== null && prevPath.current !== pathname) haptics.selection();
    prevPath.current = pathname;
    const dir = activeIdx > prevIdx ? "right" : activeIdx < prevIdx ? "left" : null;
    if (dir) {
      setTravelDir(dir);
      const id = window.setTimeout(() => setTravelDir(null), 520);
      setPrevIdx(activeIdx);
      return () => window.clearTimeout(id);
    }
    setPrevIdx(activeIdx);
  }, [pathname, activeIdx, prevIdx]);

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(calc(100vw-20px),420px)] z-40"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
    >
      <div className="relative rounded-[24px] p-[1px] tabbar-shell-glow">
        <div className="relative bg-background/[0.72] backdrop-blur-2xl border border-soft rounded-[23px] shadow-tab flex items-center px-1 py-1 ring-1 ring-black/[0.04] dark:ring-white/[0.1] overflow-hidden tabbar-luxe">
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1 bottom-1 left-1 rounded-[14px] tab-indicator-liquid-trail ${moveDir}`}
            style={{
              width: "calc((100% - 8px) / 4)",
              transform: `translate3d(${activeIdx * 100}%, 0, 0)`,
            }}
          />
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1 bottom-1 rounded-[14px] border border-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_22px_-10px_hsl(var(--primary)/0.52)] tab-indicator-luxe tab-indicator-liquid ${moveDir}`}
            style={{
              background: "linear-gradient(132deg, hsl(var(--primary) / 0.3), hsl(var(--primary-glow) / 0.24))",
              left: "4px",
              width: "calc((100% - 8px) / 4)",
              transform: `translate3d(${activeIdx * 100}%, 0, 0)`,
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
          <Icon className={`h-[18px] w-[18px] transition-transform duration-300 ${isActive ? "scale-110 -translate-y-[0.5px]" : "scale-100"}`} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
          <span className={`max-w-full truncate px-0.5 text-center text-[10px] font-semibold leading-tight tracking-tight transition-all duration-300 ${isActive ? "opacity-100 translate-y-0" : "opacity-90 translate-y-[0.5px]"}`}>
            {label}
          </span>
          {pulse && <span className="absolute left-1/2 -translate-x-1/2 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan-300 tab-live-dot-pulse" aria-hidden />}
        </>
      )}
    </NavLink>
  );
}
