import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { TabBar } from "./TabBar";
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
    : pathname.startsWith("/today") || pathname.startsWith("/home")
      ? "page-switch-luxe page-switch-left"
      : "page-switch-luxe";

  // Warm lazy route chunks after first paint — same module paths as App.tsx lazy().
  useEffect(() => {
    const prefetchNeighbors = () => {
      void import("@/pages/app/DayView");
      void import("@/pages/app/Focus");
      void import("@/pages/app/Home");
      void import("@/pages/app/Tracker");
      void import("@/pages/app/Reports");
      void import("@/pages/app/Settings");
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
      className="pointer-events-none fixed inset-x-0 top-0 h-[min(220px,38vh)] z-0 shell-glow-top shell-glow-breathe"
      aria-hidden
    />
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 h-[min(300px,42vh)] z-0 shell-glow-floor"
      aria-hidden
    />
    <div className="relative z-10 w-full max-w-[440px] min-h-screen flex flex-col px-1.5">
      <div
        className="pointer-events-none absolute inset-x-0 top-2 h-32 rounded-[24px] opacity-55"
        style={{ background: "radial-gradient(70% 70% at 50% 0%, hsl(var(--primary) / 0.11), transparent 72%)" }}
        aria-hidden
      />
      <main
        className={`flex min-h-0 flex-1 flex-col ${hideTabBar ? "" : "pb-32"} page-enter ${pageSwitchClass}`}
      >
        {children}
      </main>
      {!hideTabBar && <TabBar />}
      <TimerRescheduleSheet />
    </div>
  </div>
  );
};
