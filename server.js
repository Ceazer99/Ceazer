/**
 * Ceazers 3D - Local Development Server
 * Run with:  node server.js
 *
 * - Serves index.html and all static assets
 * - Routes POST /api/generate-image to the Vercel-style handler
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
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

/* ── Read request body as JSON ──────────────────────────────────────────── */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ── Serve a static file ────────────────────────────────────────────────── */
function serveFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(body);
}

/* ── Load the API handler (Vercel-style module.exports = handler) ──────── */
const imageHandler = require('./api/generate-image');

/* ── HTTP server ────────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0]; // strip query string

  /* ── API route ── */
  if (url === '/api/generate-image') {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    try {
      req.body = await readBody(req);
    } catch (_) {
      req.body = {};
    }

    /* Wrap res.json so the Vercel handler works unchanged */
    res.json = (payload) => {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify(payload));
    };

    /* Wrap res.status to support chaining: res.status(400).json({}) */
    const origStatus = res.writeHead.bind(res);
    res.status = (code) => {
      res._statusCode = code;
      return res;
    };
    /* Override json to use the buffered status code */
    const originalJson = res.json;
    res.json = (payload) => {
      if (!res.headersSent) {
        res.writeHead(res._statusCode || 200, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify(payload));
    };

    return imageHandler(req, res);
  }

  /* ── Static files ── */
  if (url === '/' || url === '') {
    return serveFile(res, path.join(ROOT, 'index.html'));
  }

  const filePath = path.join(ROOT, url);
  /* Security: prevent directory traversal */
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  serveFile(res, filePath);
});

server.listen(PORT, '127.0.0.1', () => {
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
    console.log('  │  Images:  ✓ Generation enabled               │');
  } else {
    console.log('  │  Gemini:  ✗ No API key found                 │');
    console.log('  │  Images:  ✗ Add key to .env.local to enable  │');
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
