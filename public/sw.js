/* DayDraft service worker — push notifications + caching strategies. */

const VERSION = "v3";
const SHELL_CACHE = `dd-shell-${VERSION}`;
const ASSET_CACHE = `dd-assets-${VERSION}`;
const API_CACHE = `dd-api-${VERSION}`;
const AI_CACHE = `dd-ai-${VERSION}`;

// App-shell entries pre-cached at install time. index.html is the SPA
// entry — caching it cache-first means cold loads stay sub-second even on
// flaky networks.
const SHELL_PRECACHE = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop stale caches from previous deploys.
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("dd-") && !k.endsWith(`-${VERSION}`))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

const isAssetUrl = (url) =>
  /\/assets\/.+\.(?:js|css|woff2?|png|svg|webp|jpg|jpeg|ico)$/i.test(url.pathname);

const isApiUrl = (url) =>
  url.hostname.endsWith(".supabase.co") &&
  !url.pathname.includes("/functions/v1/"); // edge functions = AI

const isAiUrl = (url) =>
  url.hostname.endsWith(".supabase.co") && url.pathname.includes("/functions/v1/");

const isNavigation = (request) =>
  request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function networkFirst(request, cacheName, timeoutMs = 4000) {
  const cache = await caches.open(cacheName);
  try {
    const networkPromise = fetch(request);
    const timed = new Promise((_, reject) => setTimeout(() => reject(new Error("net-timeout")), timeoutMs));
    const response = await Promise.race([networkPromise, timed]);
    if (response.ok && request.method === "GET") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Skip dev-server / HMR sockets.
  if (url.protocol === "ws:" || url.protocol === "wss:") return;

  // App shell SPA navigation: cache-first with network fallback so the app
  // shell opens instantly on cold load and the user sees content under 1s
  // even on 4G.
  if (isNavigation(request) && url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match("/index.html");
        if (cached) {
          // Refresh shell in the background.
          fetch(request).then((r) => { if (r.ok) cache.put("/index.html", r.clone()); }).catch(() => {});
          return cached;
        }
        return fetch(request);
      }),
    );
    return;
  }

  // Same-origin hashed assets: cache-first by URL — the hash is the version.
  if (url.origin === self.location.origin && isAssetUrl(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Supabase data: network-first with cache fallback so users keep working
  // offline (last-seen data) but always get fresh data when online.
  if (isApiUrl(url)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // AI edge functions: cache-only after first response — these are
  // expensive and idempotent for the same input. Falls back to network for
  // misses. The app-level cache (lib/aiCache.ts) handles TTL semantics; the
  // SW layer is the second line so cross-session repeat asks are instant.
  if (isAiUrl(url)) {
    event.respondWith(staleWhileRevalidate(request, AI_CACHE));
    return;
  }
});

/* ───────── Push notifications ───────── */

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "DayDraft", body: event.data?.text() }; }
  const title = data.title || "DayDraft";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/today" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/today";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) { w.navigate(url); return w.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
