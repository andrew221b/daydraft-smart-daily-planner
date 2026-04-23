import { NavLink } from "react-router-dom";
import { Sun, CalendarDays, BarChart3, Settings, Hourglass } from "lucide-react";
import { useTimeTracker, fmtHMS } from "@/hooks/useTimeTracker";
import { useState } from "react";
import { TrackerSheet } from "./TrackerPill";

const items = [
  { to: "/today", icon: Sun, tour: "tab-today" },
  { to: "/history", icon: CalendarDays, tour: "tab-history" },
  { to: "/stats", icon: BarChart3, tour: "tab-stats" },
  { to: "/settings", icon: Settings, tour: "tab-settings" },
];

export const TabBar = () => {
  const { active, elapsedSec, stop } = useTimeTracker();
  const [trackerOpen, setTrackerOpen] = useState(false);

  return (
    <>
      {/* Active timer strip — sits above tab bar, doesn't overlap content.
          We use a div+two-buttons (not nested <button>) for valid HTML and
          to give Stop a clean independent target without event-bubbling hacks. */}
      {active && (
        <div className="fixed bottom-[88px] left-1/2 -translate-x-1/2 w-full max-w-[390px] z-40 pointer-events-none">
          <div className="mx-4 pointer-events-auto">
            <div className="w-full flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary/95 text-primary-foreground border border-primary/40 shadow-glow backdrop-blur">
              <button
                onClick={() => setTrackerOpen(true)}
                className="flex-1 flex items-center gap-2 min-w-0 pressable text-left"
                aria-label="Open time tracker"
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-foreground" />
                </span>
                <span className="text-xs font-medium truncate flex-1">Tracking</span>
                <span className="text-xs font-mono tabular-nums">{fmtHMS(elapsedSec)}</span>
              </button>
              <button
                onClick={() => stop()}
                className="px-2 py-0.5 rounded-md bg-primary-foreground/20 text-[10px] font-semibold uppercase tracking-wide pressable shrink-0"
                aria-label="Stop tracking"
              >
                Stop
              </button>
            </div>
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

          <button
            onClick={() => setTrackerOpen(true)}
            data-tour="tracker"
            className={`relative flex flex-col items-center justify-center min-w-[44px] min-h-[44px] pressable ${active ? "text-primary" : "text-secondary-fg"}`}
            aria-label="Time tracker"
          >
            <Hourglass className="h-5 w-5" strokeWidth={2.2} />
            {active && <span className="absolute top-0 right-1 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
          </button>

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

      <TrackerSheet open={trackerOpen} onOpenChange={setTrackerOpen} />
    </>
  );
};
