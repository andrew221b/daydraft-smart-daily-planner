import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { haptics } from "@/lib/haptics";

const PRESETS = [15, 30, 45, 60, 90, 120];

type Props = {
  open: boolean;
  onClose: () => void;
  value: number;
  onChange: (minutes: number) => void;
  title?: string;
};

export function DurationPicker({ open, onClose, value, onChange, title = "Duration" }: Props) {
  const [custom, setCustom] = useState(false);
  const [hours, setHours] = useState(Math.floor(value / 60));
  const [mins, setMins] = useState(value % 60);

  const apply = (v: number) => {
    onChange(Math.max(5, Math.min(480, v)));
    haptics.selection();
    onClose();
    setCustom(false);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { onClose(); setCustom(false); } }}>
      <SheetContent side="bottom" className="rounded-t-3xl border-soft bg-card pb-8">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        {!custom ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => apply(p)}
                  className={`h-14 rounded-xl border pressable text-sm font-medium tabular-nums transition-colors ${
                    value === p
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "surface-card border-soft text-foreground hover:border-primary/40"
                  }`}
                >
                  {p < 60 ? `${p} min` : p === 60 ? "1 hr" : `${p / 60} hr`}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setCustom(true); setHours(Math.floor(value / 60)); setMins(value % 60); }}
              className="w-full h-12 rounded-xl border border-dashed border-soft surface-soft text-sm text-secondary-fg pressable hover:text-foreground hover:border-primary/40"
            >
              Custom…
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <WheelPicker hours={hours} mins={mins} onHours={setHours} onMins={setMins} />
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setCustom(false)}>Back</Button>
              <Button className="flex-1" onClick={() => apply(hours * 60 + mins)}>Set</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function WheelPicker({
  hours, mins, onHours, onMins,
}: { hours: number; mins: number; onHours: (n: number) => void; onMins: (n: number) => void }) {
  const HOURS = Array.from({ length: 9 }, (_, i) => i); // 0-8h
  const MINS = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...55
  return (
    <div className="relative h-44 rounded-xl surface-card border border-soft overflow-hidden">
      {/* Center selection band */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 bg-primary/10 border-y border-primary/20" />
      <div className="grid grid-cols-2 h-full">
        <Wheel items={HOURS} value={hours} onChange={onHours} suffix="h" />
        <Wheel items={MINS} value={mins} onChange={onMins} suffix="m" />
      </div>
    </div>
  );
}

function Wheel({ items, value, onChange, suffix }: { items: number[]; value: number; onChange: (n: number) => void; suffix: string }) {
  const ITEM_H = 40;
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const idx = Math.round(e.currentTarget.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    if (items[clamped] !== value) {
      onChange(items[clamped]);
      haptics.selection();
    }
  };
  return (
    <div
      className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
      style={{ scrollPaddingTop: "72px" }}
      onScroll={handleScroll}
      ref={(el) => {
        if (el) {
          const target = items.indexOf(value) * ITEM_H;
          if (Math.abs(el.scrollTop - target) > 4) el.scrollTop = target;
        }
      }}
    >
      <div style={{ height: "72px" }} />
      {items.map((n) => (
        <div
          key={n}
          className={`h-10 snap-center flex items-center justify-center tabular-nums text-base transition-all ${
            n === value ? "text-foreground font-semibold" : "text-faint"
          }`}
        >
          {n}{suffix}
        </div>
      ))}
      <div style={{ height: "72px" }} />
    </div>
  );
}