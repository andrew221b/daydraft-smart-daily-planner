/** Suppresses background/window scroll during @dnd-kit drags (mobile scroll fight). */
const CLASS = "dd-dnd-scroll-lock";

export function setDndBodyScrollLock(active: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(CLASS, active);
  document.body.classList.toggle(CLASS, active);
}
