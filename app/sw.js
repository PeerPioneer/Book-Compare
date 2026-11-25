// Book Compare's service worker: keeps the website's files so that it also opens without a connection.
// Change CACHE_NAME whenever a file listed here changes, so that the browsers load the new files.
const CACHE_NAME = "imcomp-mdc-pwa-v33";
const staticAssets = [
    './',
    './favicon.ico',
    './manifest.json',
    './index.html',
    './licenses.txt',
    './images/icons/imcomp-512x512.png',
    './images/icons/imcomp-256x256.png',
    './images/icons/imcomp-192x192.png',
    './images/icons/imcomp-128x128.png',
    './images/logo/imcomp-logo-large-path.svg',
    './images/empty.svg',
    './js/action.js',
    './js/compare.js',
    './js/panes.js',
    './js/main.js',
    './js/examples.js',
    './js/workspace.js',
    './js/workspace.css',
    './js/compare-annot.js',
    './js/compare-box.js',
    './js/speedtest.js',
    './js/align-engine.js',
    './js/align-worker.js',
    './js/project-pack.js',
    './js/results-store.js',
    './js/background-align.js',
    './js/compare-tab.js',
    './js/compare-tab.css',
    './js/viz.js',
    './js/transform.js',
    './deps/gifshot.js',
    './deps/material-components-web.min.js',
    './deps/material-components-web.min.css',
    './fonts/material-icons.ttf',
    './images/examples/welcome-1.jpg',
    './images/examples/welcome-2.jpg',
    './images/usecases/book/case2-traherne2-a-original.jpg',
    './images/usecases/book/case2-traherne2-b-original.jpg',
    './images/usecases/music/case5-music-sheet-1.jpg',
    './images/usecases/music/case5-music-sheet-2.jpg',
    './images/usecases/puzzle/case6-puzzle-1-a.jpg',
    './images/usecases/puzzle/case6-puzzle-1-b.jpg',
]

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(staticAssets);
        })
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter((cacheName) => {
                    return cacheName.startsWith('imcomp-mdc-pwa') &&
                           cacheName != CACHE_NAME;
                }).map((cacheName) => {
                    return caches.delete(cacheName)
                })
            );
        })
    );
});

async function cacheFirst(req) {
    try {
        const cachedResponse = await caches.match(req);
        return cachedResponse || fetch(req);
    } catch(_e) {
        return fetch(req);
    }
}

self.addEventListener('fetch', event => {
    // the helper's folder access (/api/...) is never cached and never touched here
    if (new URL(event.request.url).pathname.indexOf('/api/') === 0) return;
    event.respondWith(cacheFirst(event.request));
});

self.addEventListener('message', (e) => {
    if (e.data.action == 'skipWaiting') {
        self.skipWaiting();
    }
});
