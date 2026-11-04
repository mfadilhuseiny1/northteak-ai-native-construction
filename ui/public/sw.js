/* Keeps the site's screen opening with no signal. It holds the page and the scripts and styles it needs, never the records: those are kept by the page itself, and every /api request goes straight to the network. */

const CACHE = "northteak-field-1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/field")));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/")) {  // named by their content, so a kept copy is never stale
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })));
    return;
  }
  if (e.request.mode === "navigate") {  // the newest page when there is signal, the kept one when there is not
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then((c) => c.put("/field", copy)); return r; }).catch(() => caches.match("/field")));
  }
});
