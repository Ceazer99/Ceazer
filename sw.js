// sw.js — Ceazers 3D Service Worker
// Cache-first for static assets, network-first for HTML

const CACHE_NAME = 'ceazers3d-v2-modular';
const STATIC_ASSETS = [
  '/',
  '/index.html',
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
  '/images/about.webp',
  '/images/service-cad.webp',
  '/images/service-print.webp',
  '/images/service-proto.webp',
  '/images/service-product.webp',
  '/images/bracket.webp',
  '/images/prototype.webp',
  '/images/startup.webp',
  '/images/filament-spool.webp',
  '/images/filament-makerbot.webp',
  '/images/pla.webp',
  '/images/petg.webp',
  '/images/abs.webp',
  '/images/tpu.webp',
];

// Install: pre-cache all static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - HTML: network-first (always try fresh, fallback to cache)
// - API: network-only (never cache dynamic data)
// - Everything else: cache-first (images, fonts, CDN assets)
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin non-CDN requests
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin && !isCDNAsset(url)) return;

  // API routes: network-only
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML documents: network-first
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets: cache-first
  event.respondWith(cacheFirst(request));
});

function isCDNAsset(url) {
  return (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('unpkg.com')
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — asset not cached', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(`
      <!DOCTYPE html>
      <html lang="en"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Offline — Ceazers 3D</title>
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
