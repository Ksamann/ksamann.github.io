/* Service worker for the T-bane timing logger.
   Serves the app from the cache first, so it opens and reloads with no signal
   (in tunnels, on underground platforms). Each time it is served from the cache,
   a fresh copy is fetched in the background when the network allows, so an
   update reaches the phone on the next open. Bump VERSION when the file list changes. */
const VERSION = "tbane-v1";
const FILES = [
  "tbane.html",
  "tbane-guide.html",
  "tbane.webmanifest",
  "fonts/fonts.css",
  "fonts/barlow-400.woff2",
  "fonts/barlow-500.woff2",
  "fonts/barlow-600.woff2",
  "fonts/barlow-semi-condensed-500.woff2",
  "fonts/barlow-semi-condensed-600.woff2",
  "fonts/barlow-semi-condensed-700.woff2",
  "fonts/barlow-semi-condensed-800.woff2",
  "fonts/jetbrains-mono.woff2",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("tbane-") && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, {ignoreSearch: true});
    const fresh = fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  })());
});
