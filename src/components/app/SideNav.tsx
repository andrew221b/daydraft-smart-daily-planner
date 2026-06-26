import { memo, useEffect, useState, useTransition } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { haptics } from "@/lib/haptics";
import type { LucideIcon } from "lucide-react";
import { tabs, activeTabIndex } from "./TabBar";

/**
 * iPad / large-screen primary navigation. Mirrors the phone <TabBar /> (same
 * routes, same prefetch + transition-navigation behaviour that keeps the
 * current screen responsive while a heavy tab mounts) but laid out as a left
 * rail: an icon-only rail on iPad portrait (md), expanding to a full
 * icon+label sidebar on landscape / large screens (lg). Hidden on phones,
 * where the bottom TabBar takes over (`hidden md:flex`).
 */
export const SideNav = memo(function SideNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [, startNav] = useTransition();

  const activeIdx = activeTabIndex(pathname);
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const displayIdx = pendingIdx ?? activeIdx;

  useEffect(() => { setPendingIdx(null); }, [pathname]);

  const selectTab = (idx: number, to: string) => {
    if (idx === activeIdx) return;
    setPendingIdx(idx);
    haptics.selection();
    startNav(() => {
      navigate(to);
    });
  };

  return (
    <nav
      aria-label="Primary"
      className="hidden md:flex shrink-0 flex-col md:w-[88px] lg:w-[244px] h-full z-20 border-r border-border/60 bg-background/40 backdrop-blur-xl"
      style={{
        paddingTop: "max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)), 18px)",
        paddingBottom: "max(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 18px)",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 h-14 px-4 lg:px-5 shrink-0 md:justify-center lg:justify-start">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-white font-display font-bold text-[18px] shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.7)]"
          style={{ background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.78) 100%)" }}
          aria-hidden
        >
          D
        </span>
        <span className="hidden lg:block font-display text-[19px] font-semibold tracking-tight text-foreground">
          DayDraft
        </span>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-1.5 px-3 lg:px-4 mt-3">
        {tabs.map((it, idx) => (
          <SideItem
            key={it.to}
            to={it.to}
            icon={it.icon}
            label={it.label}
            tour={it.tour}
            prefetch={it.prefetch}
            highlighted={displayIdx === idx}
            onSelect={() => selectTab(idx, it.to)}
          />
        ))}
      </div>
    </nav>
  );
});

const SideItem = memo(function SideItem({
  to,
  icon: Icon,
  label,
  tour,
  prefetch,
  highlighted,
  onSelect,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  tour: string;
  prefetch: () => Promise<unknown>;
  highlighted: boolean;
  onSelect: () => void;
}) {
  const warmRoute = () => { void prefetch(); };
  return (
    <NavLink
      to={to}
      data-tour={tour}
      onClick={(e) => { e.preventDefault(); onSelect(); }}
      onPointerDown={warmRoute}
      onTouchStart={warmRoute}
      onFocus={warmRoute}
      aria-label={label}
      aria-current={highlighted ? "page" : undefined}
      title={label}
      style={{ WebkitTapHighlightColor: "transparent" }}
      className={`group relative flex h-12 items-center gap-3 rounded-2xl px-3 lg:px-3.5 md:justify-center lg:justify-start transition-colors duration-200 active:opacity-70 ${
        highlighted
          ? "bg-primary/[0.16] ring-1 ring-inset ring-primary/30 text-primary shadow-[0_6px_22px_-12px_hsl(var(--primary)/0.6)] dark:bg-primary/[0.2] dark:ring-primary/[0.36]"
          : "text-secondary-fg hover:text-foreground hover:bg-foreground/[0.05]"
      }`}
    >
      <Icon
        className="h-[20px] w-[20px] shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.34,1.4,0.64,1)] group-hover:scale-[1.05]"
        strokeWidth={highlighted ? 2.2 : 1.85}
        aria-hidden
      />
      <span
        className={`hidden lg:block text-[14.5px] font-semibold tracking-tight ${
          highlighted ? "opacity-100" : "opacity-80"
        }`}
      >
        {label}
      </span>
    </NavLink>
  );
});
