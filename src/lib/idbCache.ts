/**
 * Minimal IndexedDB cache layer.
 *
 * Two stores:
 *   - `data`  : keyed snapshots (e.g. `rolling-entries:USERID`) holding the
 *               last successful response from Supabase. Reads hit this first
 *               so the app paints instantly on cold start; the live fetch
 *               then hydrates the React Query cache in the background.
 *   - `queue` : pending writes that failed because the network was offline
 *               or Supabase returned a transient error. Each entry knows how
 *               to replay itself (table, op, payload). Drained on
 *               `online` event.
 *
 * No external dependency — wraps the native IDB API directly. ~120 lines.
 */

const DB_NAME = "daydraft";
const DB_VERSION = 1;
const STORE_DATA = "data";
const STORE_QUEUE = "queue";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.reject(new Error("IndexedDB unavailable"));
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DATA)) {
        db.createObjectStore(STORE_DATA);
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb open failed"));
  });
  return dbPromise;
}

type Snapshot<T> = { savedAt: number; value: T };

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_DATA, "readonly");
      const store = tx.objectStore(STORE_DATA);
      const req = store.get(key);
      req.onsuccess = () => {
        const snap = req.result as Snapshot<T> | undefined;
        resolve(snap ? snap.value : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DATA, "readwrite");
      const store = tx.objectStore(STORE_DATA);
      const snap: Snapshot<T> = { savedAt: Date.now(), value };
      const req = store.put(snap, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* quota or unavailable — best effort */
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DATA, "readwrite");
      const req = tx.objectStore(STORE_DATA).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
}

/* ───────── Offline write queue ───────── */

export type QueuedWrite = {
  id?: number;
  table: string;
  op: "insert" | "update" | "delete" | "upsert";
  payload?: unknown;
  filter?: Record<string, unknown>;
  queuedAt: number;
};

export async function enqueueWrite(item: Omit<QueuedWrite, "id" | "queuedAt">): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, "readwrite");
      const req = tx.objectStore(STORE_QUEUE).add({ ...item, queuedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* best effort */
  }
}

export async function listQueuedWrites(): Promise<QueuedWrite[]> {
  try {
    const db = await openDb();
    return await new Promise<QueuedWrite[]>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, "readonly");
      const req = tx.objectStore(STORE_QUEUE).getAll();
      req.onsuccess = () => resolve((req.result || []) as QueuedWrite[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function removeQueuedWrite(id: number): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, "readwrite");
      const req = tx.objectStore(STORE_QUEUE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
}
