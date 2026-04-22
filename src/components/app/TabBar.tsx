import { NavLink } from "react-router-dom";
import { Sun, Clock, BarChart3, Settings } from "lucide-react";

const items = [
  { to: "/today", icon: Sun },
  { to: "/history", icon: Clock },
  { to: "/stats", icon: BarChart3 },
  { to: "/settings", icon: Settings },
];

export const TabBar = () => (
  <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-40">
    <div className="mx-4 mb-4 rounded-2xl bg-surface-elevated/90 backdrop-blur border border-border shadow-card flex justify-around py-3">
      {items.map(({ to, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) =>
          `relative flex flex-col items-center justify-center w-12 h-10 pressable ${isActive ? "text-primary" : "text-secondary-fg"}`}>
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
);
