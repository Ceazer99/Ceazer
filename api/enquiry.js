/**
 * POST /api/enquiry
 * Logs a website contact-form enquiry into the admin's enquiries table, so
 * demand (including work that is later turned away) is captured for insights.
 * The form still emails you via Web3Forms as before; this is in addition.
 *
 * Public endpoint, so: same-site browser origin required, rate limited,
 * honeypot respected, strict field caps, nothing echoed back.
 */
'use strict';

const { applyCors, rateLimit, clampString } = require('./_lib/guard');

const CLIENT_TYPES = { individual: 'individual', student: 'student', startup: 'startup', business: 'business', other: 'other' };
const SERVICES = { cad: 'cad', drawings: 'drawings', printing: 'fdm_printing', prototyping: 'prototyping',
  'product-dev': 'product_dev', custom: 'other', unsure: null };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // a browser always sends Origin on a cross-document POST; scripts without one are refused
  if (!req.headers.origin) return res.status(403).json({ error: 'Origin required' });
  if (!rateLimit(req, res, { max: 5, windowMs: 10 * 60_000, key: 'enquiry' })) return;
  res.setHeader('Cache-Control', 'no-store');

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // honeypot: bots tick the hidden box. Pretend success, store nothing.
  if (b.botcheck) return res.status(200).json({ ok: true });

  const first = clampString(b.firstName, 100).trim();
  const last = clampString(b.lastName, 100).trim();
  const email = clampString(b.email, 254).trim().toLowerCase();
  const phone = clampString(b.phone, 40).replace(/[^\d+()\s-]/g, '').trim();
  const message = clampString(b.message, 5000).trim();
  const fileLink = clampString(b.fileLink, 500).trim();
  if (!first && !last) return res.status(400).json({ error: 'Name is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (message.length < 10) return res.status(400).json({ error: 'Message is too short' });

  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) {
    return res.status(202).json({ ok: true, stored: false });
  }

  const row = {
    source: 'website',
    name: `${first} ${last}`.trim(),
    email,
    phone,
    client_type: Object.prototype.hasOwnProperty.call(CLIENT_TYPES, b.clientType) ? CLIENT_TYPES[b.clientType] : null,
    category: Object.prototype.hasOwnProperty.call(SERVICES, b.service) ? SERVICES[b.service] : null,
    message: fileLink && /^https?:\/\//i.test(fileLink) ? `${message}\n\nFiles: ${fileLink}` : message,
  };
  try {
    const r = await fetch(`${url}/rest/v1/enquiries`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`insert ${r.status}`);
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[enquiry]', err && err.message);
    return res.status(502).json({ error: 'Could not log the enquiry' });
  }
}

module.exports = handler;
