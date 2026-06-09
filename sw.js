// ── ampxr Service Worker ──
const AMPXR_CACHE = 'ampxr-v1';

const AMPXR_STATIC = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const AMPXR_SOUNDS = [
  '/sounds/rain.wav',
  '/sounds/lightrain.mp3',
  '/sounds/thunder.mp3',
  '/sounds/fireplace.wav',
  '/sounds/river.wav',
  '/sounds/waves.wav',
  '/sounds/birds.wav',
  '/sounds/whitenoise.wav',
];

// Install — pre-cache all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(AMPXR_CACHE).then(cache =>
      cache.addAll([...AMPXR_STATIC, ...AMPXR_SOUNDS]).catch(() =>
        cache.addAll(AMPXR_STATIC)
      )
    ).then(() => self.skipWaiting())
  );
});

// Activate — purge old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== AMPXR_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch — cache-first for sounds, network-first for everything else
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Pass through non-GET and Supabase requests
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')) return;

  // Sounds: cache-first (large files, rarely change)
  if (url.pathname.startsWith('/sounds/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          caches.open(AMPXR_CACHE).then(c => c.put(event.request, res.clone()));
          return res;
        });
      })
    );
    return;
  }

  // App shell: network-first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(res => {
        caches.open(AMPXR_CACHE).then(c => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
