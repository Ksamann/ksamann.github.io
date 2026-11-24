/* Service worker for Linjeblikk. Caches the app shell so it opens instantly
   and without signal; realtime data (api.entur.io) is never cached here.
   Bump VERSION when the file list changes. */
const VERSION = "linjeblikk-v1";
const FILES = [
  "linjeblikk.html",
  "linjeblikk.webmanifest",
  "fonts/fonts.css",
  "fonts/barlow-400.woff2",
  "fonts/barlow-500.woff2",
  "fonts/barlow-600.woff2",
  "fonts/barlow-semi-condensed-500.woff2",
  "fonts/barlow-semi-condensed-600.woff2",
  "fonts/barlow-semi-condensed-700.woff2",
  "fonts/barlow-semi-condensed-800.woff2",
  "fonts/jetbrains-mono.woff2",
  "icons/linjeblikk.svg",
  "icons/linjeblikk-180.png",
  "icons/linjeblikk-192.png",
  "icons/linjeblikk-512.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("linjeblikk-") && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, {ignoreSearch: true});
    const fresh = fetch(req).then(res => { if (res && res.ok && res.type === "basic") cache.put(req, res.clone()); return res; });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  })());
});
