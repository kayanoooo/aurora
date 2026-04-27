const CACHE_NAME = 'aurora-v1';

// App shell — static files to cache on install
const SHELL = [
  '/',
  '/index.html',
  '/logo192.png',
  '/logo512.png',
  '/favicon.ico',
  '/manifest.json',
];

// ── Install: cache app shell ──────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ───────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API/WS, cache-first for static ──────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept: API calls, WebSocket upgrades, cross-origin
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/uploads') ||
    request.headers.get('upgrade') === 'websocket' ||
    url.origin !== location.origin
  ) return;

  // HTML navigation — network first, fall back to cached index
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // JS/CSS bundles — stale-while-revalidate
  if (url.pathname.match(/\.(js|css)$/)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request).then(res => {
          cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkPromise;
      })
    );
    return;
  }

  // Images & other static — cache first
  e.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(res => {
      if (res.ok) {
        caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
      }
      return res;
    }))
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Aurora', body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(data.title || 'Aurora', {
      body: data.body || '',
      icon: '/logo192.png',
      badge: '/logo192.png',
      tag: data.tag || 'aurora-msg',
      data: data,
      renotify: true,
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/');
    })
  );
});
