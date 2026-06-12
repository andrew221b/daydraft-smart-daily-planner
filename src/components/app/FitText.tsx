import { useLayoutEffect, useRef } from "react";

/**
 * Shrinks its text to fit the available width on a single line — the web
 * equivalent of SwiftUI's `minimumScaleFactor`. The text renders at `max`
 * px and, only when it would overflow, the font-size is scaled down (never
 * below `min`) so big values like "KZT 2,860,404.89" stay on one line
 * instead of wrapping or clipping.
 *
 * Why measure instead of CSS clamp(): currency magnitude is unbounded
 * (USD $40 vs KZT millions vs JPY), so no fixed font-size works for every
 * value. We measure the rendered glyph width against the container and pick
 * the largest size that fits — adaptive per value, per device width.
 *
 *   <FitText max={32} min={16} align="right" watch={moneyStr}>
 *     <TickingNumber value={moneyStr} />
 *   </FitText>
 *
 * The container's width is owned by the parent layout (flex/grid). Keep the
 * parent constrained (e.g. `min-w-0` + a max-width) so there's a real bound
 * to fit against; an unconstrained parent will just grow and never shrink.
 */
export function FitText({
  children,
  max,
  min = 12,
  align = "left",
  className,
  style,
  watch,
}: {
  children: React.ReactNode;
  /** Font-size (px) at full size — the value when it already fits. */
  max: number;
  /** Floor font-size (px) — never shrink past this even if it still clips. */
  min?: number;
  align?: "left" | "right" | "center";
  className?: string;
  style?: React.CSSProperties;
  /** Refit trigger: pass the displayed value so a content change (currency
   *  switch, ticking total) re-runs the fit even when the box size is stable. */
  watch?: unknown;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  // Last container width we fit against. A font-size change shrinks the
  // child's height, which re-fires the ResizeObserver — comparing width lets
  // us ignore those height-only echoes and avoid an oscillation loop.
  const lastWidthRef = useRef(-1);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;

    const fit = (force: boolean) => {
      const avail = wrap.clientWidth;
      if (!force && avail === lastWidthRef.current) return;
      lastWidthRef.current = avail;
      // Reset to full size, then measure the natural (nowrap) glyph width.
      text.style.fontSize = `${max}px`;
      if (avail <= 0) return;
      const needed = text.scrollWidth;
      if (needed <= avail) return;
      // Glyph width scales ~linearly with font-size — jump straight to the
      // ratio, then nudge down a couple px for kerning/rounding slack.
      let next = Math.max(min, Math.floor(max * (avail / needed)));
      text.style.fontSize = `${next}px`;
      let guard = 0;
      while (text.scrollWidth > avail && next > min && guard < 8) {
        next -= 1;
        text.style.fontSize = `${next}px`;
        guard += 1;
      }
    };

    fit(true);
    const ro = new ResizeObserver(() => fit(false));
    ro.observe(wrap);

    // Web fonts (Outfit via display=swap) load async: a font swap changes glyph
    // width WITHOUT changing the container, so the ResizeObserver never sees it
    // and a value measured in the fallback font could overflow once the real
    // font arrives. Refit once fonts settle (resolves immediately if cached).
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => { if (!cancelled) fit(true); }).catch(() => {});
    }

    return () => { cancelled = true; ro.disconnect(); };
    // `watch` forces a refit when the rendered value changes (same box size).
  }, [max, min, watch]);

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ ...style, overflow: "hidden", textAlign: align }}
    >
      <span
        ref={textRef}
        style={{
          display: "inline-block",
          whiteSpace: "nowrap",
          fontSize: max,
          lineHeight: 1.05,
        }}
      >
        {children}
      </span>
    </div>
  );
}
