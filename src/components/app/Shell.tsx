import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { TabBar } from "./TabBar";
import { syncPremiumHtmlAttributes } from "@/lib/syncHtmlPreferences";
import { PlanDriftNudge } from "./PlanDriftNudge";
import { TimerRescheduleSheet } from "./TimerRescheduleSheet";

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

  const pageSwitchClass = pathname.startsWith("/today/plan")
    ? "page-switch-luxe page-switch-right"
    : pathname.startsWith("/today")
      ? "page-switch-luxe page-switch-left"
      : "page-switch-luxe";

  useEffect(() => {
    syncPremiumHtmlAttributes();
  }, []);

  // Warm lazy route chunks after first paint — same module paths as App.tsx lazy().
  useEffect(() => {
    const prefetchNeighbors = () => {
      void import("@/pages/app/Planning");
      void import("@/pages/app/DayView");
      void import("@/pages/app/Focus");
      void import("@/pages/app/Tracker");
      void import("@/pages/app/History");
      void import("@/pages/app/Settings");
      void import("@/pages/app/Recap");
      void import("@/pages/app/RecapWeek");
    };
    let idleHandle: ReturnType<typeof requestIdleCallback> | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback !== "undefined") {
      idleHandle = requestIdleCallback(prefetchNeighbors, { timeout: 5000 });
    } else {
      t = setTimeout(prefetchNeighbors, 350);
    }
    return () => {
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (t !== undefined) clearTimeout(t);
    };
  }, []);

  return (
  <div className="min-h-screen w-full bg-background flex justify-center">
    <div
      className="pointer-events-none fixed inset-x-0 top-0 h-[min(260px,44vh)] z-0 shell-glow-top shell-glow-breathe"
      aria-hidden
    />
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 h-[min(360px,52vh)] z-0 shell-glow-floor opacity-[0.95]"
      aria-hidden
    />
    <div className="relative z-10 w-full max-w-[440px] min-h-screen flex flex-col px-1.5">
      <div
        className="pointer-events-none absolute inset-x-0 top-2 h-40 rounded-[28px] opacity-70"
        style={{ background: "radial-gradient(70% 70% at 50% 0%, hsl(var(--primary) / 0.18), transparent 72%)" }}
        aria-hidden
      />
      <main className={`flex-1 ${hideTabBar ? "" : "pb-32"} page-enter ${pageSwitchClass}`}>{children}</main>
      {!hideTabBar && <TabBar />}
      <PlanDriftNudge />
      <TimerRescheduleSheet />
    </div>
  </div>
  );
};
