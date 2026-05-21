import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { useLocation } from "react-router-dom";
import { lazyWithReload } from "@/lib/lazyWithReload";

/**
 * Native-iOS-style tab persistence: every tab page mounts once on first visit
 * and stays mounted afterwards. Switching tabs only toggles which tree is
 * visible (`display: none` for inactive). This preserves scroll position,
 * expanded/collapsed UI state, and — most importantly — eliminates the
 * unmount/remount cycle that was causing the remaining flicker.
 *
 * Trade-off: a few extra trees stay in the DOM. This is the standard pattern
 * UITabBarController uses (each tab view stays alive across switches), and
 * the React Query cache means the data layer is also stable.
 */

type TabKey = "home" | "day" | "tracker" | "reports" | "settings";

type TabDef = {
  key: TabKey;
  matches: (pathname: string) => boolean;
  load: () => Promise<{ default: ComponentType<unknown> }>;
};

const TABS: TabDef[] = [
  {
    key: "home",
    matches: (p) => p === "/" || p === "/home" || p.startsWith("/home/"),
    load: () => import("@/pages/app/Home"),
  },
  {
    key: "day",
    matches: (p) => p === "/today" || p.startsWith("/today/"),
    load: () => import("@/pages/app/DayView"),
  },
  {
    key: "tracker",
    matches: (p) => p === "/tracker" || p.startsWith("/tracker/"),
    load: () => import("@/pages/app/Tracker"),
  },
  {
    key: "reports",
    matches: (p) => p === "/reports" || p.startsWith("/reports/"),
    load: () => import("@/pages/app/Reports"),
  },
  {
    key: "settings",
    matches: (p) => p === "/settings",
    load: () => import("@/pages/app/Settings"),
  },
];

const LazyComponents: Record<TabKey, ComponentType<unknown>> = {
  home: lazyWithReload(() => import("@/pages/app/Home")),
  day: lazyWithReload(() => import("@/pages/app/DayView")),
  tracker: lazyWithReload(() => import("@/pages/app/Tracker")),
  reports: lazyWithReload(() => import("@/pages/app/Reports")),
  settings: lazyWithReload(() => import("@/pages/app/Settings")),
};

export function matchedTabKey(pathname: string): TabKey | null {
  for (const tab of TABS) {
    if (tab.matches(pathname)) return tab.key;
  }
  return null;
}

/**
 * Lets a tab page know whether its tree is the active one. Pages can use this
 * to pause expensive intervals (poll loops, "now" tickers) while inactive —
 * the tree stays alive, but the work pauses.
 */
const TabVisibilityCtx = createContext<boolean>(true);
export function useTabVisible(): boolean {
  return useContext(TabVisibilityCtx);
}

export function PersistentTabs() {
  const { pathname } = useLocation();
  const activeKey = useMemo(() => matchedTabKey(pathname), [pathname]);

  // Lazy-mount: a tab only enters the DOM the first time it is visited.
  // After that, it stays mounted forever (within this Shell lifecycle).
  const [mounted, setMounted] = useState<Set<TabKey>>(() => {
    return new Set(activeKey ? [activeKey] : []);
  });

  useEffect(() => {
    if (!activeKey) return;
    setMounted((prev) => {
      if (prev.has(activeKey)) return prev;
      const next = new Set(prev);
      next.add(activeKey);
      return next;
    });
  }, [activeKey]);

  return (
    <>
      {TABS.map((tab) => {
        if (!mounted.has(tab.key)) return null;
        const Component = LazyComponents[tab.key];
        const isActive = activeKey === tab.key;
        return (
          <div
            key={tab.key}
            // `display:none` keeps the React tree + DOM nodes + scroll
            // position alive, but releases the inactive tab from paint and
            // layout. The active tab takes the full main column.
            className={`flex min-h-0 flex-1 flex-col ${isActive ? "" : "hidden"}`}
            aria-hidden={!isActive}
          >
            <TabVisibilityCtx.Provider value={isActive}>
              <Suspense fallback={null}>
                <Component />
              </Suspense>
            </TabVisibilityCtx.Provider>
          </div>
        );
      })}
    </>
  );
}

/**
 * Tells callers whether a path is one of the persistent tab routes — used by
 * route config to decide whether to drop through to ShellLayout (tab) or
 * render a standalone page (drill-in).
 */
export const PERSISTENT_TAB_PATHS = [
  "/home",
  "/today",
  "/today/plan",
  "/tracker",
  "/reports",
  "/settings",
] as const;
