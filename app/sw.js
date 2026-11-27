// Book Compare's service worker: keeps the website's files so that it also opens without a connection.
// Change CACHE_NAME whenever a file listed here changes, so that the browsers load the new files.
const CACHE_NAME = "imcomp-mdc-pwa-v38";
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
      './js/align-engine.js',
    './js/align-worker.js',
    './js/project-pack.js',
    './js/results-store.js',
    './js/background-align.js',
  './js/alignment-report.js',
    './js/compare-tab.js',
    './js/compare-tab.css',
    './js/viz.js',
    './js/transform.js',
    './deps/gifshot.js',
    './deps/material-components-web.min.js',
    './deps/material-components-web.min.css',
    './fonts/material-icons.ttf',
    './fonts/eb-garamond.woff2',
    './fonts/eb-garamond-italic.woff2',
    './fonts/sourcesans3-regular.woff2',
    './fonts/sourcesans3-italic.woff2',
    './fonts/firasans-light.woff2',
    './fonts/firasans-regular.woff2',
    './fonts/firasans-medium.woff2',
    './fonts/firasans-semibold.woff2',
    './fonts/firasans-bold.woff2',
    './fonts/firasans-italic.woff2',
    './fonts/firasans-bolditalic.woff2',
    './fonts/alegreyasans-light.woff2',
    './fonts/alegreyasans-regular.woff2',
    './fonts/alegreyasans-medium.woff2',
    './fonts/alegreyasans-bold.woff2',
    './fonts/alegreyasans-italic.woff2',
    './fonts/alegreyasans-bolditalic.woff2',
    './fonts/figtree-regular.woff2',
    './fonts/figtree-italic.woff2',
    './fonts/dmsans-regular.woff2',
    './fonts/dmsans-italic.woff2',
    './fonts/jost-regular.woff2',
    './fonts/jost-italic.woff2',
    './fonts/publicsans-regular.woff2',
    './fonts/publicsans-italic.woff2',
    './fonts/librefranklin-regular.woff2',
    './fonts/librefranklin-italic.woff2',
    './fonts/schibstedgrotesk-regular.woff2',
    './fonts/schibstedgrotesk-italic.woff2',
    './fonts/inter-regular.woff2',
    './fonts/inter-italic.woff2',
    './fonts/ibmplexsans-regular.woff2',
    './fonts/ibmplexsans-italic.woff2',
    './fonts/hankengrotesk-regular.woff2',
    './fonts/hankengrotesk-italic.woff2',
    './fonts/nunito-regular.woff2',
    './fonts/nunito-italic.woff2',
    './fonts/snpro-regular.woff2',
    './fonts/snpro-italic.woff2',
    './fonts/asap-regular.woff2',
    './fonts/asap-italic.woff2',
    './fonts/exo2-regular.woff2',
    './fonts/exo2-italic.woff2',
    './fonts/baijamjuree-light.woff2',
    './fonts/baijamjuree-regular.woff2',
    './fonts/baijamjuree-medium.woff2',
    './fonts/baijamjuree-semibold.woff2',
    './fonts/baijamjuree-bold.woff2',
    './fonts/baijamjuree-italic.woff2',
    './fonts/baijamjuree-bolditalic.woff2',
    './fonts/saira-regular.woff2',
    './fonts/saira-italic.woff2',
    './fonts/amarna-regular.woff2',
    './fonts/amarna-italic.woff2',
    './fonts/libertinussans-regular.woff2',
    './fonts/libertinussans-bold.woff2',
    './fonts/libertinussans-italic.woff2',
    './fonts/philosopher-regular.woff2',
    './fonts/philosopher-bold.woff2',
    './fonts/philosopher-italic.woff2',
    './fonts/philosopher-bolditalic.woff2',
    './fonts/roboto-regular.woff2',
    './fonts/roboto-italic.woff2',
    './images/examples/welcome-1.jpg',
    './images/examples/welcome-2.jpg',
    './images/examples/bent-1.jpg',
    './images/examples/bent-2.jpg',
    './images/examples/book-1.jpg',
    './images/examples/book-2.jpg',
    './images/examples/book-3.jpg',
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
