var CACHE = 'notam-reader-1.1';
var ASSETS = ['./', './index.html', './app.js', './parser.js', './pdfload.js',
              './manifest.json', './icon.svg',
              './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
    return self.skipWaiting();
  }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// network-first for app files so updates are never masked by a stale cache
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request).then(function (m) {
      return m || caches.match('./index.html');
    }); })
  );
});
