// Runs the real Supabase migration inside PGlite (Postgres compiled to WASM)
// and calls the app_* functions the way PostgREST does: one transaction per
// call, role "authenticated" (or "anon"), JWT claims in request.jwt.claims.
// Used by the automated tests (Node) and the localhost-only demo backend.

const NAME_RE = /^app_[a-z_]+$/;

export async function loadSchema(db, sqlTexts) {
  for (const sql of sqlTexts) await db.exec(String(sql).replace(/^﻿/, ''));
}

/** claims = null for an anonymous caller, else { sub, email, aal, role } */
export function makeRpc(db) {
  let queue = Promise.resolve();
  const run = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

  async function inTx(claims, work) {
    await db.exec('begin');
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : '']);
      await db.exec(claims ? 'set local role authenticated' : 'set local role anon');
      const out = await work();
      await db.exec('commit');
      return out;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  }

  return {
    rpc(claims, name, p = {}) {
      if (!NAME_RE.test(name)) throw new Error(`Bad function name ${name}`);
      return run(() => inTx(claims, async () => {
        const res = await db.query(`select public.${name}($1::jsonb) as r`, [JSON.stringify(p ?? {})]);
        return res.rows[0].r;
      }));
    },
    /** Raw SQL as a given caller (tests use this to probe RLS / grants). */
    sqlAs(claims, sql, params = []) {
      return run(() => inTx(claims, async () => (await db.query(sql, params)).rows));
    },
    /** Raw SQL as the database owner (setup only). */
    sqlAdmin(sql, params = []) {
      return run(async () => (await db.query(sql, params)).rows);
    },
  };
}
