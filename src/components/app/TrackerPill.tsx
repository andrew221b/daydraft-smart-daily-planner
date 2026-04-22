import { useEffect, useMemo, useState } from "react";
import { Play, Pause, Plus, Check, Trash2, ChevronLeft, ChevronRight, Download, ChevronDown, Lock, Pencil, X } from "lucide-react";
import { useTimeTracker, fmtHMS, fmtHM, TimeCategory } from "@/hooks/useTimeTracker";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

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
  const { active, elapsedSec, categories, start, stop, switchCategory, addCategory, deleteCategory, renameCategory, todayTotalSec } = useTimeTracker();
  const { isPro } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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

  // Today: build 24h timeline segments (clipped to today)
  const todayTimeline = useMemo(() => {
    const dayStart = startOfDay(new Date()).getTime();
    const dayEnd = dayStart + DAY_MS;
    const segs: Array<{ id: string; start: number; end: number; color: string; name: string }> = [];
    entries.forEach(e => {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
      const a = Math.max(s, dayStart);
      const b = Math.min(en, dayEnd);
      if (b <= a) return;
      const cat = e.category_id ? catMap.get(e.category_id) : undefined;
      segs.push({ id: e.id, start: a - dayStart, end: b - dayStart, color: cat?.color || "hsl(var(--muted-foreground))", name: cat?.name || "Untracked" });
    });
    return segs;
  }, [entries, catMap, now]);

  // Period boundaries based on active tab (used for PDF + category drill-in)
  const period = useMemo(() => {
    if (tab === "today") {
      const s = startOfDay(new Date()).getTime();
      return { start: s, end: s + DAY_MS, label: "Today", days: 1 };
    }
    if (tab === "week") {
      const today = startOfDay(new Date()).getTime();
      return { start: today - 6 * DAY_MS, end: today + DAY_MS, label: "Last 7 days", days: 7 };
    }
    const first = new Date(monthCursor).getTime();
    const next = new Date(monthCursor); next.setMonth(next.getMonth() + 1);
    return { start: first, end: next.getTime(), label: monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" }), days: Math.round((next.getTime() - first) / DAY_MS) };
  }, [tab, monthCursor]);

  // Per-category stats for the active period (for inline drill-in)
  const periodCatStats = useMemo(() => {
    const map = new Map<string, { sec: number; sessions: Array<{ id: string; start: number; end: number; note: string | null }>; perDay: Map<string, number> }>();
    entries.forEach(e => {
      if (!e.category_id) return;
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
      const a = Math.max(s, period.start);
      const b = Math.min(en, period.end);
      if (b <= a) return;
      const dur = (b - a) / 1000;
      const cur = map.get(e.category_id) || { sec: 0, sessions: [], perDay: new Map() };
      cur.sec += dur;
      cur.sessions.push({ id: e.id, start: a, end: b, note: e.note });
      const dayKey = ymd(new Date(a));
      cur.perDay.set(dayKey, (cur.perDay.get(dayKey) || 0) + dur);
      map.set(e.category_id, cur);
    });
    return map;
  }, [entries, period, now]);

  const headerTotalSec = tab === "today" ? todayTotalSec : tab === "week" ? weekTotal : monthTotal;
  const headerLabel = tab === "today" ? "Today" : tab === "week" ? "This week" : monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // ----- PDF export -----
  const exportPDF = () => {
    if (!isPro) { setUpgradeOpen(true); return; }
    setExporting(true);
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 40;
      let y = margin;

      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text("Time tracker report", margin, y); y += 22;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110);
      const periodText = `${period.label} · ${new Date(period.start).toLocaleDateString()} – ${new Date(period.end - 1).toLocaleDateString()}`;
      doc.text(periodText, margin, y); y += 14;
      doc.text(`Total: ${fmtHM(headerTotalSec)}`, margin, y); y += 20;
      doc.setTextColor(0);

      // Section: by category
      const catRows: any[] = [];
      const catTotals = Array.from(periodCatStats.entries())
        .map(([id, v]) => ({ cat: catMap.get(id), sec: v.sec, sessions: v.sessions.length }))
        .filter(x => x.cat)
        .sort((a, b) => b.sec - a.sec);
      const grand = catTotals.reduce((a, x) => a + x.sec, 0) || 1;
      catTotals.forEach(x => catRows.push([x.cat!.name, fmtHM(x.sec), `${Math.round((x.sec / grand) * 100)}%`, String(x.sessions)]));

      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text("Summary by category", margin, y); y += 8;
      autoTable(doc, {
        startY: y + 4,
        head: [["Category", "Time", "Share", "Sessions"]],
        body: catRows.length ? catRows : [["—", "—", "—", "—"]],
        styles: { fontSize: 10 },
        headStyles: { fillColor: [240, 240, 245], textColor: 30 },
        margin: { left: margin, right: margin },
      });
      y = (doc as any).lastAutoTable.finalY + 24;

      // Section: per day
      const periodDays: Array<{ key: string; date: Date; total: number }> = [];
      for (let t = period.start; t < period.end; t += DAY_MS) {
        const ds = t, de = t + DAY_MS;
        let total = 0;
        entries.forEach(e => { total += clipDuration(e, ds, de, now); });
        periodDays.push({ key: ymd(new Date(ds)), date: new Date(ds), total });
      }

      if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = margin; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text("Daily breakdown", margin, y); y += 16;
      const maxDay = Math.max(1, ...periodDays.map(d => d.total));
      const barAreaW = pageW - margin * 2 - 160;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      periodDays.forEach(d => {
        if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = margin; }
        const label = d.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        doc.setTextColor(60);
        doc.text(label, margin, y);
        doc.setDrawColor(230); doc.setFillColor(240, 240, 245);
        doc.roundedRect(margin + 110, y - 8, barAreaW, 10, 2, 2, "F");
        if (d.total > 0) {
          const w = Math.max(2, (d.total / maxDay) * barAreaW);
          doc.setFillColor(99, 102, 241);
          doc.roundedRect(margin + 110, y - 8, w, 10, 2, 2, "F");
        }
        doc.setTextColor(0);
        doc.text(d.total > 0 ? fmtHM(d.total) : "—", margin + 110 + barAreaW + 8, y);
        y += 16;
      });
      y += 10;

      // Section: all sessions
      const allSessions: any[] = [];
      entries.forEach(e => {
        const s = new Date(e.started_at).getTime();
        const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
        const a = Math.max(s, period.start);
        const b = Math.min(en, period.end);
        if (b <= a) return;
        const cat = e.category_id ? catMap.get(e.category_id) : undefined;
        allSessions.push({ start: a, end: b, dur: (b - a) / 1000, cat: cat?.name || "Uncategorized", note: e.note || "" });
      });
      allSessions.sort((a, b) => a.start - b.start);

      if (allSessions.length) {
        if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = margin; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(12);
        doc.text("Sessions", margin, y); y += 8;
        autoTable(doc, {
          startY: y + 4,
          head: [["Date", "Start", "End", "Duration", "Category", "Note"]],
          body: allSessions.map(s => [
            new Date(s.start).toLocaleDateString(),
            new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            new Date(s.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            fmtHM(s.dur),
            s.cat,
            s.note,
          ]),
          styles: { fontSize: 9 },
          headStyles: { fillColor: [240, 240, 245], textColor: 30 },
          margin: { left: margin, right: margin },
        });
      }

      // Footer
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFontSize(8); doc.setTextColor(140);
        doc.text(`Daydraft · generated ${new Date().toLocaleString()}`, margin, doc.internal.pageSize.getHeight() - 18);
        doc.text(`${p} / ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 18, { align: "right" });
      }

      const fileLabel = period.label.toLowerCase().replace(/\s+/g, "-");
      doc.save(`daydraft-tracker-${fileLabel}-${ymd(new Date())}.pdf`);
      toast.success("PDF exported");
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSelectedDay(null); }}>
      <SheetContent side="bottom" className="rounded-t-3xl p-0 border-border max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <SheetHeader className="text-left flex-1 min-w-0">
              <SheetTitle className="text-xl">Time tracker</SheetTitle>
              <SheetDescription className="text-xs">
                {active
                  ? <>Tracking <span className="text-foreground font-medium">{activeCat?.name}</span> · <span className="font-mono tabular-nums">{fmtHMS(elapsedSec)}</span></>
                  : <>{headerLabel}: <span className="text-foreground font-medium">{fmtHM(headerTotalSec)}</span></>}
              </SheetDescription>
            </SheetHeader>
            <button
              onClick={exportPDF}
              disabled={exporting || headerTotalSec === 0}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-foreground pressable disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Export PDF"
              title={isPro ? `Export ${headerLabel} as PDF` : "PDF export is a Pro feature"}
            >
              {isPro ? <Download className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              PDF
            </button>
          </div>

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

                <div className="mt-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-secondary-fg mb-2">When you tracked (24h)</div>
                  <DayTimeline24h segments={todayTimeline} />
                </div>
              </div>
            )}

            <div className="px-4 py-4 space-y-2">
              {categories.map(c => {
                const isActive = active?.category_id === c.id;
                const isOpen = selectedCat === c.id;
                const stat = periodCatStats.get(c.id);
                const periodSec = stat?.sec || 0;
                return (
                  <div key={c.id} className={`rounded-2xl border ${isActive ? "border-primary/50 bg-primary/5" : "border-border bg-surface"} overflow-hidden`}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      {editingCat === c.id ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            await renameCategory(c.id, editingName);
                            setEditingCat(null);
                          }}
                          className="flex-1 flex items-center gap-2 min-w-0"
                        >
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
                          <Input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={async () => {
                              if (editingName.trim() && editingName.trim() !== c.name) {
                                await renameCategory(c.id, editingName);
                              }
                              setEditingCat(null);
                            }}
                            onKeyDown={(e) => { if (e.key === "Escape") setEditingCat(null); }}
                            className="flex-1 h-8 bg-transparent border-0 px-0 text-[15px] font-medium focus-visible:ring-0 shadow-none"
                          />
                          <button type="submit" className="p-1.5 text-primary pressable" aria-label="Save">
                            <Check className="h-4 w-4" />
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => setSelectedCat(isOpen ? null : c.id)}
                          className="flex-1 flex items-center gap-2 min-w-0 text-left pressable"
                          aria-expanded={isOpen}
                          aria-label={`${c.name} details`}
                        >
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
                          <span className="flex-1 text-[15px] font-medium truncate">{c.name}</span>
                          <span className="font-mono tabular-nums text-[11px] text-secondary-fg shrink-0">{fmtHM(periodSec)}</span>
                          <ChevronDown className={`h-3.5 w-3.5 text-secondary-fg shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      )}
                      {editingCat === c.id ? null : isActive ? (
                        <button onClick={stop} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium pressable">
                          <Pause className="h-3 w-3" fill="currentColor" /> Stop
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => { setEditingName(c.name); setEditingCat(c.id); }}
                            className="p-1.5 text-secondary-fg hover:text-foreground pressable"
                            aria-label="Rename"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
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
                    {isOpen && (
                      <CategoryDetail cat={c} stat={stat} period={period} />
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
    <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="quota" />
    </>
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

          <DayTimeline24h
            segments={detail.items.map((it: any) => ({
              id: it.id,
              start: it.start - detail.date.getTime(),
              end: it.end - detail.date.getTime(),
              color: it.cat?.color || "hsl(var(--muted-foreground))",
              name: it.cat?.name || "Untracked",
            }))}
          />

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

// 24h horizontal timeline. Segments expressed as offsets from start-of-day in ms.
function DayTimeline24h({ segments }: { segments: Array<{ id: string; start: number; end: number; color: string; name: string }> }) {
  const total = DAY_MS;
  return (
    <div>
      <div className="relative h-7 rounded-lg bg-muted overflow-hidden">
        {/* hour grid */}
        {Array.from({ length: 23 }, (_, i) => i + 1).map(h => (
          <div
            key={h}
            className={`absolute top-0 bottom-0 ${h % 6 === 0 ? "bg-border" : "bg-border/40"}`}
            style={{ left: `${(h / 24) * 100}%`, width: 1 }}
          />
        ))}
        {segments.map(s => {
          const left = (s.start / total) * 100;
          const width = Math.max(0.4, ((s.end - s.start) / total) * 100);
          return (
            <div
              key={s.id}
              title={`${s.name} · ${new Date(s.start).toUTCString().slice(17, 22)}–${new Date(s.end).toUTCString().slice(17, 22)}`}
              className="absolute top-1 bottom-1 rounded-sm"
              style={{ left: `${left}%`, width: `${width}%`, background: s.color }}
            />
          );
        })}
        {/* "now" indicator only if it's today (caller controls by passing today segments) */}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-secondary-fg/70">
        <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}

// Inline category drill-in: shown beneath a clicked category row.
function CategoryDetail({
  cat,
  stat,
  period,
}: {
  cat: TimeCategory;
  stat: { sec: number; sessions: Array<{ id: string; start: number; end: number; note: string | null }>; perDay: Map<string, number> } | undefined;
  period: { start: number; end: number; label: string; days: number };
}) {
  const sec = stat?.sec || 0;
  const sessions = stat?.sessions || [];
  const perDay = stat?.perDay || new Map<string, number>();
  const activeDays = perDay.size;
  const avgPerActiveDay = activeDays > 0 ? sec / activeDays : 0;
  const avgPerDay = period.days > 0 ? sec / period.days : 0;

  // last 5 sessions (most recent first)
  const recent = [...sessions].sort((a, b) => b.start - a.start).slice(0, 5);

  // hour-of-day histogram: when does this category usually run?
  const hourBuckets = new Array(24).fill(0);
  sessions.forEach(s => {
    let cursor = s.start;
    while (cursor < s.end) {
      const d = new Date(cursor);
      const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
      const hourEnd = hourStart + 3_600_000;
      const slice = Math.min(s.end, hourEnd) - cursor;
      hourBuckets[d.getHours()] += slice / 1000;
      cursor = hourEnd;
    }
  });
  const maxHour = Math.max(1, ...hourBuckets);

  if (sec === 0) {
    return (
      <div className="px-3 pb-3 pt-1 border-t border-border bg-background/50">
        <div className="py-3 text-center text-[12px] text-secondary-fg">
          No activity in <span className="text-foreground">{period.label.toLowerCase()}</span> yet
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pb-3 pt-2 border-t border-border bg-background/40 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label={period.label} value={fmtHM(sec)} />
        <Stat label="Avg / active day" value={fmtHM(avgPerActiveDay)} />
        <Stat label="Active days" value={`${activeDays}/${period.days}`} />
      </div>

      {/* Hour histogram */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-secondary-fg mb-1.5">Typical hours</div>
        <div className="flex items-end gap-[2px] h-12">
          {hourBuckets.map((v, h) => (
            <div
              key={h}
              className="flex-1 rounded-sm"
              style={{
                height: `${v > 0 ? Math.max(8, (v / maxHour) * 100) : 4}%`,
                background: v > 0 ? cat.color : "hsl(var(--muted))",
                opacity: v > 0 ? 0.4 + (v / maxHour) * 0.6 : 1,
              }}
              title={`${String(h).padStart(2, "0")}:00 · ${fmtHM(v)}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-secondary-fg/70">
          <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>

      {/* Recent sessions */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-secondary-fg mb-1.5">Recent sessions</div>
        <div className="space-y-1">
          {recent.map(s => {
            const dateStr = new Date(s.start).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            const startStr = new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const endStr = new Date(s.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={s.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono tabular-nums text-secondary-fg w-[54px] shrink-0">{dateStr}</span>
                <span className="font-mono tabular-nums text-secondary-fg w-[88px] shrink-0">{startStr}–{endStr}</span>
                <span className="truncate flex-1 text-secondary-fg">{s.note || "—"}</span>
                <span className="font-mono tabular-nums text-foreground">{fmtHM((s.end - s.start) / 1000)}</span>
              </div>
            );
          })}
        </div>
        {sessions.length > recent.length && (
          <div className="mt-1.5 text-[10px] text-secondary-fg/70">
            + {sessions.length - recent.length} more in this period
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wide text-secondary-fg truncate">{label}</div>
      <div className="text-[13px] font-mono tabular-nums font-semibold mt-0.5">{value}</div>
    </div>
  );
}
