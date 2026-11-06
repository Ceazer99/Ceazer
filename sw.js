// sw.js - Ceazers 3D Service Worker
//
// Strategies:
//   - HTML:            network-first (fresh content, cached fallback offline)
//   - Site CSS / JS:   stale-while-revalidate (instant load, updates picked up
//                      on the next visit - no CACHE_NAME bump needed per edit)
//   - Images, fonts, CDN libraries: cache-first
//   - /api/*:          never cached
//
// Bump CACHE_NAME only when you want to wipe every visitor's cache.

const CACHE_NAME = 'ceazers3d-v5';

// Core shell only. Each entry is cached independently, so a missing or
// renamed file can no longer break the whole install (it used to: 8 of the
// old entries were 404s, so cache.addAll() rejected and the SW never installed).
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/styles/base.css',
  '/styles/nav.css',
  '/styles/hero.css',
  '/styles/sections.css',
  '/styles/footer.css',
  '/styles/estimator.css',
  '/styles/faq.css',
  '/styles/widgets.css',
  '/styles/refinements.css',
  '/styles/projects.css',
  '/scripts/projects-data.js',
  '/scripts/projects.js',
  '/scripts/core.js',
  '/scripts/three-viewer.js',
  '/scripts/animations.js',
  '/scripts/contact.js',
  '/scripts/estimator.js',
  '/scripts/faq.js',
  '/scripts/sw-register.js',
  '/scripts/widgets.js',
  '/images/logo.png',
  '/images/hero.webp',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        PRECACHE.map(url => cache.add(new Request(url, { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !isCDNAsset(url)) return;

  if (sameOrigin && url.pathname.startsWith('/api/')) return; // browser handles it, never cached
  if (sameOrigin && url.pathname.startsWith('/admin')) return; // private admin app: never cached by the service worker
  // Videos: let the browser stream them (range requests); caching whole MP4s breaks seeking in Safari
  if (request.headers.has('range') || /\.(?:mp4|webm)$/.test(url.pathname)) return;

  if (request.mode === 'navigate' || request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (sameOrigin && /\.(?:css|js)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  event.respondWith(cacheFirst(request));
});

function isCDNAsset(url) {
  return [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'unpkg.com',
  ].includes(url.hostname);
}

async function putInCache(request, response) {
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    return await putInCache(request, await fetch(request));
  } catch {
    return new Response('Offline - asset not cached', { status: 503 });
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const network = fetch(request).then(res => putInCache(request, res)).catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || new Response('Offline - asset not cached', { status: 503 });
}

async function networkFirst(request) {
  try {
    return await putInCache(request, await fetch(request));
  } catch {
    const cached = await caches.match(request) || await caches.match('/');
    return cached || new Response(`
      <!DOCTYPE html>
      <html lang="en"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Offline - Ceazers 3D</title>
      <style>
        body{font-family:sans-serif;background:#080C14;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column;gap:16px;text-align:center;padding:24px}
        h1{font-size:1.5rem;color:#0EA5E9}p{color:rgba(255,255,255,0.65);max-width:360px}
        a{color:#0EA5E9;font-weight:600}
      </style></head>
      <body>
        <h1>You're offline</h1>
        <p>No internet connection detected. Please reconnect and <a href="/">reload the page</a> to reach Ceazers 3D.</p>
        <p style="font-size:0.82rem">📞 <a href="tel:+27824046423">082 404 6423</a></p>
      </body></html>
    `, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
