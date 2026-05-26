import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
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

const TAB_ORDER: Record<TabKey, number> = {
  home: 0, day: 1, tracker: 2, reports: 3, settings: 4,
};

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

  // Imperatively re-apply the directional animation class to the now-active
  // tab so keyframes restart every time. Direction is forward (fwd) when the
  // user taps a tab to the right of the current one, backward (back) if left.
  const tabRefs = useRef<Map<TabKey, HTMLDivElement>>(new Map());
  const prevKeyRef = useRef<TabKey | null>(null);

  useEffect(() => {
    if (!activeKey) return;
    const el = tabRefs.current.get(activeKey);
    if (!el) return;
    el.scrollTop = 0;

    const prev = prevKeyRef.current;
    const cls =
      prev === null || TAB_ORDER[activeKey] > TAB_ORDER[prev]
        ? "page-transition-tab-fwd"
        : "page-transition-tab-back";
    prevKeyRef.current = activeKey;

    el.classList.remove("page-transition-tab", "page-transition-tab-fwd", "page-transition-tab-back");
    void el.offsetWidth;
    el.classList.add(cls);
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
            ref={(el) => {
              if (el) tabRefs.current.set(tab.key, el);
              else tabRefs.current.delete(tab.key);
            }}
            className={`absolute inset-0 overflow-y-auto overscroll-y-contain no-scrollbar ${isActive ? "" : "hidden"}`}
            aria-hidden={!isActive}
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
          >
            <TabVisibilityCtx.Provider value={isActive}>
              <div className="min-h-full flex flex-col">
                <Suspense fallback={null}>
                  <Component />
                </Suspense>
              </div>
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
