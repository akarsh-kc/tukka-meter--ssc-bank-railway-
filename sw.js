// Bump this on every deploy (or automate it — see notes below).
const CACHE_NAME = "tukka-meter-cache-v5";
const CORE_ASSETS = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apps/ssc.html",
  "./apps/railway.html",
  "./apps/bank.html",
  "./apps/maths.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  // Don't auto-skipWaiting here — we let the page decide when to activate
  // the new SW (see the SKIP_WAITING message handler below), so an update
  // never yanks the rug out from under a user mid-session.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Let the page tell a waiting SW to take over immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network-first for the top-level hub shell only (index.html / any direct
  // navigation) — so a new deploy of the shell itself is picked up right
  // away. Falls back to cache only when offline.
  const isHubRequest =
    req.mode === "navigate" ||
    (req.method === "GET" && url.origin === self.location.origin && url.pathname.endsWith("index.html"));

  if (isHubRequest) {
    const cleanUrl = url.origin + url.pathname;
    event.respondWith(
      fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cleanUrl, clone));
          return response;
        })
        .catch(() =>
          caches.match(cleanUrl).then((cached) => cached || caches.match("./index.html"))
        )
    );
    return;
  }

  // Stale-while-revalidate for the category app pages loaded inside the
  // iframe (apps/ssc.html, apps/railway.html, apps/bank.html, apps/maths.html).
  // These get requested every time the user switches exam category, so
  // waiting on the network first (as index.html does) made every switch feel
  // slow. Instead: serve the cached copy instantly if we have one, and
  // refresh the cache from the network in the background so the *next*
  // switch (or next launch) picks up any new deploy — the best of both
  // speed and freshness, without ever blocking the switch on a round-trip.
  const isAppPageRequest =
    req.method === "GET" && url.origin === self.location.origin && url.pathname.endsWith(".html");

  if (isAppPageRequest) {
    // Strip cache-busting query strings (e.g. "?ts=169...") down to the
    // clean path so lookups/writes stay keyed consistently.
    const cleanUrl = url.origin + url.pathname;

    event.respondWith(
      caches.match(cleanUrl).then((cached) => {
        const networkFetch = fetch(req)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(cleanUrl, clone));
            return response;
          })
          .catch(() => cached || caches.match("./index.html"));

        // Cached? Return it immediately (instant switch) and let the
        // network fetch above update the cache silently in the background.
        // Nothing cached yet (first-ever load of this app)? Wait on network.
        return cached || networkFetch;
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Cache-first for other same-origin static assets (icons, manifest).
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            return response;
          })
          .catch(() => cached);
      })
    );
  } else {
    // CDN requests (Tailwind, Chart.js, fonts): network first, cache fallback.
    event.respondWith(
      fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return response;
        })
        .catch(() => caches.match(req))
    );
  }
});
