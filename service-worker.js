var CACHE = 'fp-reader-2.2';
var ASSETS = ['./', './index.html', './app.js', './parser.js', './ofp.js', './checks.js', './data/dow.json', './pdfload.js',
              './manifest.json', './icon.svg',
              './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first, so a deploy is never masked by a stale copy. The `no-cache`
// is load-bearing: GitHub Pages serves assets with max-age=600, and a plain
// fetch() reads the browser HTTP cache — which quietly made this cache-first.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;  // leave cross-origin alone

  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (m) {
          if (m) return m;
          // only a page navigation may fall back to the app shell
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});
