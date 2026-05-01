import { NavLink } from "react-router-dom";
import { Home, Clock3, BarChart2, Settings as SettingsIcon } from "lucide-react";
import { useTimeTracker } from "@/hooks/useTimeTracker";

const tabs = [
  { to: "/today", icon: Home, label: "Today", tour: "tab-today" },
  { to: "/history", icon: Clock3, label: "History", tour: "tab-history" },
  { to: "/stats", icon: BarChart2, label: "Stats", tour: "tab-stats" },
  { to: "/settings", icon: SettingsIcon, label: "Settings", tour: "tab-settings" },
];

export const TabBar = () => {
  const { active } = useTimeTracker();

  return (
    <nav
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(92vw,360px)] z-40"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="bg-surface-elevated/85 backdrop-blur-xl border border-border rounded-full shadow-elevated flex items-center px-1.5 py-1.5">
        {tabs.map((it) => (
          <TabItem key={it.to} {...it} pulse={it.to === "/today" && !!active} />
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
