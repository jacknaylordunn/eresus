const CACHE_NAME = 'eresus-cache-v11';
const urlsToCache = [
  '/',
  'https://cdn.tailwindcss.com',
  'https://esm.sh/react@18.2.0',
  'https://esm.sh/react-dom@18.2.0/client',
  'https://14555222.fs1.hubspotusercontent-eu1.net/hubfs/14555222/eResus.jpg',
  'https://www.resus.org.uk/sites/default/files/2023-08/Post%20cardiac%20arrest%20rehabilitation%20algorithim%202023.png',
  'https://www.resus.org.uk/sites/default/files/2021-04/als-algorithm-2021-1-724x1024.jpg',
  'https://www.resus.org.uk/sites/default/files/2021-04/pals-algorithm-2021-724x1024.jpg',
  'https://www.resus.org.uk/sites/default/files/2021-04/nls-algorithm-2021-724x1024.jpg'
];

self.addEventListener('install', event => {
  // Force the waiting service worker to become the active service worker.
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        // Use 'no-cors' for third-party resources if they don't support CORS
        const requests = urlsToCache.map(url => {
          if (url.startsWith('https://www.resus.org.uk')) {
            return new Request(url, { mode: 'no-cors' });
          }
          return new Request(url, { mode: 'cors' });
        });
        return Promise.all(
          requests.map(req => cache.add(req).catch(err => console.warn('Failed to cache:', req.url, err)))
        );
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) { return response; }
        return fetch(event.request).then(
          networkResponse => {
             if(networkResponse && networkResponse.status === 200) {
                 const responseToCache = networkResponse.clone();
                 caches.open(CACHE_NAME).then(cache => {
                     cache.put(event.request, responseToCache);
                 });
             }
             return networkResponse;
          }
        ).catch(err => {});
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Tell the active service worker to take control of the page immediately.
      return self.clients.claim();
    })
  );
});
