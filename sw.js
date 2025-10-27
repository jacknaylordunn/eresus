const CACHE_NAME = 'eresus-react-v1';
const urlsToCache = [
  // Core files
  '/',
  '/manifest.json',

  // App icon (from manifest)
  'https://145955222.fs1.hubspotusercontent-eu1.net/hubfs/145955222/eResus.jpg',

  // Core Resus Council Documents (for offline use)
  'https://www.resus.org.uk/sites/default/files/2024-01/Adult%20Advanced%20Life%20Support%20Algorithm%202021%20Aug%202023.pdf',
  'https://www.resus.org.uk/sites/default/files/2021-04/Paediatric%20ALS%20Algorithm%202021.pdf',
  'https://www.resus.org.uk/sites/default/files/2021-05/Newborn%20Life%20Support%20Algorithm%202021.pdf',
  'https://www.resus.org.uk/sites/default/files/2023-08/Post%20cardiac%20arrest%20rehabilitation%20algorithim%202023.pdf',
  
  // Third-party libraries
  'https://cdn.tailwindcss.com',
  // Note: Caching for CDN-based ESM modules like React/Firebase is complex.
  // The fetch-first strategy below is generally safer for these.
  // We will cache the main Firebase JS files as they are versioned and stable.
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'
];

self.addEventListener('install', event => {
  // Force the waiting service worker to become the active service worker.
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        // Use { mode: 'cors' } for cross-origin requests
        const requests = urlsToCache.map(url => new Request(url, { mode: 'cors' }));
        return Promise.all(
          requests.map(req => 
            cache.add(req).catch(err => console.warn('Failed to cache:', req.url, err))
          )
        );
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Not in cache - fetch from network
        return fetch(event.request).then(
          networkResponse => {
            // Check if we received a valid response
            if(!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              // Don't cache non-basic (e.g., opaque) or error responses
              return networkResponse;
            }

            // Clone the response
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(err => {
          // Network request failed, try to serve a fallback if available
          // For now, we'll just let it fail, which is fine for most resources.
          console.error('Fetch failed:', err);
        });
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
