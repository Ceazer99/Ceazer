/**
 * Ceazers 3D - Local Development Server
 * Run with:  node server.js
 *
 * - Serves index.html and all static assets
 * - Routes /api/<name> to api/<name>.js (same as vercel.json)
 * - Reads GEMINI_API_KEY from .env.local automatically
 *
 * No npm install needed - uses only Node.js built-ins (Node 18+).
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

/* ── Load .env.local ────────────────────────────────────────────────────── */
function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

/* ── MIME types ─────────────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml':  'application/xml',
  '.txt':  'text/plain; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.woff2':'font/woff2',
};

/* Never serve these over HTTP, even locally */
const BLOCKED = [/(^|[\\/])\./, /^server\.js$/i, /^package(-lock)?\.json$/i, /^api[\\/]/i, /^(README|HANDOFF)\.md$/i];

/**
 * Map a decoded URL path to a file under ROOT, or null if it must not be
 * served. Rejects traversal, dotfiles, source files, and Windows path
 * aliases: NTFS alternate data streams ("server.js::$DATA") and trailing
 * dots/spaces ("server.js.") both open the real file on Windows but would
 * slip past the name-based block list.
 */
function resolveStaticPath(urlPath) {
  if (typeof urlPath !== 'string' || urlPath.includes('\0') || urlPath.includes(':')) return null;
  const filePath = path.resolve(ROOT, '.' + urlPath);
  const rel = path.relative(ROOT, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.split(/[\\/]/).some(seg => /[. ]$/.test(seg))) return null;
  if (BLOCKED.some(re => re.test(rel))) return null;
  return filePath;
}

/* ── Read request body as JSON (capped, like Vercel's body limit) ──────── */
const MAX_BODY = 1_000_000;
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ── Serve a static file ────────────────────────────────────────────────── */
function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(body);
}

/* ── API handlers (Vercel-style module.exports = handler) ───────────────── */
// Every api/<name>.js file is served at /api/<name> (and /api/<name>.js),
// matching vercel.json. Add a new file to api/ and it works here too.
const API = {};
for (const file of fs.readdirSync(path.join(ROOT, 'api'))) {
  if (file.endsWith('.js')) API[file.slice(0, -3)] = require(`./api/${file}`);
}

/* Add Express/Vercel-style helpers: res.status(code).json(payload) */
function vercelify(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };
  return res;
}

/* ── HTTP server ────────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]); // strip query, decode %20 etc.
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  /* ── API routes ── */
  const apiMatch = url.match(/^\/api\/([a-z0-9-]+)(?:\.js)?\/?$/);
  if (apiMatch) {
    const handler = API[apiMatch[1]];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    try {
      req.body = await readBody(req);
    } catch (e) {
      if (e && e.message === 'Body too large') return; // socket already destroyed
      req.body = {};
    }
    return handler(req, vercelify(res));
  }

  /* ── Static files ── */
  if (url === '/' || url === '') {
    return serveFile(res, path.join(ROOT, 'index.html'));
  }

  /* Security: block directory traversal, dotfiles (.env.local!) and source files */
  const filePath = resolveStaticPath(url);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  serveFile(res, filePath);
});

if (require.main === module) server.listen(PORT, '127.0.0.1', () => {
  const key = process.env.GEMINI_API_KEY;
  const keyOk = key && key !== 'your_gemini_api_key_here' && key.startsWith('AIza');

  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │         Ceazers 3D - Dev Server             │');
  console.log('  ├─────────────────────────────────────────────┤');
  console.log(`  │  Local:   http://localhost:${PORT}               │`);
  console.log('  ├─────────────────────────────────────────────┤');
  if (keyOk) {
    console.log('  │  Gemini:  ✓ API key loaded                   │');
  } else {
    console.log('  │  Gemini:  ✗ No API key found                 │');
  }
  console.log('  └─────────────────────────────────────────────┘');
  console.log('');
  if (!keyOk) {
    console.log('  → Open  .env.local  and replace the placeholder');
    console.log('    with your real Gemini API key, then restart.');
    console.log('');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} is already in use. Close the other process and try again.`);
  } else {
    console.error('  Server error:', err.message);
  }
  process.exit(1);
});

module.exports = { resolveStaticPath, server };
