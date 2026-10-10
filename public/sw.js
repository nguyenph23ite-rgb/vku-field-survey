const CACHE_NAME = 'vku-field-survey-v7';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('vku-field-survey-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const isPage = request.mode === 'navigate' || url.pathname === '/index.html';
    const key = isPage ? '/index.html' : url.pathname;

    const cached = await cache.match(key);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(key, response.clone());
        if (isPage) await cache.put('/', response.clone());
      }
      return response;
    } catch {
      return new Response(
        isPage ? 'Trang chua duoc luu de dung ngoai tuyen.' : 'Tai nguyen chua duoc luu de dung ngoai tuyen.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
  })());
});