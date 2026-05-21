import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { getPerfSnapshot, resetPerfSnapshot, type PerfBucket } from "@/lib/perfMonitor";
import { invalidateAiCache } from "@/lib/aiCache";

/**
 * Hidden developer panel — opened by tapping the app version label 10 times
 * in Settings (matches iOS Developer Mode). Shows:
 *
 *   - Time to Interactive on app open
 *   - Per-function AI call metrics (count, avg, min, max ms)
 *   - AI cache hit ratio
 *   - Recent slow renders (>16ms)
 *   - Timer drift samples from the worker
 *
 * No production cost: this component is only mounted inside Settings, and
 * the underlying counters are O(1) per call. Reset and cache-flush buttons
 * are provided so testers can repeat scenarios cleanly.
 */
export function PerfDebugPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState(() => getPerfSnapshot());
  const [tick, setTick] = useState(0);

  // Refresh once a second while the panel is open. We deliberately avoid
  // mounting an interval when closed so the panel has zero cost in normal
  // use.
  useEffect(() => {
    if (!open) return;
    setSnapshot(getPerfSnapshot());
    const id = window.setInterval(() => {
      setSnapshot(getPerfSnapshot());
      setTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  void tick;

  const aiCallEntries = Object.entries(snapshot.aiCalls);
  const totalCacheRequests = snapshot.aiCacheHits + snapshot.aiCacheMisses;
  const hitRatio = totalCacheRequests > 0
    ? Math.round((snapshot.aiCacheHits / totalCacheRequests) * 100)
    : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[24px] border-soft max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-[17px]">Performance · Debug</SheetTitle>
          <SheetDescription className="text-[13px]">
            Counters reset on reload. Tap the version label 10× to reopen.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-5 pb-6 text-[13px]">
          <Section title="App load">
            <Row label="Time to Interactive">
              <Value>
                {snapshot.tti != null ? `${Math.round(snapshot.tti)} ms` : "—"}
              </Value>
            </Row>
          </Section>

          <Section title="AI calls">
            <Row label="Cache hit ratio">
              <Value>
                {totalCacheRequests > 0 ? `${hitRatio}% (${snapshot.aiCacheHits}/${totalCacheRequests})` : "—"}
              </Value>
            </Row>
            {aiCallEntries.length === 0 ? (
              <p className="text-secondary-fg pt-1 text-[12px]">No AI calls yet this session.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {aiCallEntries.map(([name, b]) => (
                  <CallRow key={name} name={name} bucket={b} />
                ))}
              </div>
            )}
          </Section>

          <Section title="Slow renders (>16ms)">
            {snapshot.slowRenders.length === 0 ? (
              <p className="text-secondary-fg pt-1 text-[12px]">No frames dropped.</p>
            ) : (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {snapshot.slowRenders.slice(-12).reverse().map((r, i) => (
                  <div key={i} className="flex justify-between text-[12px]">
                    <span className="truncate">{r.name}</span>
                    <span className={`tabular-nums ${r.ms > 32 ? "text-destructive" : "text-secondary-fg"}`}>
                      {r.ms.toFixed(1)} ms
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Timer worker">
            <Row label="Drift samples">
              <Value>{snapshot.timerDrift.samples}</Value>
            </Row>
            <Row label="Last drift">
              <Value>
                {snapshot.timerDrift.samples === 0
                  ? "—"
                  : `${snapshot.timerDrift.lastDriftMs > 0 ? "+" : ""}${snapshot.timerDrift.lastDriftMs} ms`}
              </Value>
            </Row>
          </Section>

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1 h-10 rounded-xl border-soft text-[12px]"
              onClick={() => {
                resetPerfSnapshot();
                setSnapshot(getPerfSnapshot());
              }}
            >
              Reset counters
            </Button>
            <Button
              variant="outline"
              className="flex-1 h-10 rounded-xl border-soft text-[12px]"
              onClick={() => invalidateAiCache()}
            >
              Flush AI cache
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-secondary-fg mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground">{label}</span>
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular-nums text-foreground text-[12.5px]">{children}</span>;
}

function CallRow({ name, bucket }: { name: string; bucket: PerfBucket }) {
  const avg = bucket.count > 0 ? bucket.totalMs / bucket.count : 0;
  return (
    <div className="rounded-lg border border-border/40 px-3 py-1.5 surface-card">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[12.5px] truncate">{name}</span>
        <span className="text-[11px] text-secondary-fg tabular-nums">
          {bucket.count}× · avg {Math.round(avg)} ms
        </span>
      </div>
      <div className="text-[10.5px] text-secondary-fg tabular-nums mt-0.5">
        min {Math.round(bucket.minMs)} · max {Math.round(bucket.maxMs)} · last {Math.round(bucket.lastMs)} ms
      </div>
    </div>
  );
}
