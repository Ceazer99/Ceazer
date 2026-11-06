// Ceazers 3D admin - backend adapters.
//
// SupabaseBackend : production. Auth, rpc and private storage via supabase-js.
// DemoBackend     : localhost only. Runs the SAME migration in PGlite (Postgres
//                   in WebAssembly) inside the browser, with two seeded users,
//                   so the app can be exercised end-to-end without credentials.
//                   It can never activate on a deployed site: it is refused for
//                   non-local hostnames and PGlite is loaded from node_modules,
//                   which is not deployed.
//
// Both expose the same interface:
//   auth.{session(), signIn(email,pw), signOut(), onChange(cb), resetPassword(email),
//         updatePassword(pw), mfa.{factors(), enroll(), verifyEnrollment(id,code), challenge(code), unenroll(id)}}
//   rpc(name, payload)            -> calls app_<name>(p jsonb)
//   storage.{upload(bucket,path,blob), signedUrl(bucket,path,seconds), download(bucket,path)}
//   team(action, payload)         -> /api/admin-users (owner only, server checks)

export const isLocalHost = () => ['localhost', '127.0.0.1'].includes(location.hostname);

export async function loadConfig() {
  try {
    const res = await fetch('/api/admin-config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return { configured: false };
    return await res.json();
  } catch {
    return { configured: false };
  }
}

function friendly(error) {
  const msg = (error && (error.message || error.error_description || error.msg)) || String(error);
  return new Error(msg.replace(/^.*?ERROR:\s*/, ''));
}

/* ════════════════════════ Supabase ════════════════════════ */
export function createSupabaseBackend(cfg) {
  if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase library failed to load');
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      // sessionStorage: closing the browser tab signs you out
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // implicit: reset/invite links work even when opened in a new tab (PKCE would need the verifier from the original tab's sessionStorage)
      flowType: 'implicit',
    },
  });

  const auth = {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw friendly(error);
      return data.session;
    },
    async signOut() { await sb.auth.signOut(); },
    onChange(cb) { return sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/?setpw=1` });
      if (error) throw friendly(error);
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw friendly(error);
    },
    mfa: {
      async factors() {
        const { data, error } = await sb.auth.mfa.listFactors();
        if (error) throw friendly(error);
        return data.totp || [];
      },
      async enroll() {
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${Date.now()}` });
        if (error) throw friendly(error);
        return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
      },
      async verifyEnrollment(factorId, code) {
        const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId });
        if (e1) throw friendly(e1);
        const { error } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code });
        if (error) throw friendly(error);
      },
      async challenge(code) {
        const { data } = await sb.auth.mfa.listFactors();
        const factor = (data.totp || []).find((f) => f.status === 'verified');
        if (!factor) throw new Error('No authenticator is set up');
        const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: factor.id });
        if (e1) throw friendly(e1);
        const { error } = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code });
        if (error) throw friendly(error);
      },
      async unenroll(factorId) {
        const { error } = await sb.auth.mfa.unenroll({ factorId });
        if (error) throw friendly(error);
      },
    },
  };

  async function rpc(name, payload = {}) {
    const { data, error } = await sb.rpc(`app_${name}`, { p: payload });
    if (error) throw friendly(error);
    return data;
  }

  const storage = {
    async upload(bucket, path, blob, { upsert = false } = {}) {
      const { error } = await sb.storage.from(bucket).upload(path, blob, { upsert, contentType: blob.type, cacheControl: '0' });
      if (error && !/exists/i.test(error.message)) throw friendly(error);
      return path;
    },
    async signedUrl(bucket, path, seconds = 300) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
      if (error) throw friendly(error);
      return data.signedUrl;
    },
    async download(bucket, path) {
      const { data, error } = await sb.storage.from(bucket).download(path);
      if (error) throw friendly(error);
      return data;
    },
  };

  async function team(action, payload = {}) {
    const session = await auth.session();
    const res = await fetch('/api/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  return { mode: 'supabase', auth, rpc, storage, team };
}

/* ════════════════════════ Demo (localhost) ════════════════════════ */
export const DEMO_USERS = {
  'owner@demo.local': { id: '00000000-0000-4000-8000-0000000000a1', password: 'demo-owner-pass', role: 'owner', full_name: 'Siyabonga (demo owner)' },
  'staff@demo.local': { id: '00000000-0000-4000-8000-0000000000b2', password: 'demo-staff-pass', role: 'staff', full_name: 'Thando (demo staff)' },
};

export async function createDemoBackend() {
  if (!isLocalHost()) throw new Error('Demo mode is only available on localhost');
  const { PGlite } = await import('/node_modules/@electric-sql/pglite/dist/index.js');
  const { loadSchema, makeRpc } = await import('./pglite-rpc.js');
  const text = async (u) => (await fetch(u, { cache: 'no-store' })).text();
  const db = new PGlite();
  await loadSchema(db, [await text('/supabase/test/auth_stub.sql'), await text('/supabase/migrations/0001_admin_schema.sql'),
    await text('/supabase/migrations/0003_insights_data_capture.sql')]);
  const api = makeRpc(db);
  for (const [email, u] of Object.entries(DEMO_USERS)) {
    await api.sqlAdmin('insert into auth.users (id, email) values ($1, $2)', [u.id, email]);
    await api.sqlAdmin('insert into profiles (id, email, full_name, role) values ($1, $2, $3, $4)', [u.id, email, u.full_name, u.role]);
  }
  await api.sqlAdmin(`update company_settings set email = 'siyabonga.masiza@ceazers3d.com', phone = '0824046423',
    address = E'273 Francois Road\\nDurban', vat_number = '9117677287', bank_name = 'ABSA BANK',
    bank_account = '4121065779', bank_holder = 'CEAZERS 3D ENGINEERING SOLUTIONS (PTY) LTD',
    quote_next = 168, invoice_next = 99 where id = 1`);
  await api.sqlAdmin(`insert into materials (name, cost_per_kg_cents) values ('PLA', 35000), ('PETG', 42000), ('ABS', 45000), ('TPU', 65000), ('Nylon', 120000)`);

  let session = null; const listeners = new Set();
  const emit = (ev) => listeners.forEach((cb) => cb(ev, session));
  const files = new Map();
  let aal = 'aal1'; const factors = new Map(); // demo TOTP: code "123456"

  const auth = {
    async session() { return session; },
    async signIn(email, password) {
      const u = DEMO_USERS[String(email).toLowerCase()];
      if (!u || u.password !== password) throw new Error('Invalid login credentials');
      aal = 'aal1';
      session = { user: { id: u.id, email }, access_token: 'demo' };
      emit('SIGNED_IN');
      return session;
    },
    async signOut() { session = null; emit('SIGNED_OUT'); },
    onChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async resetPassword() { /* demo: pretend an email was sent */ },
    async updatePassword(pw) { if (String(pw).length < 12) throw new Error('Password should be at least 12 characters'); },
    mfa: {
      async factors() { return [...factors.values()].filter((f) => f.user === session?.user.id); },
      async enroll() {
        const id = crypto.randomUUID();
        factors.set(id, { id, user: session.user.id, status: 'unverified', friendly_name: 'Demo authenticator' });
        return { id, qr: null, secret: 'DEMO-SECRET-USE-123456' };
      },
      async verifyEnrollment(id, code) {
        if (code !== '123456') throw new Error('Invalid TOTP code entered');
        factors.get(id).status = 'verified'; aal = 'aal2';
        await api.sqlAdmin("insert into auth.mfa_factors (id, user_id, status) values ($1, $2, 'verified')", [id, session.user.id]);
      },
      async challenge(code) { if (code !== '123456') throw new Error('Invalid TOTP code entered'); aal = 'aal2'; },
      async unenroll(id) { factors.delete(id); await api.sqlAdmin('delete from auth.mfa_factors where id = $1', [id]); },
    },
  };

  const claims = () => (session ? { sub: session.user.id, role: 'authenticated', aal, email: session.user.email } : null);
  async function rpc(name, payload = {}) {
    try { return await api.rpc(claims(), `app_${name}`, payload); } catch (e) { throw friendly(e); }
  }
  const storage = {
    async upload(bucket, path, blob) { files.set(`${bucket}/${path}`, blob); return path; },
    async signedUrl(bucket, path) {
      const b = files.get(`${bucket}/${path}`);
      if (!b) throw new Error('Object not found');
      return URL.createObjectURL(b);
    },
    async download(bucket, path) {
      const b = files.get(`${bucket}/${path}`);
      if (!b) throw new Error('Object not found');
      return b;
    },
  };
  async function team(action, payload = {}) {
    const me = await rpc('me');
    if (me.role !== 'owner' || !me.member) throw new Error('Owner access required');
    if (action === 'list') return { users: await rpc('list_team') };
    if (action === 'invite') {
      const id = crypto.randomUUID();
      await api.sqlAdmin('insert into auth.users (id, email) values ($1, $2)', [id, payload.email]);
      await api.sqlAdmin('insert into profiles (id, email, full_name, role) values ($1, $2, $3, $4)',
        [id, payload.email, payload.full_name || '', payload.role === 'owner' ? 'owner' : 'staff']);
      return { ok: true, id };
    }
    if (action === 'update') {
      await api.sqlAdmin('update profiles set role = coalesce($2::app_role, role), active = coalesce($3, active), updated_at = now() where id = $1',
        [payload.id, payload.role || null, typeof payload.active === 'boolean' ? payload.active : null]);
      return { ok: true };
    }
    throw new Error('Unknown action');
  }
  // demoSql: localhost-only escape hatch so automated browser tests can seed history quickly
  return { mode: 'demo', auth, rpc, storage, team, users: DEMO_USERS, demoSql: (q, params) => (params ? api.sqlAdmin(q, params) : db.exec(q)) };
}
