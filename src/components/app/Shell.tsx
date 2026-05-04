import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { TabBar } from "./TabBar";
import { useAuth } from "@/hooks/useAuth";

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
  const { user } = useAuth();
  const { pathname } = useLocation();

  const pageSwitchClass = pathname.startsWith("/today/plan")
    ? "page-switch-luxe page-switch-right"
    : pathname.startsWith("/today")
      ? "page-switch-luxe page-switch-left"
      : "page-switch-luxe";

  return (
  <div className="min-h-screen w-full bg-background flex justify-center">
    <div
      className="pointer-events-none fixed inset-x-0 top-0 h-[min(240px,42vh)] z-0 shell-glow-top shell-glow-breathe"
      aria-hidden
    />
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 h-[min(320px,48vh)] z-0 shell-glow-floor opacity-[0.85]"
      aria-hidden
    />
    <div className="relative z-10 w-full max-w-[440px] min-h-screen flex flex-col px-1.5">
      <main className={`flex-1 ${hideTabBar ? "" : "pb-32"} page-enter ${pageSwitchClass}`}>{children}</main>
      {!hideTabBar && <TabBar />}
    </div>
  </div>
  );
};
