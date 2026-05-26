/**
 * Lightweight performance monitoring.
 *
 * - Time-to-Interactive on app open (logged once when network goes idle).
 * - AI call duration tracking (one bucket per function name).
 * - Cache hit/miss counter for AI responses.
 * - Slow-render warnings (anything over 16ms while we're in a "live tick").
 * - Timer drift counter from the timer worker.
 *
 * The data is exposed via `getPerfSnapshot()` so the hidden debug panel in
 * Settings can render it. Everything runs in-memory; no network and no
 * dependencies — adds <1kB gzipped.
 */

export type PerfBucket = {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
};

type State = {
  startedAt: number;
  tti: number | null;
  aiCalls: Record<string, PerfBucket>;
  aiCacheHits: number;
  aiCacheMisses: number;
  slowRenders: { name: string; ms: number; ts: number }[];
  timerDrift: { samples: number; lastDriftMs: number };
};

const state: State = {
  startedAt: typeof performance !== "undefined" ? performance.now() : 0,
  tti: null,
  aiCalls: {},
  aiCacheHits: 0,
  aiCacheMisses: 0,
  slowRenders: [],
  timerDrift: { samples: 0, lastDriftMs: 0 },
};

function bucket(name: string): PerfBucket {
  if (!state.aiCalls[name]) {
    state.aiCalls[name] = {
      count: 0,
      totalMs: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: 0,
      lastMs: 0,
    };
  }
  return state.aiCalls[name];
}

export function recordAiCall(name: string, ms: number): void {
  const b = bucket(name);
  b.count += 1;
  b.totalMs += ms;
  b.lastMs = ms;
  if (ms < b.minMs) b.minMs = ms;
  if (ms > b.maxMs) b.maxMs = ms;
}

export function recordAiCacheHit(): void {
  state.aiCacheHits += 1;
}

export function recordAiCacheMiss(): void {
  state.aiCacheMisses += 1;
}

export function recordTimerDrift(driftMs: number): void {
  state.timerDrift.samples += 1;
  state.timerDrift.lastDriftMs = driftMs;
}

/**
 * Mark Time-to-Interactive: called once the first meaningful tab has rendered
 * its first paint. Idempotent — only the first call sticks.
 */
export function markTTI(): void {
  if (state.tti != null) return;
  if (typeof performance === "undefined") return;
  state.tti = performance.now() - state.startedAt;
  if (state.tti > 1500) {
    console.warn(`[perf] TTI=${state.tti.toFixed(0)}ms (target <1000ms on 4G)`);
  }
}

/**
 * Wrap a render-critical block to warn when it exceeds the 16ms frame budget.
 * Cheap: only takes a timestamp on each call.
 */
export function trackRender<T>(name: string, fn: () => T): T {
  if (typeof performance === "undefined") return fn();
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  if (ms > 16) {
    state.slowRenders.push({ name, ms, ts: Date.now() });
    if (state.slowRenders.length > 50) state.slowRenders.shift();
    if (ms > 32) {
      console.warn(`[perf] slow render: ${name} took ${ms.toFixed(1)}ms`);
    }
  }
  return out;
}

export function getPerfSnapshot() {
  return {
    tti: state.tti,
    aiCalls: { ...state.aiCalls },
    aiCacheHits: state.aiCacheHits,
    aiCacheMisses: state.aiCacheMisses,
    slowRenders: [...state.slowRenders],
    timerDrift: { ...state.timerDrift },
  };
}

export function resetPerfSnapshot(): void {
  state.tti = null;
  state.aiCalls = {};
  state.aiCacheHits = 0;
  state.aiCacheMisses = 0;
  state.slowRenders = [];
  state.timerDrift = { samples: 0, lastDriftMs: 0 };
}
