const CACHE_NAME = 'lacajitatv-cache-v1';
const ASSETS_TO_CACHE = ['/', '/index.html', '/styles.css', '/manifest.json', '/images/102.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    // Solo manejamos peticiones GET
    if (event.request.method !== 'GET') return;

    // Estrategia: Stale-While-Revalidate para assets locales,
    // Network-first para la API
    const url = new URL(event.request.url);

    if (url.origin === location.origin) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                const fetchPromise = fetch(event.request)
                    .then(networkResponse => {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, networkResponse.clone());
                        });
                        return networkResponse;
                    })
                    .catch(() => cachedResponse); // fallback al cache si falla red

                return cachedResponse || fetchPromise;
            })
        );
    } else {
        // Peticiones externas (API, HLS, imágenes de terceros)
        event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    }
});
