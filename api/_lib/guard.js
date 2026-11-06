/**
 * Ceazers 3D - API guard utilities
 *   - Origin allow-list (CORS headers + server-side rejection of foreign origins)
 *   - Per-IP rate limiting (in-memory, per serverless instance - best effort)
 *   - Input clamping
 *
 * Exported helpers return `true` if the request should continue,
 * or `false` if a response has already been sent.
 */

'use strict';

/* ── Allowed origins ───────────────────────────────────────────── */
const PRODUCTION_ORIGINS = new Set([
  'https://ceazers3d.com',
  'https://www.ceazers3d.com',
]);
const LOCAL_ORIGINS = new Set([
  'http://localhost:5500',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
]);

/**
 * An origin is allowed if it is the production site, the same host that is
 * serving this request (covers this project's own Vercel preview URLs, since
 * the site calls /api/* with a relative URL), or - outside production -
 * a local dev server.
 *
 * Previously any https://*.vercel.app origin was allowed, which let any site
 * hosted on Vercel drive visitors' browsers to call the paid AI endpoint.
 */
function isAllowedOrigin(origin, req) {
  if (!origin) return false;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  const host = req && req.headers && req.headers.host;
  if (host && (origin === `https://${host}` || (origin === `http://${host}` && isLocalHost(host)))) return true;
  if (process.env.VERCEL_ENV !== 'production' && LOCAL_ORIGINS.has(origin)) return true;
  return false;
}

function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

/**
 * Apply CORS headers. Returns true to continue, false if the caller
 * should return early (preflight handled, or foreign origin rejected).
 *
 * Requests with no Origin header (curl, server-to-server) are allowed
 * through to rate limiting: CORS cannot stop non-browser clients.
 * Requests that DO carry an Origin must be on the allow-list.
 */
function applyCors(req, res, { methods = 'POST, OPTIONS' } = {}) {
  const origin = req.headers.origin || '';
  res.setHeader('Vary', 'Origin');

  if (origin && !isAllowedOrigin(origin, req)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return false;
  }

  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
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
// Map<key:ip, { count, resetAt }>. Per serverless instance only: Vercel can
// run several instances, so treat this as abuse-slowing, not a hard cap.
// The hard cap must be a quota/budget on the Gemini API key itself.
const buckets = new Map();

function clientIp(req) {
  // Vercel overwrites X-Forwarded-For with the real client IP (verified:
  // a client-supplied value did not reset the bucket).
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Fixed-window counter per IP. Returns true if the request is allowed,
 * false (and sends 429) if the limit is exceeded.
 */
function rateLimit(req, res, { max = 10, windowMs = 60_000, key = 'default' } = {}) {
  const ip = clientIp(req);
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(bucketKey);

  // Clean stale buckets occasionally
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }

  if (!bucket || bucket.resetAt < now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(max - 1));
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
  // Strip control chars (except newlines/tabs) and cap length
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, maxLen);
}

module.exports = { applyCors, rateLimit, clampString, isAllowedOrigin, _buckets: buckets };
