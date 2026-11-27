// Offline support. Bump VERSION on every change so phones pick up the new version.
const VERSION = "v2";
const CACHE = "vienna-" + VERSION;
const CORE = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
  "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE);
    await Promise.all(CDN.map(u => fetch(u, { mode: "no-cors" }).then(r => c.put(u, r)).catch(() => {})));
  }));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;               // the internet check uses HEAD: always goes to the network
  const url = new URL(req.url);
  if (url.searchParams.has("ping")) return;

  // Pages: network first so updates show up when online, cache when offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); return r;
    }).catch(() => caches.match("index.html")));
    return;
  }
  // Everything else (icons, fonts, QR library): cache first, then network and keep a copy.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
