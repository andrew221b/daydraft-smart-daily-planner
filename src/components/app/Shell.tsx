import { ReactNode } from "react";
import { TabBar } from "./TabBar";
import { InstallPrompt } from "./InstallPrompt";

export const Shell = ({ children, hideTabBar = false }: { children: ReactNode; hideTabBar?: boolean }) => (
  <div className="min-h-screen w-full bg-background flex justify-center">
    <div className="relative w-full max-w-[390px] min-h-screen flex flex-col bg-background">
      <main className={`flex-1 ${hideTabBar ? "" : "pb-24"} page-enter`}>{children}</main>
      {!hideTabBar && <TabBar />}
      <InstallPrompt />
    </div>
  </div>
);
