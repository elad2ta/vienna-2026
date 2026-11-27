// Offline support. Bump VERSION on every change so phones pick up the new version.
const VERSION = "v6";
const CACHE = "vienna-" + VERSION;
const CORE = ["./", "index.html", "family.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
// Only these outside hosts are cached; everything else (Firebase data and sign-in) always goes to the network.
const CACHE_HOSTS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const isCacheable = url => url.origin === self.location.origin || CACHE_HOSTS.includes(url.host) || (url.host === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
  "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap"
];

self.addEventListener("install", e => {
  // Take over right away, so a new version replaces the old code the next time the app opens
  // (without this, an app left open in the background kept running the previous version).
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE.map(u => new Request(u, { cache: "reload" })));
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
  if (req.mode !== "navigate" && !isCacheable(url)) return;

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
