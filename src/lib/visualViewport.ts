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
  const isTextEntry = (el: Element | null): el is HTMLElement => {
    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLTextAreaElement) &&
      !(el instanceof HTMLElement && el.isContentEditable)
    ) {
      return false;
    }
    // Native time/date inputs open a picker overlay, not the text keyboard —
    // centring them is unnecessary churn.
    if (el instanceof HTMLInputElement && (el.type === "time" || el.type === "date")) return false;
    return true;
  };

  const scrollTimers: Array<ReturnType<typeof setTimeout>> = [];
  const clearScrollTimers = () => {
    while (scrollTimers.length) {
      const t = scrollTimers.pop();
      if (t) clearTimeout(t);
    }
  };
  const scrollActiveIntoView = () => {
    const el = document.activeElement;
    if (!isTextEntry(el)) return;
    try {
      el.scrollIntoView({ behavior: "auto", block: "center" });
    } catch {
      /* iOS WKWebView occasionally throws on cross-origin scroll roots */
    }
  };
  // Two passes: 260ms ≈ just after the padding transition; 480ms ≈ after the
  // keyboard finishes animating and the layout has fully settled. A single
  // early scroll often lands the field right back under the keyboard on
  // Android WebViews, where the resize/pan arrives after our first scroll.
  const scheduleScrollIntoView = () => {
    clearScrollTimers();
    scrollTimers.push(setTimeout(scrollActiveIntoView, 260));
    scrollTimers.push(setTimeout(scrollActiveIntoView, 480));
  };

  // Focusing a text field while the keyboard is ALREADY open doesn't change the
  // inset, so the open-transition scroll below never fires for it — re-assert
  // here. Also covers inputs that mount + autofocus mid-session (inline rename
  // fields), where the field appears below the fold under an open keyboard.
  const softKeyboardLikely = () =>
    capPriority ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
    root.hasAttribute("data-keyboard-open");
  const onFocusIn = (e: FocusEvent) => {
    if (!isTextEntry(e.target as Element)) return;
    if (!softKeyboardLikely()) return;
    scheduleScrollIntoView();
  };
  document.addEventListener("focusin", onFocusIn);

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
    if (isOpen && !wasOpen) scheduleScrollIntoView();
    wasOpen = isOpen;
  };

  // ── Source 1: Capacitor Keyboard plugin (native only) ──────────────
  // Dynamic import keeps web builds free of the native binding.
  let capCleanup: Array<() => void> = [];
  void (async () => {
    try {
      const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
      if (!w.Capacitor?.isNativePlatform?.()) return;
      // Android: the manifest now sets windowSoftInputMode="adjustNothing"
      // (NOT adjustResize) because EdgeToEdge.enable() in MainActivity calls
      // setDecorFitsSystemWindows(false), under which adjustResize fights the
      // JS inset and double-shifts the layout — a big empty gap above the
      // keyboard. With adjustNothing the OS leaves the window alone; instead
      // `interactive-widget=resizes-visual` (index.html) shrinks ONLY the
      // visual viewport, so window.visualViewport (Source 2 below) reports the
      // exact keyboard overlap and is the single source of truth. So we let
      // the plugin drive ONLY on iOS, where WKWebView never resizes either and
      // its keyboardHeight is the authoritative signal.
      if (w.Capacitor?.getPlatform?.() !== "ios") return;
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
    document.removeEventListener("focusin", onFocusIn);
    for (const remove of capCleanup) remove();
    clearScrollTimers();
    attached = false;
  };
}
