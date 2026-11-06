/**
 * POST /api/admin-users   (owner only)
 * Body: { action: 'list' | 'invite' | 'update', ... }
 *
 * Team management needs the Supabase service-role key (to invite users and
 * ban deactivated ones), so it runs here on the server, never in the browser.
 * Every request is authenticated with the caller's own Supabase access token
 * and re-checked against the database: the caller must be an ACTIVE OWNER,
 * and must have completed MFA (aal2) if they have an authenticator enrolled.
 */
'use strict';

const { applyCors, rateLimit, clampString } = require('./_lib/guard');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function env() {
  const url = process.env.SUPABASE_URL || '';
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !anon || !service) return null;
  return { url, anon, service };
}

async function sb(cfg, path, { method = 'GET', body, token, prefer } = {}) {
  const headers = { apikey: token ? cfg.anon : cfg.service, Authorization: `Bearer ${token || cfg.service}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${cfg.url}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

async function requireOwner(cfg, token) {
  if (!token) return { error: [401, 'Sign in first'] };
  // Supabase validates the token's signature and expiry for us
  const me = await sb(cfg, '/auth/v1/user', { token });
  if (!me.ok || !me.data || !me.data.id) return { error: [401, 'Session expired. Sign in again.'] };
  const verifiedFactor = (me.data.factors || []).some((f) => f.status === 'verified');
  if (verifiedFactor && jwtClaims(token).aal !== 'aal2') return { error: [403, 'Complete two-step verification first'] };
  const prof = await sb(cfg, `/rest/v1/profiles?id=eq.${me.data.id}&select=id,role,active`);
  const p = Array.isArray(prof.data) ? prof.data[0] : null;
  if (!p || !p.active || p.role !== 'owner') return { error: [403, 'Owner access required'] };
  return { user: me.data };
}

async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(req, res, { max: 20, windowMs: 60_000, key: 'admin-users' })) return;
  res.setHeader('Cache-Control', 'no-store');

  const cfg = env();
  if (!cfg) return res.status(503).json({ error: 'Team management is not configured on the server' });

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  try {
    const gate = await requireOwner(cfg, token);
    if (gate.error) return res.status(gate.error[0]).json({ error: gate.error[1] });
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (body.action === 'list') {
      const r = await sb(cfg, '/rest/v1/profiles?select=id,email,full_name,role,active,created_at&order=role.asc,email.asc');
      if (!r.ok) throw new Error('list failed');
      return res.status(200).json({ users: r.data });
    }

    if (body.action === 'invite') {
      const email = clampString(body.email, 254).trim().toLowerCase();
      const fullName = clampString(body.full_name, 120).trim();
      const role = body.role === 'owner' ? 'owner' : 'staff';
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
      const origin = /^https:\/\/[a-z0-9.-]+$/i.test(String(req.headers.origin || '')) ? req.headers.origin : 'https://ceazers3d.com';
      const inv = await sb(cfg, `/auth/v1/invite?redirect_to=${encodeURIComponent(`${origin}/admin/?setpw=1`)}`, {
        method: 'POST', body: { email, data: { full_name: fullName } } });
      if (!inv.ok || !inv.data || !inv.data.id) {
        const msg = inv.status === 422 ? 'That email already has an account' : 'Could not send the invite';
        return res.status(inv.status === 422 ? 409 : 502).json({ error: msg });
      }
      const up = await sb(cfg, '/rest/v1/profiles', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { id: inv.data.id, email, full_name: fullName, role, active: true } });
      if (!up.ok) throw new Error('profile insert failed');
      return res.status(200).json({ ok: true, id: inv.data.id });
    }

    if (body.action === 'update') {
      const id = String(body.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid user' });
      if (id === gate.user.id) return res.status(400).json({ error: 'You cannot change your own role or access' });
      const patch = {};
      if (body.role !== undefined) {
        if (!['owner', 'staff'].includes(body.role)) return res.status(400).json({ error: 'Invalid role' });
        patch.role = body.role;
      }
      if (body.active !== undefined) patch.active = body.active === true;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
      const r = await sb(cfg, `/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation',
        body: { ...patch, updated_at: new Date().toISOString() } });
      if (!r.ok || !Array.isArray(r.data) || !r.data.length) return res.status(404).json({ error: 'User not found' });
      if (patch.active !== undefined) {
        // ban/unban at the auth layer too, so a deactivated user cannot sign in or refresh a session
        await sb(cfg, `/auth/v1/admin/users/${id}`, { method: 'PUT', body: { ban_duration: patch.active ? 'none' : '876000h' } });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin-users]', err && err.message);
    return res.status(502).json({ error: 'Team service is temporarily unavailable' });
  }
}

module.exports = handler;
module.exports._internals = { requireOwner, jwtClaims };
