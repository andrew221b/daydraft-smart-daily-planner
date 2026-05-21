/**
 * iOS keyboard handling via `window.visualViewport`.
 *
 * When the iOS soft keyboard opens, `position: fixed` elements stay anchored
 * to the layout viewport (the un-shrunk window) — so the TabBar ends up
 * sitting behind the keyboard, not above it. The fix is to listen to
 * `visualViewport.resize` and translate fixed bottom elements up by the
 * keyboard's overlap.
 *
 * We expose the overlap as a CSS variable (`--keyboard-inset`) on
 * `documentElement`. Any element that needs to ride the keyboard can do:
 *
 *   transform: translateY(calc(-1 * var(--keyboard-inset, 0px)));
 *
 * One listener for the whole app — no per-component bookkeeping.
 */

let attached = false;

export function attachVisualViewportInset(): () => void {
  if (typeof window === "undefined" || attached) return () => {};
  const vv = window.visualViewport;
  if (!vv) return () => {};
  attached = true;
  const root = document.documentElement;

  const sync = () => {
    // overlap = how much of the layout viewport the keyboard hides.
    // visualViewport.height = visible area; window.innerHeight = full layout.
    const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty("--keyboard-inset", `${overlap}px`);
    if (overlap > 1) {
      root.setAttribute("data-keyboard-open", "true");
    } else {
      root.removeAttribute("data-keyboard-open");
    }
  };

  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);

  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
    attached = false;
  };
}
