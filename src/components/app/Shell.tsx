import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { TabBar } from "./TabBar";
import { QuickCaptureButton } from "@/components/app/QuickCapture";
import { useAuth } from "@/hooks/useAuth";

export const Shell = ({
  children,
  hideTabBar = false,
  hideQuickCapture = false,
}: {
  children: ReactNode;
  hideTabBar?: boolean;
  /** Hide floating inbox (e.g. full-screen planning wait). */
  hideQuickCapture?: boolean;
}) => {
  const { user } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "c") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      window.dispatchEvent(new Event("dd-open-quick-capture"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showInbox =
    !!user &&
    !hideQuickCapture &&
    pathname !== "/auth" &&
    !pathname.startsWith("/onboarding") &&
    !pathname.startsWith("/today/plan") &&
    !pathname.startsWith("/history") &&
    !pathname.startsWith("/recap");
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
      {showInbox && (
        <div
          className="fixed top-[max(10px,env(safe-area-inset-top))] left-1/2 z-[45] flex w-[min(94vw,420px)] -translate-x-1/2 justify-end px-5 pointer-events-none"
        >
          <div className="pointer-events-auto flex items-start gap-1.5">
            <QuickCaptureButton />
          </div>
        </div>
      )}
      <main className={`flex-1 ${hideTabBar ? "" : "pb-32"} page-enter ${pageSwitchClass}`}>{children}</main>
      {!hideTabBar && <TabBar />}
    </div>
  </div>
  );
};
