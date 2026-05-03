import { NavLink } from "react-router-dom";
import { Home, Timer, Clock3, BarChart2, Settings as SettingsIcon } from "lucide-react";
import { useTimeTracker, fmtHMS } from "@/hooks/useTimeTracker";

const tabs = [
  { to: "/today", icon: Home, label: "Today", tour: "tab-today" },
  { to: "/tracker", icon: Timer, label: "Timer", tour: "tab-tracker" },
  { to: "/history", icon: BarChart2, label: "Insights", tour: "tab-history" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", tour: "tab-settings" },
];

export const TabBar = () => {
  const { active, elapsedSec } = useTimeTracker();

  return (
    <nav
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(94vw,420px)] z-40"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {active && (
        <div className="mb-2 mx-auto w-max max-w-full px-3 py-1 rounded-full bg-surface-elevated/90 backdrop-blur-xl border border-primary/40 shadow-glow flex items-center gap-2 fade-in">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
            <span className="relative h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-[11px] text-secondary-fg">Tracking</span>
          <span className="text-[12px] font-mono-sf tabular-nums text-foreground">{fmtHMS(elapsedSec)}</span>
        </div>
      )}
      <div className="bg-surface-elevated/85 backdrop-blur-xl border border-border rounded-full shadow-elevated flex items-center px-1.5 py-1.5">
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
        `relative flex items-center justify-center flex-1 h-10 rounded-full pressable transition-colors ${
          isActive ? "bg-primary/12 text-primary" : "text-secondary-fg hover:text-foreground"
        }`
      }
      aria-label={label}
    >
      {({ isActive }) => (
        <>
          <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
          {pulse && <span className="absolute top-2 right-[34%] h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
        </>
      )}
    </NavLink>
  );
}
