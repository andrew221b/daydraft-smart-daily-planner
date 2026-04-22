import { useState } from "react";
import { Play, Pause, Plus, Check, Trash2 } from "lucide-react";
import { useTimeTracker, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

export function TrackerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { active, elapsedSec, categories, start, stop, switchCategory, addCategory, deleteCategory, todayTotalSec } = useTimeTracker();
  const [newName, setNewName] = useState("");

  const activeCat = categories.find(c => c.id === active?.category_id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
  );
}
