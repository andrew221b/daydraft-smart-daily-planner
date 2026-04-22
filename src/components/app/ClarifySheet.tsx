import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Clock, Flag, CalendarClock, X } from "lucide-react";

export type ClarifiedTask = {
  title: string;
  estimate_min: number;
  priority: "high" | "medium" | "low";
  fixed_time?: string; // HH:MM
  notes?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawInput: string;
  onConfirm: (tasks: ClarifiedTask[]) => void;
}

// naive parse: split lines, try to extract "30m", "1h", "at 2pm"
function parseLine(line: string): ClarifiedTask {
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
  // priority hints
  let priority: ClarifiedTask["priority"] = "medium";
  if (/!{2,}|urgent|asap|critical/i.test(title)) priority = "high";
  if (/maybe|nice to have|optional|low/i.test(title)) priority = "low";
  title = title.replace(/!+$/, "").replace(/[-•*]\s*/, "").trim();
  return { title, estimate_min, priority, fixed_time };
}

const PRESETS = [15, 30, 45, 60, 90, 120];

export function ClarifySheet({ open, onOpenChange, rawInput, onConfirm }: Props) {
  const initial = useMemo(
    () => rawInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(parseLine),
    [rawInput],
  );
  const [tasks, setTasks] = useState<ClarifiedTask[]>(initial);

  useEffect(() => { if (open) setTasks(initial); }, [open, initial]);

  const update = (i: number, patch: Partial<ClarifiedTask>) =>
    setTasks(t => t.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const remove = (i: number) => setTasks(t => t.filter((_, idx) => idx !== i));

  const totalMin = tasks.reduce((a, t) => a + (t.estimate_min || 0), 0);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  const prioStyle = (p: ClarifiedTask["priority"]) =>
    p === "high" ? "bg-destructive/10 text-destructive border-destructive/30"
      : p === "low" ? "bg-muted text-muted-foreground border-border"
      : "bg-primary/10 text-primary border-primary/30";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto p-0 border-border">
        <div className="px-6 pt-6 pb-3 sticky top-0 bg-background z-10 border-b border-border">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary" />
              Quick clarify
            </SheetTitle>
            <SheetDescription className="text-xs">
              Tighten estimates and pin fixed times so the AI can plan precisely.
              <span className="ml-2 text-primary font-medium">
                ~{hours > 0 ? `${hours}h ` : ""}{mins}m total
              </span>
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="px-6 py-4 space-y-3">
          {tasks.length === 0 && (
            <p className="text-sm text-secondary-fg text-center py-8">No tasks detected. Add some first.</p>
          )}
          {tasks.map((t, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface p-3 space-y-3">
              <div className="flex items-start gap-2">
                <Input
                  value={t.title}
                  onChange={e => update(i, { title: e.target.value })}
                  className="flex-1 h-9 bg-transparent border-0 px-0 text-base font-medium focus-visible:ring-0 shadow-none"
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

              <div>
                <div className="flex items-center gap-1.5 text-[11px] text-secondary-fg mb-1.5">
                  <Clock className="h-3 w-3" /> Estimate
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {PRESETS.map(m => (
                    <button
                      key={m}
                      onClick={() => update(i, { estimate_min: m })}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border pressable ${
                        t.estimate_min === m
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-secondary-fg border-border hover:text-foreground"
                      }`}
                    >
                      {m < 60 ? `${m}m` : `${m / 60}h`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
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
                  <span>Fixed time</span>
                  <input
                    type="time"
                    value={t.fixed_time || ""}
                    onChange={e => update(i, { fixed_time: e.target.value || undefined })}
                    className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 pb-6 pt-3 sticky bottom-0 bg-background border-t border-border">
          <Button
            onClick={() => onConfirm(tasks)}
            disabled={tasks.length === 0}
            className="w-full h-12 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}
          >
            Plan with these <Sparkles className="h-4 w-4 ml-1" />
          </Button>
          <p className="text-[11px] text-secondary-fg text-center mt-2">
            AI will respect your estimates and any fixed times.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
