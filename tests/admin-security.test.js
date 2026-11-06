/**
 * Admin app security regression tests (no network: fetch is stubbed).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const adminConfig = require('../api/admin-config');
const adminUsers = require('../api/admin-users');
const guard = require('../api/_lib/guard');

function mockRes() {
  return { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; }, end() { return this; } };
}
let ip = 0;
const req = (o = {}) => ({ method: o.method || 'POST', headers: { host: 'ceazers3d.com', 'x-forwarded-for': `198.51.100.${(ip++ % 250) + 1}`, ...(o.headers || {}) }, body: o.body || {}, socket: {} });
const ENV = { SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', SUPABASE_ANON_KEY: 'anon-key-public-xxxxxxxxxxxx', SUPABASE_SERVICE_ROLE_KEY: 'service-role-SECRET-zzzz' };
function withEnv(env, fn) {
  const prev = {}; for (const k of Object.keys(ENV)) { prev[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(ENV)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

/** Fake Supabase: /auth/v1/user, /rest/v1/profiles, /auth/v1/invite, /auth/v1/admin/users */
function fakeSupabase({ user = { id: 'u-owner', factors: [] }, profile = { id: 'u-owner', role: 'owner', active: true } } = {}) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body });
    const u = new URL(url);
    const reply = (status, data) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
    if (u.pathname === '/auth/v1/user') return opts.headers.Authorization === 'Bearer bad' ? reply(401, {}) : reply(200, user);
    if (u.pathname === '/rest/v1/profiles' && (opts.method || 'GET') === 'GET') {
      if (u.search.includes('id=eq.')) return reply(200, profile ? [profile] : []);
      return reply(200, [profile]);
    }
    if (u.pathname === '/rest/v1/profiles' && opts.method === 'PATCH') return reply(200, [{ id: 'x' }]);
    if (u.pathname === '/rest/v1/profiles' && opts.method === 'POST') return reply(201, null);
    if (u.pathname === '/auth/v1/invite') return reply(200, { id: '11111111-1111-4111-8111-111111111111' });
    if (u.pathname.startsWith('/auth/v1/admin/users/')) return reply(200, {});
    return reply(404, {});
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

/* ── /api/admin-config ──────────────────────────────────────── */
test('admin-config reports "not configured" without env and never exposes the service key', async () => {
  await withEnv({}, () => { const r = mockRes(); adminConfig(req({ method: 'GET' }), r); assert.deepEqual(r.body, { configured: false }); });
  await withEnv(ENV, () => {
    const r = mockRes(); adminConfig(req({ method: 'GET' }), r);
    assert.equal(r.body.configured, true);
    assert.equal(r.body.supabaseUrl, ENV.SUPABASE_URL);
    assert.doesNotMatch(JSON.stringify(r.body), /SECRET|service/i);
    assert.equal(r.headers['cache-control'], 'no-store');
  });
  await withEnv({ ...ENV, SUPABASE_URL: 'http://evil.example' }, () => { const r = mockRes(); adminConfig(req({ method: 'GET' }), r); assert.equal(r.body.configured, false); });
});

test('admin endpoints refuse foreign origins', async () => {
  for (const h of [adminConfig, adminUsers]) {
    const r = mockRes();
    await h(req({ method: h === adminConfig ? 'GET' : 'POST', headers: { origin: 'https://evil.example' } }), r);
    assert.equal(r.statusCode, 403);
  }
});

/* ── /api/admin-users ───────────────────────────────────────── */
test('admin-users: unconfigured -> 503; missing/invalid token -> 401', async () => {
  await withEnv({}, async () => { const r = mockRes(); await adminUsers(req({ body: { action: 'list' } }), r); assert.equal(r.statusCode, 503); });
  await withEnv(ENV, async () => {
    const f = fakeSupabase();
    try {
      let r = mockRes(); await adminUsers(req({ body: { action: 'list' } }), r); assert.equal(r.statusCode, 401);
      r = mockRes(); await adminUsers(req({ headers: { authorization: 'Bearer bad' }, body: { action: 'list' } }), r); assert.equal(r.statusCode, 401);
    } finally { f.restore(); }
  });
});

test('admin-users: staff, inactive owners and owners without completed MFA are refused', async () => {
  await withEnv(ENV, async () => {
    for (const [opts, token] of [
      [{ profile: { id: 'u', role: 'staff', active: true } }, jwt({ aal: 'aal1' })],
      [{ profile: { id: 'u', role: 'owner', active: false } }, jwt({ aal: 'aal1' })],
      [{ profile: null }, jwt({ aal: 'aal1' })],
      [{ user: { id: 'u', factors: [{ status: 'verified' }] } }, jwt({ aal: 'aal1' })],
    ]) {
      const f = fakeSupabase(opts);
      try {
        const r = mockRes(); await adminUsers(req({ headers: { authorization: `Bearer ${token}` }, body: { action: 'list' } }), r);
        assert.equal(r.statusCode, 403, JSON.stringify(opts));
      } finally { f.restore(); }
    }
    const f = fakeSupabase({ user: { id: 'u-owner', factors: [{ status: 'verified' }] } });
    try {
      const r = mockRes(); await adminUsers(req({ headers: { authorization: `Bearer ${jwt({ aal: 'aal2' })}` }, body: { action: 'list' } }), r);
      assert.equal(r.statusCode, 200);
    } finally { f.restore(); }
  });
});

test('admin-users: invite validates input, uses the service key server-side only, creates the profile', async () => {
  await withEnv(ENV, async () => {
    const f = fakeSupabase();
    const auth = { authorization: `Bearer ${jwt({ aal: 'aal1' })}`, origin: 'https://ceazers3d.com' };
    try {
      let r = mockRes(); await adminUsers(req({ headers: auth, body: { action: 'invite', email: 'not-an-email' } }), r);
      assert.equal(r.statusCode, 400);
      r = mockRes(); await adminUsers(req({ headers: auth, body: { action: 'invite', email: 'Thando@Example.com', full_name: 'Thando', role: 'superuser' } }), r);
      assert.equal(r.statusCode, 200);
      assert.doesNotMatch(JSON.stringify(r.body), /SECRET/);
      const invite = f.calls.find((c) => c.url.includes('/auth/v1/invite'));
      assert.match(invite.url, /redirect_to=https%3A%2F%2Fceazers3d\.com%2Fadmin%2F%3Fsetpw%3D1/);
      assert.equal(invite.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      const prof = JSON.parse(f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/profiles')).body);
      assert.equal(prof.email, 'thando@example.com');
      assert.equal(prof.role, 'staff', 'unknown roles fall back to staff');
    } finally { f.restore(); }
  });
});

test('admin-users: owners cannot change themselves; deactivation also bans at the auth layer', async () => {
  await withEnv(ENV, async () => {
    const f = fakeSupabase();
    const auth = { authorization: `Bearer ${jwt({ aal: 'aal1' })}` };
    try {
      let r = mockRes(); await adminUsers(req({ headers: auth, body: { action: 'update', id: 'u-owner', active: false } }), r);
      assert.equal(r.statusCode, 400, 'invalid uuid / self');
      r = mockRes(); await adminUsers(req({ headers: auth, body: { action: 'update', id: '22222222-2222-4222-8222-222222222222', role: 'god' } }), r);
      assert.equal(r.statusCode, 400);
      r = mockRes(); await adminUsers(req({ headers: auth, body: { action: 'update', id: '22222222-2222-4222-8222-222222222222', active: false } }), r);
      assert.equal(r.statusCode, 200);
      const ban = f.calls.find((c) => c.url.includes('/auth/v1/admin/users/22222222'));
      assert.equal(JSON.parse(ban.body).ban_duration, '876000h');
    } finally { f.restore(); }
  });
});

/* ── deployment config ──────────────────────────────────────── */
const vercel = JSON.parse(read('vercel.json'));
test('/admin is served with its own strict, uncached, unindexed headers before the catch-all route', () => {
  const i = vercel.routes.findIndex((r) => r.src === '/admin/?');
  const j = vercel.routes.findIndex((r) => r.src === '/admin/(.+)');
  const catchAll = vercel.routes.findIndex((r) => r.src === '/(.*)');
  assert.ok(i > 0 && j > 0 && i < catchAll && j < catchAll);
  const hdr = vercel.routes[i].headers;
  const csp = hdr['Content-Security-Policy'];
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|wasm-unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co/);
  assert.equal(hdr['Cache-Control'], 'no-store');
  assert.match(hdr['X-Robots-Tag'], /noindex/);
  assert.equal(hdr['Referrer-Policy'], 'no-referrer');
  assert.deepEqual(vercel.routes[j].headers, hdr);
});

test('test-only and server-only files are never deployed as static files', () => {
  const srcs = vercel.builds.map((b) => b.src);
  assert.ok(srcs.includes('admin/**'));
  for (const bad of ['supabase/**', 'tests/**', 'node_modules/**', '**']) assert.ok(!srcs.includes(bad), bad);
});

test('service worker never caches /admin; robots disallow /admin', () => {
  assert.match(read('sw.js'), /startsWith\('\/admin'\)\) return;/);
  assert.match(read('robots.txt'), /Disallow: \/admin/);
});

test('admin page: SRI on every CDN script, no inline script or handlers, noindex meta', () => {
  const html = read('admin/index.html');
  const ext = [...html.matchAll(/<script[^>]*\bsrc="https:[^"]+"[^>]*>/g)].map((m) => m[0]);
  assert.equal(ext.length, 3);
  for (const tag of ext) { assert.match(tag, /integrity="sha384-/); assert.match(tag, /crossorigin="anonymous"/); assert.match(tag, /@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//); }
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test('admin browser code never uses raw HTML sinks or eval, and never references the service key', () => {
  const files = [];
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  });
  walk('admin');
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write|\beval\(|new Function\(/, f);
    assert.doesNotMatch(src, /SERVICE_ROLE|service_role/, f);
  }
});

test('demo backend refuses to run anywhere but localhost and is not deployable', () => {
  const src = read('admin/js/backend.js');
  assert.match(src, /if \(!isLocalHost\(\)\) throw new Error\('Demo mode is only available on localhost'\)/);
  assert.match(src, /import\('\/node_modules\/@electric-sql\/pglite/);
});

test('rate limiter key for admin endpoints is separate from the public AI endpoint', () => {
  const r = mockRes();
  const rq = req({ method: 'GET' });
  for (let i = 0; i < 8; i++) guard.rateLimit(rq, mockRes(), { max: 8, key: 'ai-quote' });
  assert.equal(guard.rateLimit(rq, r, { max: 30, key: 'admin-config' }), true);
});
