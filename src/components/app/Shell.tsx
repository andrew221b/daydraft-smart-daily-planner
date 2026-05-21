import { ReactNode } from "react";
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

  // iOS UIKit-style nav transitions, but only when Shell itself mounts —
  // i.e. coming back from a drill-in (Focus), or first paint after auth.
  //
  // Tab → Tab navigation never remounts Shell anymore (PersistentTabs keeps
  // every tab alive and toggles visibility), so we deliberately do NOT key
  // the main element by pathname. That was the source of the remaining
  // tab-switch flicker — main was re-mounting on every tab tap, replaying
  // the fade keyframe and tearing down the page tree only to rebuild it
  // from cache one tick later.
  const isDrillIn = DRILL_IN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const pageTransitionClass =
    navType === "POP"
      ? "page-transition-pop"
      : isDrillIn
        ? "page-transition-push"
        : "page-transition-tab";

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
