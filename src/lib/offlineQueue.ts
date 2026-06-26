import { supabase } from "@/integrations/supabase/client";
import { listQueuedWrites, removeQueuedWrite, type QueuedWrite } from "@/lib/idbCache";

/**
 * Drains the offline write queue against Supabase.
 *
 * Anything in the IndexedDB queue is replayed in order. Each successful
 * replay removes the queue entry; failures stay in the queue for the next
 * online event so a flaky network doesn't lose work.
 *
 * Pair with `enqueueWrite` (in idbCache) at the call sites that mutate
 * Supabase. The typical pattern:
 *
 *   try { await supabase.from("...").insert(payload); }
 *   catch { await enqueueWrite({ table: "...", op: "insert", payload }); }
 */
let draining = false;

function isPermanentError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; status?: number };
  if (typeof e.code === "string") {
    if (e.code.startsWith("23") || e.code.startsWith("42") || e.code.startsWith("PGRST")) return true;
  }
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
    // 401/403 may be a transiently-expired session: the user went offline, the
    // JWT lapsed, and Supabase hasn't refreshed it yet at drain time. Treating
    // those as "permanent" silently deletes the user's queued offline edits.
    // Keep them queued so they replay after the token refreshes on reconnect.
    if (e.status === 401 || e.status === 403) return false;
    return true;
  }
  return false;
}

async function replay(item: QueuedWrite): Promise<boolean> {
  const table = supabase.from(item.table as never);
  try {
    if (item.op === "insert") {
      const { error } = await table.insert(item.payload as never);
      if (error && isPermanentError(error)) { console.warn("[offlineQueue] dropping permanently-failed write", item.table, item.op, (error)?.code); return true; }
      return !error;
    }
    if (item.op === "upsert") {
      const { error } = await table.upsert(item.payload as never);
      if (error && isPermanentError(error)) { console.warn("[offlineQueue] dropping permanently-failed write", item.table, item.op, (error)?.code); return true; }
      return !error;
    }
    if (item.op === "update") {
      let q = table.update(item.payload as never);
      for (const [k, v] of Object.entries(item.filter || {})) q = q.eq(k, v);
      const { error } = await q;
      if (error && isPermanentError(error)) { console.warn("[offlineQueue] dropping permanently-failed write", item.table, item.op, (error)?.code); return true; }
      return !error;
    }
    if (item.op === "delete") {
      let q = table.delete();
      for (const [k, v] of Object.entries(item.filter || {})) q = q.eq(k, v);
      const { error } = await q;
      if (error && isPermanentError(error)) { console.warn("[offlineQueue] dropping permanently-failed write", item.table, item.op, (error)?.code); return true; }
      return !error;
    }
  } catch {
    return false;
  }
  return false;
}

export async function drainOfflineQueue(): Promise<{ replayed: number; remaining: number }> {
  if (draining) return { replayed: 0, remaining: 0 };
  draining = true;
  let replayed = 0;
  try {
    const queue = await listQueuedWrites();
    for (const item of queue) {
      if (!item.id) continue;
      const ok = await replay(item);
      if (ok) {
        await removeQueuedWrite(item.id);
        replayed += 1;
      } else {
        // Transient failure — stop immediately to preserve write order.
        // The remaining items stay queued and will replay on the next online event.
        break;
      }
    }
    const remaining = (await listQueuedWrites()).length;
    return { replayed, remaining };
  } finally {
    draining = false;
  }
}

let listening = false;
export function startOfflineQueueDrainer(): () => void {
  if (typeof window === "undefined" || listening) return () => {};
  listening = true;
  const onOnline = () => { void drainOfflineQueue(); };
  window.addEventListener("online", onOnline);
  // Best-effort drain on boot in case we missed an `online` event between
  // sessions.
  if (navigator.onLine) void drainOfflineQueue();
  return () => {
    window.removeEventListener("online", onOnline);
    listening = false;
  };
}
