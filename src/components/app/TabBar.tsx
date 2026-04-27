import { NavLink } from "react-router-dom";
import { LayoutGrid, Clock3, BarChart2, Settings as SettingsIcon, Timer } from "lucide-react";
import { useTimeTracker } from "@/hooks/useTimeTracker";

const left = [
  { to: "/today", icon: LayoutGrid, label: "Today", tour: "tab-today" },
  { to: "/history", icon: Clock3, label: "History", tour: "tab-history" },
];
const right = [
  { to: "/stats", icon: BarChart2, label: "Stats", tour: "tab-stats" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", tour: "tab-settings" },
];

export const TabBar = () => {
  const { active } = useTimeTracker();

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-40 bg-background/85 backdrop-blur-xl border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch justify-between px-2 pt-1.5 pb-1.5">
        {left.map((it) => (
          <TabItem key={it.to} {...it} />
        ))}
        <NavLink
          to="/tracker"
          data-tour="tracker"
          aria-label="Time tracker"
          className={({ isActive }) =>
            `group relative flex flex-col items-center justify-center flex-1 min-h-[48px] gap-0.5 pressable ${
              isActive || active ? "text-primary" : "text-secondary-fg hover:text-foreground"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Timer className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span className="text-[10px] tracking-tight leading-none mt-0.5">Tracker</span>
              {active && (
                <span className="absolute top-1 right-[28%] h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              )}
              {isActive && <span className="absolute -bottom-1.5 h-[3px] w-6 rounded-full bg-primary" />}
            </>
          )}
        </NavLink>
        {right.map((it) => (
          <TabItem key={it.to} {...it} />
        ))}
      </div>
    </nav>
  );
};

function TabItem({ to, icon: Icon, label, tour }: { to: string; icon: any; label: string; tour: string }) {
  return (
    <NavLink
      to={to}
      data-tour={tour}
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-center flex-1 min-h-[48px] gap-0.5 pressable ${
          isActive ? "text-primary" : "text-secondary-fg hover:text-foreground"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          <span className="text-[10px] tracking-tight leading-none mt-0.5">{label}</span>
          {isActive && <span className="absolute -bottom-1.5 h-[3px] w-6 rounded-full bg-primary" />}
        </>
      )}
    </NavLink>
  );
}
