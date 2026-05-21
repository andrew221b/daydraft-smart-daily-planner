/**
 * Timer tick worker.
 *
 * Lives in its own thread so the tick keeps firing even when the document is
 * throttled (background tab, locked phone, focused input). The main thread
 * subscribes via `useTimeTracker` and writes the live timer into the DOM
 * without re-rendering React.
 *
 * Protocol:
 *   main → worker: { type: "start"; startedAtMs: number }
 *                  { type: "stop" }
 *                  { type: "ping" }                       // resync request
 *   worker → main: { type: "tick"; elapsedSec: number; nowMs: number }
 *                  { type: "drift"; drift: number }       // observed drift
 */

type Inbound =
  | { type: "start"; startedAtMs: number }
  | { type: "stop" }
  | { type: "ping" };

type Outbound =
  | { type: "tick"; elapsedSec: number; nowMs: number }
  | { type: "drift"; drift: number };

let intervalId: number | null = null;
let alignmentId: number | null = null;
let startedAtMs: number | null = null;
let lastTickMs = 0;

const post = (msg: Outbound) => (self as unknown as Worker).postMessage(msg);

function tick() {
  if (startedAtMs == null) return;
  const nowMs = Date.now();
  const elapsedSec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  // Drift = how far the actual tick deviated from the expected 1s cadence.
  if (lastTickMs > 0) {
    const drift = nowMs - lastTickMs - 1000;
    if (Math.abs(drift) > 2000) {
      post({ type: "drift", drift });
    }
  }
  lastTickMs = nowMs;
  post({ type: "tick", elapsedSec, nowMs });
}

function clearTimers() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (alignmentId != null) {
    clearTimeout(alignmentId);
    alignmentId = null;
  }
}

function startTicking(startMs: number) {
  clearTimers();
  startedAtMs = startMs;
  lastTickMs = 0;
  tick();
  // Align to the next wall-clock second so digits flip on the second boundary.
  const msToNextSec = 1000 - (Date.now() % 1000);
  alignmentId = setTimeout(() => {
    tick();
    intervalId = setInterval(tick, 1000) as unknown as number;
  }, msToNextSec) as unknown as number;
}

self.addEventListener("message", (e: MessageEvent<Inbound>) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "start") {
    startTicking(msg.startedAtMs);
  } else if (msg.type === "stop") {
    clearTimers();
    startedAtMs = null;
    lastTickMs = 0;
  } else if (msg.type === "ping") {
    if (startedAtMs != null) tick();
  }
});

export {}; // keep TS module
