/* Service worker for Banepuls. Serves the app from the cache first so it opens with no
   signal, and refreshes the cache in the background. Realtime data (api.entur.io) and the
   clock-sync requests (HEAD with ?cs=) always go to the network. Bump VERSION when the file list changes. */
const VERSION = "banepuls-v3";
const FILES = [
  "./", "index.html", "guide.html", "analyse.html", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png",
  "js/app.js", "js/core.js", "js/entur.js", "js/live.js", "js/clock.js", "js/model.js", "js/export.js", "js/motion.js", "js/analyse.js", "js/timetable.js",
  "../fonts/fonts.css", "../fonts/barlow-400.woff2", "../fonts/barlow-500.woff2", "../fonts/barlow-600.woff2",
  "../fonts/barlow-semi-condensed-500.woff2", "../fonts/barlow-semi-condensed-600.woff2", "../fonts/barlow-semi-condensed-700.woff2",
  "../fonts/barlow-semi-condensed-800.woff2", "../fonts/jetbrains-mono.woff2"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("banepuls-") && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.searchParams.has("cs")) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, {ignoreSearch: true});
    const fresh = fetch(req).then(res => { if (res && res.ok && res.type === "basic") cache.put(req, res.clone()); return res; });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  })());
});
