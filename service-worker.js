var CACHE = 'notam-reader-1.2';
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
// Network-first for app files, so an update is never masked by a stale cache.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var sameOrigin = new URL(req.url).origin === self.location.origin;
  // Never touch cross-origin requests: caching them is pointless here, and
  // answering a failed one with index.html turns a network error into a
  // baffling "invalid PDF" further up the stack.
  if (!sameOrigin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (m) {
        if (m) return m;
        // only a page navigation may fall back to the shell
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
