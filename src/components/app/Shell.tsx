import { ReactNode } from "react";
import { TabBar } from "./TabBar";

export const Shell = ({ children, hideTabBar = false }: { children: ReactNode; hideTabBar?: boolean }) => (
  <div className="min-h-screen w-full bg-background flex justify-center">
    {/* Soft top vignette — barely-there mood, no blobs */}
    <div className="pointer-events-none fixed inset-x-0 top-0 h-[280px] z-0"
         style={{ background: "var(--gradient-glow)" }} />
    <div className="relative z-10 w-full max-w-[440px] min-h-screen flex flex-col">
      <main className={`flex-1 ${hideTabBar ? "" : "pb-32"} page-enter`}>{children}</main>
      {!hideTabBar && <TabBar />}
    </div>
  </div>
);
