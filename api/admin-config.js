/**
 * GET /api/admin-config
 * Public Supabase connection details for the admin app. The anon key is
 * designed to be public: every table is protected by row level security and
 * all writes go through checked database functions. The service-role key is
 * NEVER returned here (it is only used inside api/admin-users.js).
 */
'use strict';

const { applyCors, rateLimit } = require('./_lib/guard');

function handler(req, res) {
  if (!applyCors(req, res, { methods: 'GET, OPTIONS' })) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(req, res, { max: 30, windowMs: 60_000, key: 'admin-config' })) return;
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.SUPABASE_URL || '';
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const valid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && anon.length > 20;
  if (!valid) return res.status(200).json({ configured: false });
  return res.status(200).json({ configured: true, supabaseUrl: url, supabaseAnonKey: anon });
}

module.exports = handler;
