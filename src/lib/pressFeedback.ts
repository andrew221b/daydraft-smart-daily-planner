const PRESS_TARGET_SELECTOR = ".pressable, .tappable, .ios-row";
const MOVE_THRESHOLD_PX = 10;

let installed = false;
let pressedEl: HTMLElement | null = null;
let pressStartX = 0;
let pressStartY = 0;
let lastTouchTime = 0;
let pressStartTime = 0;

function clearPress(e?: Event): void {
  if (pressedEl) {
    const el = pressedEl;
    const timeSinceDown = Date.now() - pressStartTime;
    const remainingTime = Math.max(0, 100 - timeSinceDown);

    setTimeout(() => {
      el.removeAttribute("data-pressed");
    }, remainingTime);

    pressedEl = null;
  }
}

function onPointerDown(e: PointerEvent): void {
  // Ghost click prevention
  if (e.pointerType === "touch") {
    lastTouchTime = Date.now();
  } else if (e.pointerType === "mouse" && Date.now() - lastTouchTime < 500) {
    return;
  }

  // CRITICAL FIX: iOS WebView sometimes provides the WRONG e.target for pointer events
  // if hit-testing gets confused or layout shifts occurred rapidly.
  // We manually verify the element under the exact touch coordinates.
  const exactTarget = document.elementFromPoint(e.clientX, e.clientY);
  const target = (exactTarget || e.target as Element | null)?.closest?.(PRESS_TARGET_SELECTOR);
  
  if (!(target instanceof HTMLElement)) return;
  
  clearPress();
  pressedEl = target;
  pressStartX = e.clientX;
  pressStartY = e.clientY;
  pressStartTime = Date.now();
  
  // IMMEDIATELY show the pressed state so the UI feels instantly responsive
  pressedEl.setAttribute("data-pressed", "true");
}

function onPointerMove(e: PointerEvent): void {
  if (!pressedEl) return;
  const dx = e.clientX - pressStartX;
  const dy = e.clientY - pressStartY;
  if (dx * dx + dy * dy > MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) {
    clearPress();
  }
}

export function installPressFeedback(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  
  document.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
  document.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
  document.addEventListener("pointerup", clearPress, { passive: true, capture: true });
  document.addEventListener("pointercancel", clearPress, { passive: true, capture: true });
  document.addEventListener("scroll", clearPress, { passive: true, capture: true });
}
