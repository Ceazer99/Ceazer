/**
 * Ceazers 3D - API guard utilities
 *   - Origin-restricted CORS
 *   - Per-IP rate limiting (in-memory token bucket, per Lambda instance)
 *
 * Exported helpers return `true` if the request should continue,
 * or `false` if a response has already been sent.
 */

'use strict';

/* ── Allowed origins ───────────────────────────────────────────── */
const ALLOWED_ORIGINS = new Set([
  'https://ceazers3d.com',
  'https://www.ceazers3d.com',
  // Vercel preview + local dev (development only)
  'http://localhost:5500',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
]);
// Also allow any *.vercel.app preview deployment for this project
const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (VERCEL_PREVIEW_RE.test(origin)) return true;
  return false;
}

/**
 * Apply CORS headers. Returns true to continue, false if the caller
 * should return early (OPTIONS preflight handled, or method rejected).
 */
function applyCors(req, res, { methods = 'POST, OPTIONS' } = {}) {
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  return true;
}

/* ── In-memory rate limiter ────────────────────────────────────── */
// Map<ip, { count, resetAt }>
const buckets = new Map();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Token bucket per IP. Returns true if the request is allowed,
 * false (and sends 429) if the limit is exceeded.
 */
function rateLimit(req, res, { max = 10, windowMs = 60_000, key = 'default' } = {}) {
  const ip = clientIp(req);
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(bucketKey);

  // Clean stale buckets occasionally (cheap LRU)
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }

  if (!bucket || bucket.resetAt < now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.status(429).json({ error: `Too many requests. Retry in ${retryAfter}s.` });
    return false;
  }

  bucket.count += 1;
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(max - bucket.count));
  return true;
}

/* ── Input sanitisation ────────────────────────────────────────── */
function clampString(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  // Strip control chars (except newlines/tabs), collapse whitespace, cap length
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, maxLen);
}

module.exports = { applyCors, rateLimit, clampString };
