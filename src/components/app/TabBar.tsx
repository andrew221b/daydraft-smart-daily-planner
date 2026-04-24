import { NavLink } from "react-router-dom";
import { Sun, CalendarDays, BarChart3, Settings, Hourglass } from "lucide-react";
import { useTimeTracker, fmtHMS } from "@/hooks/useTimeTracker";

const items = [
  { to: "/today", icon: Sun, tour: "tab-today" },
  { to: "/history", icon: CalendarDays, tour: "tab-history" },
  { to: "/stats", icon: BarChart3, tour: "tab-stats" },
  { to: "/settings", icon: Settings, tour: "tab-settings" },
];

export const TabBar = () => {
  const { active, elapsedSec, stop } = useTimeTracker();

  return (
    <>
      {/* Compact active-session ribbon — slim line just above the tab bar so
          it never overlaps page content. The whole thing taps through to the
          /tracker page; Stop is a separate target. */}
      {active && (
        <div className="fixed bottom-[76px] left-1/2 -translate-x-1/2 w-full max-w-[390px] z-30 pointer-events-none">
          <div className="mx-4 pointer-events-auto flex items-center gap-2 px-3 h-8 rounded-full bg-primary/95 text-primary-foreground border border-primary/40 shadow-glow">
            <NavLink to="/tracker" className="flex-1 flex items-center gap-2 min-w-0 text-left">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary-foreground" />
              </span>
              <span className="text-[11px] font-medium truncate flex-1">Tracking</span>
              <span className="text-[11px] font-mono tabular-nums">{fmtHMS(elapsedSec)}</span>
            </NavLink>
            <button
              onClick={() => stop()}
              className="text-[10px] font-semibold uppercase tracking-wide pressable shrink-0 px-1"
              aria-label="Stop tracking"
            >
              Stop
            </button>
          </div>
        </div>
      )}

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
                <Hourglass className="h-5 w-5" strokeWidth={2.2} />
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
