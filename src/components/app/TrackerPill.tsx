import { useState } from "react";
import { Play, Pause, Plus, Check, X, Trash2 } from "lucide-react";
import { useTimeTracker, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

export function TrackerPill() {
  const { active, elapsedSec, categories, start, stop, switchCategory, addCategory, deleteCategory, todayTotalSec } = useTimeTracker();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const activeCat = categories.find(c => c.id === active?.category_id);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 px-3.5 py-2 rounded-full border shadow-card backdrop-blur pressable transition-all ${
          active
            ? "bg-primary text-primary-foreground border-primary/40 shadow-glow"
            : "bg-surface-elevated/90 text-foreground border-border"
        }`}
        style={{ bottom: "92px" }}
        aria-label="Time tracker"
      >
        {active ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-foreground" />
            </span>
            <span className="text-xs font-medium">{activeCat?.name || "Tracking"}</span>
            <span className="text-xs font-mono tabular-nums opacity-90">{fmtHMS(elapsedSec)}</span>
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5 text-primary" fill="currentColor" />
            <span className="text-xs font-medium">Track time</span>
            {todayTotalSec > 0 && (
              <span className="text-[10px] text-secondary-fg">· {fmtHM(todayTotalSec)} today</span>
            )}
          </>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl p-0 border-border max-h-[90vh] overflow-y-auto">
          <div className="px-5 pt-5 pb-4 border-b border-border">
            <SheetHeader className="text-left">
              <SheetTitle className="text-xl">Time tracker</SheetTitle>
              <SheetDescription className="text-xs">
                {active
                  ? <>Tracking <span className="text-foreground font-medium">{activeCat?.name}</span> · <span className="font-mono tabular-nums">{fmtHMS(elapsedSec)}</span></>
                  : <>Today: <span className="text-foreground font-medium">{fmtHM(todayTotalSec)}</span></>}
              </SheetDescription>
            </SheetHeader>
          </div>

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

          <div className="px-5 pb-6 pt-2 text-[11px] text-secondary-fg text-center">
            Tracking runs in the background — close the app and it keeps counting.
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
