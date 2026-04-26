import { NavLink } from "react-router-dom";
import { Sun, History as HistoryIcon, BarChart3, Settings, TimerReset } from "lucide-react";
import { useTimeTracker } from "@/hooks/useTimeTracker";

const items = [
  { to: "/today", icon: Sun, tour: "tab-today" },
  { to: "/history", icon: HistoryIcon, tour: "tab-history" },
  { to: "/stats", icon: BarChart3, tour: "tab-stats" },
  { to: "/settings", icon: Settings, tour: "tab-settings" },
];

export const TabBar = () => {
  const { active } = useTimeTracker();

  return (
    <>
      {/* Active-session ribbon was here — removed at user request. The
          tracker tab itself shows a small pulse dot when running, which is
          enough signal without a full bar covering the bottom of the page. */}
      <nav
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-40"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-4 mb-4 rounded-2xl bg-surface-elevated/90 backdrop-blur border border-border shadow-card flex items-center justify-around py-3">
          {items.slice(0, 2).map(({ to, icon: Icon, tour }) => (
            <NavLink key={to} to={to} data-tour={tour} className={({ isActive }) =>
              `relative flex flex-col items-center justify-center min-w-[44px] min-h-[44px] pressable ${isActive ? "text-primary" : "text-secondary-fg"}`}>
              {({ isActive }) => (
                <>
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                  {isActive && <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
                </>
              )}
            </NavLink>
          ))}

          <NavLink
            to="/tracker"
            data-tour="tracker"
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center min-w-[44px] min-h-[44px] pressable ${isActive || active ? "text-primary" : "text-secondary-fg"}`
            }
            aria-label="Time tracker"
          >
            {({ isActive }) => (
              <>
                <TimerReset className="h-5 w-5" strokeWidth={2.2} />
                {active && <span className="absolute top-0 right-1 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
                {isActive && <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
              </>
            )}
          </NavLink>

          {items.slice(2).map(({ to, icon: Icon, tour }) => (
            <NavLink key={to} to={to} data-tour={tour} className={({ isActive }) =>
              `relative flex flex-col items-center justify-center min-w-[44px] min-h-[44px] pressable ${isActive ? "text-primary" : "text-secondary-fg"}`}>
              {({ isActive }) => (
                <>
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                  {isActive && <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
};
