// Auto Parts & Repairs service worker: makes the app installable and keeps
// the screens loading on a poor connection. Network first, so staff always
// get the latest version when online; cached copies are only a fallback.
// Data from Supabase is never cached here.
const CACHE = "apr-v1";
const SHELL = ["/", "/index.html", "/login.html", "/css/style.css", "/css/mh-theme.css", "/assets/logo.png", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/login.html") : Response.error()))
    )
  );
});
