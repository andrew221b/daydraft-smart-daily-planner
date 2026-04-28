import { NavLink } from "react-router-dom";
import { LayoutGrid, Clock3, BarChart2, Settings as SettingsIcon } from "lucide-react";
import { useTimeTracker } from "@/hooks/useTimeTracker";

const tabs = [
  { to: "/today", icon: LayoutGrid, label: "Today", tour: "tab-today" },
  { to: "/history", icon: Clock3, label: "History", tour: "tab-history" },
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
        {tabs.map((it) => (
          <TabItem key={it.to} {...it} pulse={it.to === "/today" && active} />
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
        `relative flex flex-col items-center justify-center flex-1 min-h-[48px] gap-0.5 pressable ${
          isActive ? "text-primary" : "text-secondary-fg hover:text-foreground"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          <span className="text-[10px] tracking-tight leading-none mt-0.5">{label}</span>
          {pulse && <span className="absolute top-1 right-[28%] h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
          {isActive && <span className="absolute -bottom-1.5 h-[3px] w-6 rounded-full bg-primary" />}
        </>
      )}
    </NavLink>
  );
}
