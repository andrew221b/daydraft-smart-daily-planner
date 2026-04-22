import { useEffect, useMemo, useState } from "react";
import { Play, Pause, Plus, Check, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useTimeTracker, fmtHMS, fmtHM, TimeCategory } from "@/hooks/useTimeTracker";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Entry = {
  id: string;
  category_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
};

type Tab = "today" | "week" | "month";

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

function clipDuration(e: Entry, dayStart: number, dayEnd: number, now: number) {
  const s = new Date(e.started_at).getTime();
  const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
  const a = Math.max(s, dayStart);
  const b = Math.min(en, dayEnd);
  return Math.max(0, (b - a) / 1000);
}

export function TrackerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const { active, elapsedSec, categories, start, stop, switchCategory, addCategory, deleteCategory, todayTotalSec } = useTimeTracker();
  const [newName, setNewName] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const activeCat = categories.find(c => c.id === active?.category_id);
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  // Load 60 days of entries when sheet opens (covers week + month views)
  useEffect(() => {
    if (!open || !user) return;
    const since = new Date(); since.setDate(since.getDate() - 60); since.setHours(0,0,0,0);
    supabase
      .from("time_entries")
      .select("id,category_id,started_at,ended_at,note")
      .eq("user_id", user.id)
      .gte("started_at", since.toISOString())
      .order("started_at", { ascending: false })
      .then(({ data }) => setEntries((data || []) as Entry[]));
  }, [open, user?.id, active?.id, todayTotalSec]);

  // ----- Aggregations -----
  const now = Date.now();

  // Week (last 7 days, oldest first)
  const weekDays = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return Array.from({ length: 7 }, (_, i) => {
      const dayStart = today - (6 - i) * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const byCat = new Map<string, number>();
      let total = 0;
      entries.forEach(e => {
        const d = clipDuration(e, dayStart, dayEnd, now);
        if (d > 0) {
          total += d;
          if (e.category_id) byCat.set(e.category_id, (byCat.get(e.category_id) || 0) + d);
        }
      });
      return { date: new Date(dayStart), key: ymd(new Date(dayStart)), total, byCat };
    });
  }, [entries, now]);

  const weekTotal = weekDays.reduce((a, d) => a + d.total, 0);
  const weekMaxSec = Math.max(1, ...weekDays.map(d => d.total));

  // Month grid
  const monthCells = useMemo(() => {
    const first = new Date(monthCursor);
    const year = first.getFullYear(), month = first.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = (first.getDay() + 6) % 7; // Mon = 0
    const cells: Array<{ date: Date | null; key: string; total: number } | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStart = new Date(year, month, d).getTime();
      const dayEnd = dayStart + DAY_MS;
      let total = 0;
      entries.forEach(e => { total += clipDuration(e, dayStart, dayEnd, now); });
      cells.push({ date: new Date(dayStart), key: ymd(new Date(dayStart)), total });
    }
    return cells;
  }, [entries, monthCursor, now]);

  const monthTotal = monthCells.reduce((a, c) => a + (c?.total || 0), 0);
  const monthMaxSec = Math.max(1, ...monthCells.map(c => c?.total || 0));

  // Selected day breakdown (used by week + month)
  const dayDetail = useMemo(() => {
    if (!selectedDay) return null;
    const [y, m, d] = selectedDay.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d).getTime();
    const dayEnd = dayStart + DAY_MS;
    const byCat = new Map<string, number>();
    const items: Array<{ id: string; cat: TimeCategory | undefined; start: number; end: number; dur: number }> = [];
    let total = 0;
    entries.forEach(e => {
      const dur = clipDuration(e, dayStart, dayEnd, now);
      if (dur <= 0) return;
      total += dur;
      if (e.category_id) byCat.set(e.category_id, (byCat.get(e.category_id) || 0) + dur);
      const s = Math.max(new Date(e.started_at).getTime(), dayStart);
      const en = Math.min(e.ended_at ? new Date(e.ended_at).getTime() : now, dayEnd);
      items.push({ id: e.id, cat: e.category_id ? catMap.get(e.category_id) : undefined, start: s, end: en, dur });
    });
    items.sort((a, b) => a.start - b.start);
    return { date: new Date(dayStart), total, byCat, items };
  }, [selectedDay, entries, catMap, now]);

  // Today breakdown by category
  const todayByCat = useMemo(() => {
    const dayStart = startOfDay(new Date()).getTime();
    const dayEnd = dayStart + DAY_MS;
    const byCat = new Map<string, number>();
    entries.forEach(e => {
      const d = clipDuration(e, dayStart, dayEnd, now);
      if (d > 0 && e.category_id) byCat.set(e.category_id, (byCat.get(e.category_id) || 0) + d);
    });
    return Array.from(byCat.entries())
      .map(([id, sec]) => ({ cat: catMap.get(id), sec }))
      .filter(x => x.cat)
      .sort((a, b) => b.sec - a.sec);
  }, [entries, catMap, now]);

  const headerTotalSec = tab === "today" ? todayTotalSec : tab === "week" ? weekTotal : monthTotal;
  const headerLabel = tab === "today" ? "Today" : tab === "week" ? "This week" : monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSelectedDay(null); }}>
      <SheetContent side="bottom" className="rounded-t-3xl p-0 border-border max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <SheetHeader className="text-left">
            <SheetTitle className="text-xl">Time tracker</SheetTitle>
            <SheetDescription className="text-xs">
              {active
                ? <>Tracking <span className="text-foreground font-medium">{activeCat?.name}</span> · <span className="font-mono tabular-nums">{fmtHMS(elapsedSec)}</span></>
                : <>{headerLabel}: <span className="text-foreground font-medium">{fmtHM(headerTotalSec)}</span></>}
            </SheetDescription>
          </SheetHeader>

          {/* Tabs */}
          <div className="mt-4 inline-flex w-full rounded-xl bg-muted p-1">
            {(["today","week","month"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedDay(null); }}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium capitalize pressable transition-colors ${tab === t ? "bg-background text-foreground shadow-sm" : "text-secondary-fg"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* TODAY TAB — categories + start/stop + today summary */}
        {tab === "today" && (
          <>
            {todayByCat.length > 0 && (
              <div className="px-5 pt-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-secondary-fg mb-2">Today by category</div>
                <StackedBar segments={todayByCat.map(x => ({ value: x.sec, color: x.cat!.color, label: x.cat!.name }))} totalSec={todayTotalSec} />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {todayByCat.map(x => (
                    <div key={x.cat!.id} className="flex items-center gap-1.5 text-[11px] text-secondary-fg">
                      <span className="h-2 w-2 rounded-full" style={{ background: x.cat!.color }} />
                      <span>{x.cat!.name}</span>
                      <span className="font-mono tabular-nums text-foreground">{fmtHM(x.sec)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 py-4 space-y-2">
              {categories.map(c => {
                const isActive = active?.category_id === c.id;
                return (
                  <div key={c.id} className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${isActive ? "border-primary/50 bg-primary/5" : "border-border bg-surface"}`}>
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
                    <span className="flex-1 text-[15px] font-medium truncate">{c.name}</span>
                    {isActive ? (
                      <button onClick={stop} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium pressable">
                        <Pause className="h-3 w-3" fill="currentColor" /> Stop
                      </button>
                    ) : (
                      <>
                        <button onClick={() => active ? switchCategory(c.id) : start(c.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium pressable">
                          <Play className="h-3 w-3" fill="currentColor" /> {active ? "Switch" : "Start"}
                        </button>
                        {!c.is_default && (
                          <button onClick={() => deleteCategory(c.id)} className="p-1.5 text-secondary-fg hover:text-destructive pressable" aria-label="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  const c = await addCategory(newName);
                  if (c) setNewName("");
                }}
                className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-surface px-3 py-2"
              >
                <Plus className="h-4 w-4 text-secondary-fg shrink-0" />
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Add category (e.g. Client A)"
                  className="flex-1 h-8 bg-transparent border-0 px-0 text-sm focus-visible:ring-0 shadow-none"
                />
                {newName.trim() && (
                  <button type="submit" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium pressable">
                    <Check className="h-3 w-3" /> Add
                  </button>
                )}
              </form>
            </div>
          </>
        )}

        {/* WEEK TAB — bars + tap-to-expand day */}
        {tab === "week" && (
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-end justify-between gap-2 h-32">
                {weekDays.map(d => {
                  const h = d.total > 0 ? Math.max(8, (d.total / weekMaxSec) * 100) : 4;
                  const isSelected = selectedDay === d.key;
                  const isToday = d.key === ymd(new Date());
                  return (
                    <button
                      key={d.key}
                      onClick={() => setSelectedDay(isSelected ? null : d.key)}
                      className="flex-1 flex flex-col items-center gap-1.5 pressable group"
                    >
                      <span className={`text-[10px] font-mono tabular-nums ${d.total > 0 ? "text-secondary-fg" : "text-secondary-fg/40"}`}>
                        {d.total > 0 ? fmtHM(d.total) : "–"}
                      </span>
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className={`w-full rounded-md transition-all ${isSelected ? "bg-primary" : d.total > 0 ? "bg-primary/60 group-hover:bg-primary/80" : "bg-muted"}`}
                          style={{ height: `${h}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-medium ${isToday ? "text-primary" : "text-secondary-fg"}`}>
                        {d.date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px]">
                <span className="text-secondary-fg">Tap a bar for details</span>
                <span className="font-medium">Total <span className="font-mono tabular-nums">{fmtHM(weekTotal)}</span></span>
              </div>
            </div>

            {dayDetail && <DayDetail detail={dayDetail} catMap={catMap} />}
          </div>
        )}

        {/* MONTH TAB — heatmap calendar */}
        {tab === "month" && (
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setMonthCursor(d => { const x = new Date(d); x.setMonth(x.getMonth() - 1); return x; })} className="p-1.5 rounded-lg hover:bg-muted pressable" aria-label="Previous month">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-medium">{monthLabel}</div>
                <button onClick={() => setMonthCursor(d => { const x = new Date(d); x.setMonth(x.getMonth() + 1); return x; })} className="p-1.5 rounded-lg hover:bg-muted pressable" aria-label="Next month">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-[10px] text-secondary-fg mb-1">
                {["M","T","W","T","F","S","S"].map((d, i) => (
                  <div key={i} className="text-center font-medium">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {monthCells.map((c, i) => {
                  if (!c) return <div key={i} className="aspect-square" />;
                  const intensity = c.total === 0 ? 0 : Math.min(1, c.total / monthMaxSec);
                  const isSelected = selectedDay === c.key;
                  const isToday = c.key === ymd(new Date());
                  const opacity = c.total === 0 ? 0 : 0.15 + intensity * 0.85;
                  return (
                    <button
                      key={c.key}
                      onClick={() => setSelectedDay(isSelected ? null : c.key)}
                      className={`aspect-square rounded-md text-[10px] font-medium relative pressable transition-all flex items-center justify-center ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""} ${isToday && !isSelected ? "ring-1 ring-foreground/40" : ""}`}
                      style={{
                        backgroundColor: c.total > 0 ? `hsl(var(--primary) / ${opacity})` : "hsl(var(--muted))",
                        color: intensity > 0.5 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                      }}
                      aria-label={`${c.date!.toDateString()} — ${fmtHM(c.total)}`}
                    >
                      {c.date!.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-secondary-fg">Less</span>
                  {[0.15, 0.4, 0.65, 1].map((o, i) => (
                    <span key={i} className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `hsl(var(--primary) / ${o})` }} />
                  ))}
                  <span className="text-secondary-fg">More</span>
                </div>
                <span className="font-medium">Total <span className="font-mono tabular-nums">{fmtHM(monthTotal)}</span></span>
              </div>
            </div>

            {dayDetail && <DayDetail detail={dayDetail} catMap={catMap} />}
          </div>
        )}

        <div className="px-5 pb-6 pt-2 text-[11px] text-secondary-fg text-center">
          Tracking runs in the background — close the app and it keeps counting.
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ----- Sub-components -----

function StackedBar({ segments, totalSec }: { segments: Array<{ value: number; color: string; label: string }>; totalSec: number }) {
  const total = Math.max(1, totalSec);
  return (
    <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-muted">
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} aria-label={s.label} />
      ))}
    </div>
  );
}

function DayDetail({ detail, catMap }: { detail: NonNullable<ReturnType<() => any>>; catMap: Map<string, TimeCategory> }) {
  const byCat = Array.from(detail.byCat.entries() as IterableIterator<[string, number]>)
    .map(([id, sec]) => ({ cat: catMap.get(id), sec }))
    .filter(x => x.cat)
    .sort((a, b) => b.sec - a.sec);

  const dateLabel = detail.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold">{dateLabel}</div>
        <div className="text-xs text-secondary-fg">Total <span className="font-mono tabular-nums text-foreground">{fmtHM(detail.total)}</span></div>
      </div>

      {detail.total === 0 ? (
        <div className="py-6 text-center text-xs text-secondary-fg">No time tracked this day</div>
      ) : (
        <>
          <StackedBar segments={byCat.map(x => ({ value: x.sec, color: x.cat!.color, label: x.cat!.name }))} totalSec={detail.total} />

          <div className="space-y-1.5">
            {byCat.map(x => (
              <div key={x.cat!.id} className="flex items-center justify-between text-[13px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: x.cat!.color }} />
                  <span className="truncate">{x.cat!.name}</span>
                </div>
                <span className="font-mono tabular-nums text-secondary-fg">{fmtHM(x.sec)}</span>
              </div>
            ))}
          </div>

          {detail.items.length > 0 && (
            <div className="pt-2 mt-2 border-t border-border">
              <div className="text-[11px] font-medium uppercase tracking-wide text-secondary-fg mb-2">Sessions</div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {detail.items.map((it: any) => {
                  const startStr = new Date(it.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  const endStr = new Date(it.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={it.id} className="flex items-center gap-2 text-[12px]">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: it.cat?.color || "hsl(var(--muted-foreground))" }} />
                      <span className="font-mono tabular-nums text-secondary-fg w-[88px] shrink-0">{startStr}–{endStr}</span>
                      <span className="truncate flex-1">{it.cat?.name || "Uncategorized"}</span>
                      <span className="font-mono tabular-nums text-secondary-fg">{fmtHM(it.dur)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
