/**
 * Keyboard inset tracking — single source of truth for "how many pixels does
 * the soft keyboard hide from the bottom of the viewport".
 *
 * Two data sources, used in priority order:
 *
 *   1. **Capacitor Keyboard plugin** (`keyboardWillShow/keyboardDidHide`)
 *      — fires on native iOS / Android with the EXACT keyboard height the
 *      OS reports. This is the gold-standard signal on native; we use it
 *      whenever it's available.
 *
 *   2. **`window.visualViewport`** — web-standard fallback. Works on iOS
 *      Safari, Chrome Android, PWAs, and as a safety net inside Capacitor
 *      WebViews if the plugin hasn't fired yet.
 *
 * Both feed the same `--keyboard-inset` CSS variable on `<html>`. Any
 * element that needs to ride the keyboard does:
 *
 *   padding-bottom: var(--keyboard-inset, 0px);
 *   transition: padding-bottom 220ms cubic-bezier(0.32, 0.72, 0, 1);
 *
 * The `data-keyboard-open` attribute on `<html>` mirrors the open state so
 * components can react conditionally (e.g. Radix Dialog dismiss guards).
 */

let attached = false;

export function attachVisualViewportInset(): () => void {
  if (typeof window === "undefined" || attached) return () => {};
  attached = true;
  const root = document.documentElement;

  // Capacitor wins when present — its event payload includes the exact
  // pixel height from UIKit's `UIKeyboardFrameEndUserInfoKey`. The web
  // fallback fills in for the brief moment between page load and the first
  // plugin event (and for non-native builds).
  let capPriority = false;

  // After the keyboard slides in and the container padding has transitioned
  // (220ms), nudge the focused input into the visible area. This handles
  // inputs deep in scrollable page containers where padding alone isn't
  // enough to bring the field into view.
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  const scrollFocusedIntoView = () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        try {
          el.scrollIntoView({ behavior: "auto", block: "center" });
        } catch {
          /* iOS WKWebView occasionally throws on cross-origin scroll roots */
        }
      }
      scrollTimer = null;
    }, 260); // just after the 220ms padding transition finishes
  };

  let wasOpen = false;
  const setInset = (overlapPx: number) => {
    const overlap = Math.max(0, Math.round(overlapPx));
    root.style.setProperty("--keyboard-inset", `${overlap}px`);
    const isOpen = overlap > 1;
    if (isOpen) {
      root.setAttribute("data-keyboard-open", "true");
    } else {
      root.removeAttribute("data-keyboard-open");
    }
    if (isOpen && !wasOpen) scrollFocusedIntoView();
    wasOpen = isOpen;
  };

  // ── Source 1: Capacitor Keyboard plugin (native only) ──────────────
  // Dynamic import keeps web builds free of the native binding.
  let capCleanup: Array<() => void> = [];
  void (async () => {
    try {
      const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
      if (!w.Capacitor?.isNativePlatform?.()) return;
      const { Keyboard } = await import("@capacitor/keyboard");
      // Single listener per show/hide. keyboardWillShow gives the same
      // height earlier than keyboardDidShow; the Did* counterparts would
      // re-fire setInset for no visual benefit and add an extra style
      // recalc on every keyboard event.
      const onWillShow = await Keyboard.addListener("keyboardWillShow", (info) => {
        setInset(info.keyboardHeight);
      });
      const onWillHide = await Keyboard.addListener("keyboardWillHide", () => {
        setInset(0);
      });
      // Only mark plugin authoritative AFTER listeners are wired. Setting
      // `capPriority` earlier would gag the visualViewport fallback during
      // the few-ms `await` window where neither source can fire — risking a
      // missed initial keyboard event on cold launches.
      capPriority = true;
      capCleanup = [
        () => onWillShow.remove(),
        () => onWillHide.remove(),
      ];
    } catch {
      /* plugin not installed or native call failed — fall back to visualViewport */
    }
  })();

  // ── Source 2: visualViewport (web standard, fallback) ──────────────
  const vv = window.visualViewport;
  const syncFromVV = () => {
    if (capPriority) return; // let the plugin drive when it's authoritative
    if (!vv) return;
    const overlap = window.innerHeight - vv.height - vv.offsetTop;
    setInset(overlap);
  };

  if (vv) {
    syncFromVV();
    vv.addEventListener("resize", syncFromVV);
    vv.addEventListener("scroll", syncFromVV);
  }

  return () => {
    if (vv) {
      vv.removeEventListener("resize", syncFromVV);
      vv.removeEventListener("scroll", syncFromVV);
    }
    for (const remove of capCleanup) remove();
    if (scrollTimer) clearTimeout(scrollTimer);
    attached = false;
  };
}
