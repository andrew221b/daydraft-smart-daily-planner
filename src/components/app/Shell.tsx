import { ReactNode, useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { TabBar } from "./TabBar";
import { TimerRescheduleSheet } from "./TimerRescheduleSheet";

/** Routes that sit one level deeper than the tab bar — drill-ins. */
const DRILL_IN_PREFIXES = ["/focus", "/today/plan", "/settings/delete-account"];

export const Shell = ({
  children,
  hideTabBar = false,
  hideQuickCapture = false,
}: {
  children: ReactNode;
  hideTabBar?: boolean;
  /** @deprecated kept for API compatibility — quick capture UI was removed. */
  hideQuickCapture?: boolean;
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

  // Warm every lazy route chunk shortly after the current page paints.
  // The previous implementation used `requestIdleCallback` with a 5000ms
  // timeout — on slow phones the prefetch could land *after* the user
  // tapped another tab, so they'd hit the lazy-load spinner every time.
  // 150ms after mount is short enough that the chunks usually arrive
  // before the first tab switch, long enough that the current page's
  // queries and layout still get the network window to themselves.
  useEffect(() => {
    const t = setTimeout(() => {
      void import("@/pages/app/DayView");
      void import("@/pages/app/Focus");
      void import("@/pages/app/Home");
      void import("@/pages/app/Tracker");
      void import("@/pages/app/Reports");
      void import("@/pages/app/Settings");
    }, 150);
    return () => clearTimeout(t);
  }, []);

  return (
  <div className="min-h-screen w-full bg-background flex justify-center">
    <div
      className="pointer-events-none fixed inset-x-0 top-0 h-[min(220px,38vh)] z-0 shell-glow-top shell-glow-breathe"
      aria-hidden
    />
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 h-[min(300px,42vh)] z-0 shell-glow-floor shell-glow-breathe"
      aria-hidden
    />
    <div className="relative z-10 w-full max-w-[440px] min-h-screen flex flex-col px-1.5">
      <div
        className="pointer-events-none absolute inset-x-0 top-2 h-32 rounded-[24px] opacity-55"
        style={{ background: "radial-gradient(70% 70% at 50% 0%, hsl(var(--primary) / 0.11), transparent 72%)" }}
        aria-hidden
      />
      <main
        // Keying by pathname forces a remount on each route change so the
        // CSS keyframe replays. Without this the same <main> persists
        // across routes and the iOS-style slide never fires.
        key={pathname}
        className={`flex min-h-0 flex-1 flex-col ${hideTabBar ? "" : "pb-32"} ${pageTransitionClass}`}
      >
        {children}
      </main>
      {!hideTabBar && <TabBar />}
      <TimerRescheduleSheet />
    </div>
  </div>
  );
};
