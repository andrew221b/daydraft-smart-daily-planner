/**
 * Shared month-grid helpers for calendar UIs (DayPickerSheet expanded view,
 * DateRangePickerSheet). Monday-first, always a stable 6×7 grid so the layout
 * height never jitters when the month changes.
 */

export const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const lastOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

/** 42 days (6 rows × 7 cols) covering `viewMonth`, padded with the tail of the
 *  previous month and head of the next so every week row is full. */
export function buildMonthGrid(viewMonth: Date): Date[] {
  const first = firstOfMonth(viewMonth);
  // Monday-first: JS getDay() is 0=Sun..6=Sat; shift so Mon=0.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const WEEKDAY_INITIAL_FMT = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

/** Locale-aware single-letter weekday labels, Monday-first to match the grid. */
export const WEEKDAY_NARROW_LABELS = (() => {
  const monday = new Date(2024, 0, 1); // Mon Jan 1, 2024
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return WEEKDAY_INITIAL_FMT.format(d);
  });
})();
