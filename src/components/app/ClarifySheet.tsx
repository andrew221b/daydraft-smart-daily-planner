import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Clock, Flag, CalendarClock, X, Check, Loader2, Wand2, ExternalLink, Mail, MessageSquare, Phone, MapPin, BookOpen, Link2, Split } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ClarifiedTask = {
  title: string;
  estimate_min: number;
  priority: "high" | "medium" | "low";
  fixed_time?: string; // HH:MM
  notes?: string;
};

type Row = ClarifiedTask & {
  ai_estimate_min?: number;
  ai_type?: "deep_work" | "communication" | "routine";
  ai_reason?: string;
  accepted?: boolean; // user accepted AI suggestion (or matches)
  ai_action_kind?: "url" | "email" | "message" | "call" | "calendar" | "maps" | "research" | "none";
  ai_links?: { label: string; url: string }[];
  ai_should_split?: boolean;
  ai_split_into?: { title: string; estimate_min: number }[];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawInput: string;
  onConfirm: (tasks: ClarifiedTask[]) => void;
}

// naive parse: split lines, try to extract "30m", "1h", "at 2pm"
function parseLine(line: string): Row {
  let title = line.trim();
  let estimate_min = 30;
  let fixed_time: string | undefined;

  const dur = title.match(/\b(\d+)\s*(h|hr|hour|hrs|hours|m|min|mins|minutes)\b/i);
  if (dur) {
    const n = parseInt(dur[1], 10);
    estimate_min = /^h/i.test(dur[2]) ? n * 60 : n;
    title = title.replace(dur[0], "").trim();
  }
  const at = title.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (at) {
    let h = parseInt(at[1], 10);
    const m = at[2] ? parseInt(at[2], 10) : 0;
    const ap = at[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    fixed_time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    title = title.replace(at[0], "").trim();
  }
  let priority: ClarifiedTask["priority"] = "medium";
  if (/!{2,}|urgent|asap|critical/i.test(title)) priority = "high";
  if (/maybe|nice to have|optional|low/i.test(title)) priority = "low";
  title = title.replace(/!+$/, "").replace(/[-•*]\s*/, "").trim();
  return { title, estimate_min, priority, fixed_time };
}

const fmt = (m: number) => (m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`);
const STEP = 5;
const MIN = 5;
const MAX = 240;

export function ClarifySheet({ open, onOpenChange, rawInput, onConfirm }: Props) {
  const initial = useMemo(
    () => rawInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(parseLine),
    [rawInput],
  );
  const [tasks, setTasks] = useState<Row[]>(initial);
  const [loadingAI, setLoadingAI] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTasks(initial);
    // Auto-fetch AI suggestions on open
    if (initial.length > 0) fetchSuggestions(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rawInput]);

  const fetchSuggestions = async (rows: Row[]) => {
    setLoadingAI(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-estimates", {
        body: { tasks: rows.map(r => r.title) },
      });
      if (error) throw error;
      const ests: Array<{ index: number; estimate_min: number; type: string; reason: string }> = data?.estimates || [];
      setTasks(prev => prev.map((r, i) => {
        const e = ests.find(x => x.index === i);
        if (!e) return r;
        return {
          ...r,
          ai_estimate_min: e.estimate_min,
          ai_type: e.type as Row["ai_type"],
          ai_reason: e.reason,
        };
      }));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Couldn't get AI suggestions");
    } finally {
      setLoadingAI(false);
    }
  };

  const update = (i: number, patch: Partial<Row>) =>
    setTasks(t => t.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const remove = (i: number) => setTasks(t => t.filter((_, idx) => idx !== i));
  const accept = (i: number) => {
    const r = tasks[i];
    if (!r.ai_estimate_min) return;
    update(i, { estimate_min: r.ai_estimate_min, accepted: true });
  };
  const acceptAll = () => {
    setTasks(t => t.map(r => r.ai_estimate_min ? { ...r, estimate_min: r.ai_estimate_min, accepted: true } : r));
  };
  const bump = (i: number, delta: number) => {
    const next = Math.max(MIN, Math.min(MAX, Math.round((tasks[i].estimate_min + delta) / STEP) * STEP));
    update(i, { estimate_min: next, accepted: tasks[i].ai_estimate_min === next });
  };

  const totalMin = tasks.reduce((a, t) => a + (t.estimate_min || 0), 0);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const suggestionsReady = tasks.some(t => t.ai_estimate_min);
  const allAccepted = suggestionsReady && tasks.every(t => !t.ai_estimate_min || t.accepted);

  const prioStyle = (p: ClarifiedTask["priority"]) =>
    p === "high" ? "bg-destructive/10 text-destructive border-destructive/30"
      : p === "low" ? "bg-muted text-muted-foreground border-border"
      : "bg-primary/10 text-primary border-primary/30";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[94vh] overflow-y-auto p-0 border-border">
        <div className="px-5 pt-5 pb-3 sticky top-0 bg-background z-10 border-b border-border">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary" />
              Quick clarify
            </SheetTitle>
            <SheetDescription className="text-xs flex items-center gap-2 flex-wrap">
              <span>AI suggests realistic times. Accept or tweak each one.</span>
              <span className="text-primary font-medium">
                ~{hours > 0 ? `${hours}h ` : ""}{mins}m total
              </span>
              {loadingAI && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            </SheetDescription>
          </SheetHeader>
          {suggestionsReady && !allAccepted && (
            <button
              onClick={acceptAll}
              className="mt-3 text-xs text-primary font-medium pressable inline-flex items-center gap-1"
            >
              <Wand2 className="h-3 w-3" /> Accept all AI suggestions
            </button>
          )}
        </div>

        <div className="px-3 py-3 space-y-2">
          {tasks.length === 0 && (
            <p className="text-sm text-secondary-fg text-center py-8">No tasks detected. Add some first.</p>
          )}
          {tasks.map((t, i) => {
            const aiMatches = t.ai_estimate_min && t.ai_estimate_min === t.estimate_min;
            const showAccept = t.ai_estimate_min && !aiMatches;
            return (
              <div key={i} className="rounded-2xl border border-border bg-surface p-3 space-y-2.5">
                {/* Title row */}
                <div className="flex items-start gap-2">
                  <Input
                    value={t.title}
                    onChange={e => update(i, { title: e.target.value })}
                    className="flex-1 h-8 bg-transparent border-0 px-0 text-[15px] font-medium focus-visible:ring-0 shadow-none"
                    placeholder="Task title"
                  />
                  <button
                    onClick={() => remove(i)}
                    className="text-secondary-fg hover:text-destructive p-1 pressable"
                    aria-label="Remove task"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* AI suggestion row */}
                <div className="flex items-center gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-secondary-fg shrink-0">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>AI:</span>
                  </div>
                  {t.ai_estimate_min ? (
                    <>
                      <span className="font-medium text-foreground tabular-nums">{fmt(t.ai_estimate_min)}</span>
                      {t.ai_reason && (
                        <span className="text-secondary-fg truncate flex-1" title={t.ai_reason}>
                          · {t.ai_reason}
                        </span>
                      )}
                      {showAccept && (
                        <button
                          onClick={() => accept(i)}
                          className="ml-auto h-6 px-2 rounded-full bg-primary text-primary-foreground text-[10px] font-medium pressable inline-flex items-center gap-1 shrink-0"
                        >
                          <Check className="h-3 w-3" /> Accept
                        </button>
                      )}
                      {aiMatches && (
                        <span className="ml-auto inline-flex items-center gap-1 text-success text-[10px] font-medium shrink-0">
                          <Check className="h-3 w-3" /> Accepted
                        </span>
                      )}
                    </>
                  ) : loadingAI ? (
                    <span className="text-secondary-fg italic">thinking…</span>
                  ) : (
                    <span className="text-secondary-fg italic">—</span>
                  )}
                </div>

                {/* Estimate stepper */}
                <div className="flex items-center justify-between gap-2 bg-background/60 rounded-xl border border-border px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-secondary-fg">
                    <Clock className="h-3 w-3" /> Your estimate
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => bump(i, -STEP)}
                      className="h-7 w-7 rounded-lg bg-surface border border-border text-foreground pressable text-sm font-medium"
                      aria-label="Decrease"
                    >−</button>
                    <span className="min-w-[54px] text-center text-sm font-semibold tabular-nums">
                      {fmt(t.estimate_min)}
                    </span>
                    <button
                      onClick={() => bump(i, STEP)}
                      className="h-7 w-7 rounded-lg bg-surface border border-border text-foreground pressable text-sm font-medium"
                      aria-label="Increase"
                    >+</button>
                  </div>
                </div>

                {/* Priority + fixed time */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Flag className="h-3 w-3 text-secondary-fg" />
                    <div className="flex gap-1">
                      {(["high", "medium", "low"] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => update(i, { priority: p })}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border pressable ${
                            t.priority === p ? prioStyle(p) : "bg-background text-secondary-fg border-border"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-1.5 text-xs text-secondary-fg ml-auto">
                    <CalendarClock className="h-3 w-3" />
                    <input
                      type="time"
                      value={t.fixed_time || ""}
                      onChange={e => update(i, { fixed_time: e.target.value || undefined })}
                      className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 pb-6 pt-3 sticky bottom-0 bg-background border-t border-border">
          <Button
            onClick={() => onConfirm(tasks.map(({ ai_estimate_min, ai_type, ai_reason, accepted, ...rest }) => rest))}
            disabled={tasks.length === 0}
            className="w-full h-12 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}
          >
            Plan with these <Sparkles className="h-4 w-4 ml-1" />
          </Button>
          <p className="text-[11px] text-secondary-fg text-center mt-2">
            AI will respect your final estimates and any fixed times.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
