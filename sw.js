const CACHE = "daymark-v25";
const FILES = ["./", "./index.html", "./styles.css?v=25", "./sync.js?v=25", "./school.js?v=25", "./app.js?v=25", "./OG_Sync.svg", "./manifest.webmanifest"];

self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method === "GET") event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
