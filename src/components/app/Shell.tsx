import { ReactNode, useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { TabBar } from "./TabBar";
import { TimerRescheduleSheet } from "./TimerRescheduleSheet";

/** Routes that sit one level deeper than the tab bar — drill-ins. */
const DRILL_IN_PREFIXES = ["/focus", "/today/plan", "/settings/delete-account"];

export const Shell = ({
  children,
  hideTabBar = false,
}: {
  children: ReactNode;
  hideTabBar?: boolean;
}) => {
  const { pathname } = useLocation();
  const navType = useNavigationType();

  // iOS UIKit-style nav transitions:
  //   • Tab → Tab: cross-fade (UITabBarController never slides).
  //   • Tab → drill-in (e.g. tap a task → Focus): PUSH, slide in from
  //     the right.
  //   • Drill-in → tab (back button, swipe-back, browser history pop):
  //     POP, slide in from the left.
  // useNavigationType() is "POP" for any history.back / forward-button
  // / browser-history navigation, regardless of where you're coming
  // from. "PUSH" / "REPLACE" cover navigate(...) calls and Link clicks.
  const isDrillIn = DRILL_IN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const pageTransitionClass =
    navType === "POP"
      ? "page-transition-pop"
      : isDrillIn
        ? "page-transition-push"
        : "page-transition-tab";

  // Route chunks are eagerly preloaded by <EagerPrefetcher /> at app mount,
  // so no Shell-level prefetch is needed here. Kept intentionally empty to
  // make the dependency obvious to future readers.


  return (
  <div className="h-[100dvh] w-full bg-background flex justify-center overflow-hidden">
    {/* Ambient glow layers — behind content (z-0) */}
    <div
      className="pointer-events-none fixed inset-x-0 top-0 h-[min(220px,38vh)] z-0 shell-glow-top shell-glow-breathe"
      aria-hidden
    />
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 h-[min(300px,42vh)] z-0 shell-glow-floor shell-glow-breathe"
      aria-hidden
    />

    {/* Edge chrome — above content (z-[18]), below tab bar (z-40) */}
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[18] shell-edge-top"
      aria-hidden
    />

    <div className="relative z-10 w-full max-w-[440px] h-full flex flex-col px-1.5">
      <div
        className="pointer-events-none absolute inset-x-0 top-2 h-32 rounded-[24px] opacity-55"
        style={{ background: "radial-gradient(70% 70% at 50% 0%, hsl(var(--primary) / 0.11), transparent 72%)" }}
        aria-hidden
      />
      <main
        className={`relative min-h-0 flex-1 w-full ${pageTransitionClass}`}
      >
        {children}
      </main>
      {!hideTabBar && <TabBar />}
      <TimerRescheduleSheet />
    </div>
  </div>
  );
};
