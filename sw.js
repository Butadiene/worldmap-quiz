/* Service worker — offline caching for 世界地図クイズ
   Bump CACHE version to force an update after changing files. */
const CACHE = "worldquiz-v35";

const LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./countries.js",
  "./explanations.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const CDN_ASSETS = [
  "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js",
  "https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js",
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json",
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Local assets must all succeed.
    await cache.addAll(LOCAL_ASSETS);
    // CDN assets: cache individually so one failure doesn't abort install.
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: "cors" });
        if (res.ok) await cache.put(url, res.clone());
      } catch (e) { /* will be cached on first successful runtime fetch */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // Cache successful same-origin and CDN responses for later offline use.
      if (res && (res.ok || res.type === "opaque")) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (e) {
      // Offline & not cached: for navigations, fall back to the app shell.
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
