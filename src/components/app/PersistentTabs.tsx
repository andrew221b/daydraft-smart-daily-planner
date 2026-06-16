import { memo,
  createContext,
  startTransition,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { RouteErrorBoundary } from "@/components/app/RouteErrorBoundary";
import { ptMark } from "@/lib/perfTrace"; // TEMP perf trace

// TEMP perf trace: logs when a tab's tree commits + paints for the first time.
function MountTrace({ tabKey, children }: { tabKey: TabKey; children: ReactNode }) {
  useLayoutEffect(() => {
    ptMark(`MOUNT commit (layout) ${tabKey}`);
  }, [tabKey]);
  useEffect(() => {
    ptMark(`MOUNT painted (effect) ${tabKey}`);
  }, [tabKey]);
  return <>{children}</>;
}

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

type TabKey = "home" | "day" | "reports" | "settings";

const TAB_ORDER: Record<TabKey, number> = {
  home: 0, day: 1, reports: 2, settings: 3,
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


const MemoizedTab = memo(({ Component, tabKey }: { Component: ComponentType<unknown>; tabKey: TabKey }) => {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={null}>
        <MountTrace tabKey={tabKey}>
          <Component />
        </MountTrace>
      </Suspense>
    </RouteErrorBoundary>
  );
});

export function PersistentTabs() {
  const { pathname } = useLocation();
  const activeKey = useMemo(() => matchedTabKey(pathname), [pathname]);

  // NOTE: we deliberately do NOT eagerly import every tab chunk the instant the
  // shell mounts. That fired during the cold-start / Face-ID window (the whole
  // app tree mounts UNDER the AppLock overlay), so the JS engine parsed ~300KB
  // of page chunks while the user was unlocking — the main thread was then still
  // churning the moment the lock cleared, which read as a freeze on first
  // launch. Chunk warming now happens lazily: TabBar prefetches a route on
  // finger-down, the route change runs through a transition (so an on-demand
  // first mount keeps the current screen responsive), and the idle pre-mount
  // below warms the rest once the app is genuinely idle.

  // Lazy-mount: a tab only enters the DOM the first time it is visited.
  // After that, it stays mounted forever (within this Shell lifecycle).
  const [mounted, setMounted] = useState<Set<TabKey>>(() => {
    return new Set(activeKey ? [activeKey] : []);
  });

  // Pre-render the other tabs in the background so that LATER switches are
  // instant — but ONLY once the app is genuinely idle, never competing with
  // a fresh tab switch.
  //
  // The timer depends on `activeKey` and resets on every navigation. This
  // guarantees that pre-mounts start only after the user has been stable on
  // a tab for 3 seconds — they can never overlap with the active tab's own
  // first mount + data render (which was the source of the 4s freeze on
  // first launch: Reports and Settings were mounting concurrently with
  // DayView's initial render).
  //
  // Tabs mount ONE AT A TIME (each commit bounded to one page) and the state
  // update is wrapped in startTransition so a real tap always preempts it.
  // If idle never arrives, that's fine: TabBar routes through a transition, so
  // an on-demand first mount keeps the current screen responsive anyway.
  useEffect(() => {
    if (!activeKey) return;

    let cancelled = false;
    let idleHandle: number | undefined;
    let timerHandle: ReturnType<typeof setTimeout> | undefined;

    const order = TABS.map((t) => t.key);

    const mountNext = (i: number) => {
      if (cancelled || i >= order.length) return;
      
      const key = order[i];
      // Skip the currently-active tab — the activeKey effect already mounts it.
      if (key === activeKey) {
        mountNext(i + 1);
        return;
      }

      const executeMount = () => {
        if (cancelled) return;

        startTransition(() => {
          setMounted((prev) => {
            if (prev.has(key)) return prev;
            const next = new Set(prev);
            next.add(key);
            return next;
          });
        });

        // Space out the background mounts! Wait 1.5s before scheduling the next one.
        // This guarantees that Reports and Settings never mount in the same commit,
        // completely eliminating the massive concurrent freeze.
        timerHandle = setTimeout(() => {
          mountNext(i + 1);
        }, 1500);
      };

      if (typeof requestIdleCallback !== "undefined") {
        idleHandle = requestIdleCallback(executeMount);
      } else {
        timerHandle = setTimeout(executeMount, 800);
      }
    };

    // Wait 3s after EACH navigation before pre-mounting background tabs.
    // This prevents pre-mounts from competing with the active tab's first
    // data render. Every time activeKey changes, this timer is fully reset.
    timerHandle = setTimeout(() => {
      mountNext(0);
    }, 3000);

    return () => {
      cancelled = true;
      if (timerHandle !== undefined) clearTimeout(timerHandle);
      if (idleHandle !== undefined && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleHandle);
      }
    };
  }, [activeKey]);

  useEffect(() => {
    if (!activeKey) return;
    ptMark(`activeKey -> ${activeKey} (mounted=${mounted.has(activeKey)})`); // TEMP perf trace
    setMounted((prev) => {
      if (prev.has(activeKey)) return prev;
      const next = new Set(prev);
      next.add(activeKey);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // Imperatively re-apply the directional animation class to the now-active
  // tab so keyframes restart every time. Direction is forward (fwd) when the
  // user taps a tab to the right of the current one, backward (back) if left.
  const tabRefs = useRef<Map<TabKey, HTMLDivElement>>(new Map());
  const prevKeyRef = useRef<TabKey | null>(null);
  // Stores the animation class for a tab that hasn't mounted yet (first visit).
  // The ref callback picks it up the moment the div appears in the DOM.
  const pendingAnimCls = useRef<string | null>(null);

  const applyAnim = (el: HTMLDivElement, cls: string) => {
    el.scrollTop = 0;
    el.classList.remove("page-transition-tab", "page-transition-tab-fwd", "page-transition-tab-back");
    void el.offsetWidth;
    el.classList.add(cls);
  };

  useEffect(() => {
    if (!activeKey) return;

    const prev = prevKeyRef.current;
    const cls =
      prev === null || TAB_ORDER[activeKey] > TAB_ORDER[prev]
        ? "page-transition-tab-fwd"
        : "page-transition-tab-back";
    prevKeyRef.current = activeKey;

    const el = tabRefs.current.get(activeKey);
    if (el) {
      applyAnim(el, cls);
      pendingAnimCls.current = null;
    } else {
      // Tab not yet mounted — the ref callback will apply when the div appears.
      pendingAnimCls.current = cls;
    }
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
              if (el) {
                tabRefs.current.set(tab.key, el);
                if (tab.key === activeKey && pendingAnimCls.current) {
                  applyAnim(el, pendingAnimCls.current);
                  pendingAnimCls.current = null;
                }
              } else {
                tabRefs.current.delete(tab.key);
              }
            }}
            className={`absolute inset-0 overflow-y-auto overscroll-y-contain no-scrollbar ${isActive ? "" : "hidden"}`}
            aria-hidden={!isActive}
            // padding-bottom snaps (no transition). Animating padding on a
            // tall scroll container forces layout recalc for every frame of
            // a 220ms transition, which makes typing visibly stutter on iOS
            // WKWebView. The keyboard's own slide-in animation provides the
            // visual smoothness; snapping the padding is invisible because
            // it happens before the keyboard physically arrives.
            style={{
              paddingBottom: "calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 5rem + var(--keyboard-inset, 0px))",
            }}
          >
            <TabVisibilityCtx.Provider value={isActive}>
              <div className="min-h-full flex flex-col">
                <MemoizedTab Component={Component} tabKey={tab.key} />
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
  "/reports",
  "/settings",
] as const;
