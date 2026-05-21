import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Lightweight fixed-row virtual list.
 *
 * Trade-off: rows must be a uniform height (passed via `itemHeight`). That
 * eliminates the per-row measurement loop that's the whole reason virtual
 * lists in this app size class tend to be jank-prone. For lists under 50
 * items the overhead of any virtualizer outweighs the win — gate calls on
 * `items.length > 50`.
 *
 * Renders only the rows in viewport + 5 buffer rows above/below, exactly
 * as the perf brief asks for.
 *
 *   <VirtualList
 *     items={sessions}
 *     itemHeight={72}
 *     overscan={5}
 *     renderRow={(s) => <SessionRow session={s} />}
 *     getKey={(s) => s.id}
 *   />
 */
type Props<T> = {
  items: T[];
  itemHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string | number;
  overscan?: number;
  className?: string;
  /** Optional gap between rows (px). Defaults to 0. */
  gap?: number;
};

function VirtualListInner<T>({
  items,
  itemHeight,
  renderRow,
  getKey,
  overscan = 5,
  className,
  gap = 0,
}: Props<T>) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Sync viewport height — uses ResizeObserver so adding/removing siblings
  // (e.g. a "load more" footer) re-derives the window cleanly.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const rowStride = itemHeight + gap;
  const totalHeight = items.length * rowStride - (items.length > 0 ? gap : 0);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowStride) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowStride) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  const slice: { item: T; index: number }[] = [];
  for (let i = startIndex; i < endIndex; i++) slice.push({ item: items[i], index: i });

  return (
    <div
      ref={wrapperRef}
      className={`relative h-full overflow-y-auto ${className ?? ""}`}
      // `will-change: transform` keeps the scroll layer composited on iOS,
      // which is the single biggest scroll-perf hint for long lists in
      // WKWebView.
      style={{ willChange: "transform", contain: "strict" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {slice.map(({ item, index }) => (
          <div
            key={getKey(item, index)}
            // Position absolutely so non-rendered rows don't take up DOM.
            // contain:content scopes layout/paint to this row.
            style={{
              position: "absolute",
              top: index * rowStride,
              left: 0,
              right: 0,
              height: itemHeight,
              contain: "content",
            }}
          >
            {renderRow(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}

// `memo` so a parent re-render doesn't reconcile the slice when the list
// reference and viewport haven't changed.
export const VirtualList = memo(VirtualListInner) as typeof VirtualListInner;
