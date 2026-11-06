// Database tests: the real Supabase migration running in PGlite.
// Covers calculations (and parity with admin/js/calc.js), numbering, locking,
// revisions, payments/deposits, costing separation, RLS/grants, MFA gate,
// CSV import, audit log and reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadSchema, makeRpc } from '../admin/js/pglite-rpc.js';
import { computeTotals, unitCost } from '../admin/js/calc.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const OWNER = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000002';
const OUTSIDER = '00000000-0000-4000-8000-000000000003';
const INACTIVE = '00000000-0000-4000-8000-000000000004';
const claims = (sub, aal = 'aal1') => ({ sub, role: 'authenticated', aal });
const owner = claims(OWNER); const staff = claims(STAFF);

let db; let api;
const rpc = (who, name, p) => api.rpc(who, name, p);
const rejects = (promise, re) => assert.rejects(promise, (e) => { assert.match(e.message, re); return true; });

test.before(async () => {
  db = new PGlite();
  await loadSchema(db, [read('supabase/test/auth_stub.sql'), read('supabase/migrations/0001_admin_schema.sql')]);
  api = makeRpc(db);
  await api.sqlAdmin(`insert into auth.users (id, email) values
    ('${OWNER}', 'owner@test.local'), ('${STAFF}', 'staff@test.local'),
    ('${OUTSIDER}', 'outsider@test.local'), ('${INACTIVE}', 'gone@test.local')`);
  await api.sqlAdmin(`insert into profiles (id, email, full_name, role, active) values
    ('${OWNER}', 'owner@test.local', 'Owner', 'owner', true),
    ('${STAFF}', 'staff@test.local', 'Staff', 'staff', true),
    ('${INACTIVE}', 'gone@test.local', 'Gone', 'staff', false)`);
});
test.after(async () => { await db.close(); });

async function newClient(who = owner, name = 'Envelop Empowerment Group (Pyt) Ltd') {
  return rpc(who, 'app_save_client', { name, email: 'ap@envelop.example', phone: '0728348818',
    billing_address: '37 Gillits Road\nPinetown, Westmead', shipping_address: '37 Gillits Road\nPinetown, Westmead' });
}

/* ── access control ─────────────────────────────────────────────── */
test('anonymous callers cannot execute API functions or read tables', async () => {
  await rejects(rpc(null, 'app_list_clients', {}), /permission denied/);
  await rejects(api.sqlAs(null, 'select * from documents'), /permission denied/);
});

test('signed-in users without an active profile are refused', async () => {
  await rejects(rpc(claims(OUTSIDER), 'app_list_clients', {}), /Not authorised/);
  await rejects(rpc(claims(INACTIVE), 'app_list_clients', {}), /Not authorised/);
  assert.deepEqual(await api.sqlAs(claims(OUTSIDER), 'select * from clients'), []);
});

test('members cannot write tables directly (all writes go through checked functions)', async () => {
  await rejects(api.sqlAs(staff, "insert into clients (name) values ('x')"), /permission denied/);
  await rejects(api.sqlAs(owner, "update documents set total_cents = 0"), /permission denied/);
  await rejects(api.sqlAs(owner, "delete from payments"), /permission denied/);
  await rejects(api.sqlAs(staff, "select app_next_number('invoice')"), /permission denied/);
});

test('MFA: once a factor is verified, an aal1 session loses access until aal2', async () => {
  await api.sqlAdmin(`insert into auth.mfa_factors (user_id, status) values ('${OWNER}', 'verified')`);
  try {
    await rejects(rpc(claims(OWNER, 'aal1'), 'app_list_clients', {}), /Not authorised/);
    const me = await rpc(claims(OWNER, 'aal1'), 'app_me', {});
    assert.equal(me.needs_mfa, true);
    assert.ok(Array.isArray(await rpc(claims(OWNER, 'aal2'), 'app_list_clients', {})));
  } finally {
    await api.sqlAdmin(`delete from auth.mfa_factors where user_id = '${OWNER}'`);
  }
});

/* ── calculations ───────────────────────────────────────────────── */
test('screenshot quote QU000117: R400 + R14,200 + VAT line R2,070, discount R1,000, shipping R200 = R15,870', async () => {
  const c = await newClient();
  const q = await rpc(owner, 'app_save_document', {
    kind: 'quote', client_id: c.id, tax_mode: 'none', discount_type: 'amount', discount_amount_cents: 100000,
    shipping_cents: 20000,
    lines: [
      { name: 'Wall clock CAD Design', description: 'CAD Modelling', qty: 1, unit_price_cents: 40000 },
      { name: '3D printing', description: '3D printing 12x Safety Boot Wall Clock', qty: 1, unit_price_cents: 1420000 },
      { name: 'VAT', qty: 1, unit_price_cents: 207000 },
    ],
  });
  assert.equal(q.subtotal_cents, 1667000);
  assert.equal(q.discount_cents, 100000);
  assert.equal(q.total_cents, 1587000);
  assert.equal(q.vat_cents, 0);
});

test('VAT exclusive / inclusive, proportional discount over non-taxable lines, deposit', async () => {
  const c = await newClient();
  const base = { kind: 'quote', client_id: c.id, shipping_cents: 10000, shipping_taxable: true,
    lines: [{ name: 'A', qty: 2, unit_price_cents: 50000 }, { name: 'B (zero-rated)', qty: 1, unit_price_cents: 20000, taxable: false }] };
  const ex = await rpc(owner, 'app_save_document', { ...base, tax_mode: 'exclusive', vat_rate: 15,
    discount_type: 'percent', discount_percent: 10, deposit_type: 'percent', deposit_percent: 50 });
  // sub 120000; disc 12000; taxable lines 100000 - 12000*100000/120000 = 90000; +shipping 10000 = 100000; VAT 15000
  assert.deepEqual([ex.subtotal_cents, ex.discount_cents, ex.taxable_cents, ex.vat_cents, ex.total_cents, ex.deposit_cents],
    [120000, 12000, 100000, 15000, 133000, 66500]);
  const inc = await rpc(owner, 'app_save_document', { ...base, tax_mode: 'inclusive', vat_rate: 15, discount_type: 'none' });
  // total 130000; taxable gross 100000 + 10000 = 110000; VAT = 110000*15/115 = 14347.8 -> 14348
  assert.deepEqual([inc.total_cents, inc.vat_cents], [130000, 14348]);
});

test('discount can never exceed the subtotal; deposit amount is capped at the total', async () => {
  const c = await newClient();
  const d = await rpc(owner, 'app_save_document', { kind: 'quote', client_id: c.id, tax_mode: 'none',
    discount_type: 'amount', discount_amount_cents: 999999, deposit_type: 'amount', deposit_amount_cents: 5000000,
    lines: [{ name: 'x', qty: 1, unit_price_cents: 10000 }] });
  assert.equal(d.discount_cents, 10000);
  assert.equal(d.total_cents, 0);
  assert.equal(d.deposit_cents, 0);
});

test('browser calc.js matches the database on 150 randomised documents', async () => {
  const c = await newClient();
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 150; i++) {
    const doc = {
      kind: 'quote', client_id: c.id,
      tax_mode: ['none', 'exclusive', 'inclusive'][rnd(3)],
      vat_rate: [15, 14, 0, 12.5][rnd(4)],
      shipping_taxable: rnd(2) === 0,
      shipping_cents: rnd(3) ? rnd(50000) : 0,
      discount_type: ['none', 'percent', 'amount'][rnd(3)],
      discount_percent: rnd(10000) / 100,
      discount_amount_cents: rnd(300000),
      deposit_type: ['none', 'percent', 'amount'][rnd(3)],
      deposit_percent: rnd(10000) / 100,
      deposit_amount_cents: rnd(500000),
      lines: Array.from({ length: 1 + rnd(6) }, () => ({
        name: 'L', qty: [1, 2, 0.5, 1.25, 3.333, 12, 0.125][rnd(7)],
        unit_price_cents: rnd(5) === 0 ? -rnd(20000) : rnd(2000000), taxable: rnd(4) !== 0,
      })),
    };
    const db = await rpc(owner, 'app_save_document', doc);
    const js = computeTotals(doc);
    for (const k of ['subtotal_cents', 'discount_cents', 'taxable_cents', 'vat_cents', 'total_cents', 'deposit_cents', 'balance_cents']) {
      assert.equal(js[k], db[k], `doc ${i} field ${k}: ${JSON.stringify(doc)}`);
    }
    db.lines.forEach((l, j) => assert.equal(js.lines[j].line_total_cents, l.line_total_cents, `doc ${i} line ${j}`));
  }
});

test('browser unitCost matches app_cost_of', async () => {
  const mat = await rpc(owner, 'app_save_material', { name: 'PLA Black', cost_per_kg_cents: 35000 });
  const settings = (await rpc(owner, 'app_get_settings', {})).costing;
  for (const c of [
    { material_id: mat.id, material_grams: 123.456, print_hours: 4.5, labour_hours: 0.75, design_hours: 1.25, other_cost_cents: 1999 },
    { material_id: mat.id, material_grams: 0, print_hours: 0, labour_hours: 0, design_hours: 0, other_cost_cents: 0 },
    { material_id: mat.id, material_grams: 1000, print_hours: 13.333, labour_hours: 2, design_hours: 0, other_cost_cents: 5000 },
  ]) {
    const db = await rpc(owner, 'app_estimate_cost', c);
    assert.equal(unitCost(c, settings, 35000), db.unit_cost_cents, JSON.stringify(c));
  }
});

/* ── numbering ──────────────────────────────────────────────────── */
test('quotes are numbered on creation; numbers are unique, zero-padded and continue from a set point', async () => {
  const c = await newClient();
  await rpc(owner, 'app_set_next_number', { kind: 'quote', next: 5117 });
  const a = await rpc(staff, 'app_save_document', { kind: 'quote', client_id: c.id });
  const b = await rpc(staff, 'app_save_document', { kind: 'quote', client_id: c.id });
  assert.equal(a.number, 'QU005117');
  assert.equal(b.number, 'QU005118');
  await rejects(rpc(owner, 'app_set_next_number', { kind: 'quote', next: 5117 }), /already used/);
  await rejects(rpc(staff, 'app_set_next_number', { kind: 'quote', next: 500 }), /Owner access required/);
  await rejects(api.sqlAdmin("insert into documents (kind, number) values ('quote', 'QU005117')"), /duplicate key/);
});

test('invoices get a number only when issued; deleted drafts leave no gaps; existing numbers are skipped', async () => {
  const c = await newClient();
  await rpc(owner, 'app_set_next_number', { kind: 'invoice', next: 98 });
  const draft = await rpc(staff, 'app_save_document', { kind: 'invoice', client_id: c.id, lines: [{ name: 'x', qty: 1, unit_price_cents: 100 }] });
  assert.equal(draft.number, null);
  await rpc(staff, 'app_delete_draft', { id: draft.id });
  // a historical IN00099 already exists (e.g. imported) - must be skipped
  await api.sqlAdmin(`insert into documents (kind, number, status, client_id) values ('invoice', 'IN00099', 'issued', '${c.id}')`);
  const inv = await rpc(staff, 'app_save_document', { kind: 'invoice', client_id: c.id, lines: [{ name: 'x', qty: 1, unit_price_cents: 100 }] });
  const issued = await rpc(staff, 'app_issue_document', { id: inv.id });
  assert.equal(issued.number, 'IN00098');
  const inv2 = await rpc(staff, 'app_save_document', { kind: 'invoice', client_id: c.id, lines: [{ name: 'y', qty: 1, unit_price_cents: 100 }] });
  assert.equal((await rpc(staff, 'app_issue_document', { id: inv2.id })).number, 'IN00100');
});

test('numbered quote drafts cannot be deleted (void instead) and issued documents cannot be deleted', async () => {
  const c = await newClient();
  const q = await rpc(staff, 'app_save_document', { kind: 'quote', client_id: c.id });
  await rejects(rpc(staff, 'app_delete_draft', { id: q.id }), /void numbered documents instead/);
  const v = await rpc(staff, 'app_void_document', { id: q.id, reason: 'Created by mistake' });
  assert.equal(v.status, 'void');
  await rejects(rpc(staff, 'app_void_document', { id: q.id, reason: 'again' }), /Already void/);
});

/* ── locking, revisions, history ───────────────────────────────── */
test('issued documents are locked, client/company details frozen, revisions kept immutably', async () => {
  const c = await newClient(owner, 'Thinked');
  let q = await rpc(staff, 'app_save_document', { kind: 'quote', client_id: c.id, tax_mode: 'none',
    lines: [{ name: 'CAD', qty: 1, unit_price_cents: 40000 }] });
  await rejects(rpc(staff, 'app_issue_document', { id: (await rpc(staff, 'app_save_document', { kind: 'quote' })).id }), /Choose a client/);
  q = await rpc(staff, 'app_issue_document', { id: q.id });
  assert.equal(q.status, 'sent');
  assert.equal(q.locked, true);
  assert.equal(q.company_snapshot.name, 'Ceazers 3D Engineering Solutions');
  assert.equal(q.company_snapshot.quote_next, undefined, 'counters are not part of the snapshot');

  await rejects(rpc(staff, 'app_save_document', { id: q.id, notes: 'sneaky edit' }), /locked/);
  await rejects(api.sqlAdmin(`update document_lines set unit_price_cents = 1 where document_id = '${q.id}'`), /locked/);
  await rejects(api.sqlAdmin(`update documents set shipping_cents = 999 where id = '${q.id}'`), /locked/);
  await rejects(api.sqlAdmin(`update documents set locked = false where id = '${q.id}'`), /locked/);

  // renaming the client later does not change the issued quote
  await rpc(owner, 'app_save_client', { id: c.id, name: 'Thinked (Pty) Ltd' });
  assert.equal((await rpc(staff, 'app_get_document', { id: q.id })).client_snapshot.name, 'Thinked');

  // revise -> rev 2 draft; rev 1 snapshot stays as it was
  q = await rpc(staff, 'app_revise_quote', { id: q.id });
  assert.equal(q.revision, 2);
  assert.equal(q.locked, false);
  q = await rpc(staff, 'app_save_document', { id: q.id, client_id: c.id, lines: [{ name: 'CAD', qty: 2, unit_price_cents: 40000 }] });
  q = await rpc(staff, 'app_issue_document', { id: q.id });
  const revs = await api.sqlAdmin(`select revision, snapshot from document_revisions where document_id = '${q.id}' order by revision`);
  assert.equal(revs.length, 2);
  assert.equal(revs[0].snapshot.total_cents, 40000);
  assert.equal(revs[1].snapshot.total_cents, 80000);
  assert.equal(revs[1].snapshot.client_snapshot.name, 'Thinked (Pty) Ltd');
  await rejects(api.sqlAdmin(`update document_revisions set snapshot = '{}' where document_id = '${q.id}'`), /immutable/);
  await rejects(api.sqlAdmin(`delete from document_revisions where document_id = '${q.id}'`), /immutable/);
});

test('invoices cannot be revised: void (with reason) + duplicate', async () => {
  const c = await newClient();
  const inv = await rpc(staff, 'app_save_document', { kind: 'invoice', client_id: c.id, lines: [{ name: 'x', qty: 1, unit_price_cents: 5000 }] });
  const issued = await rpc(staff, 'app_issue_document', { id: inv.id });
  await rejects(rpc(staff, 'app_revise_quote', { id: issued.id }), /Only quotes can be revised/);
  await rejects(rpc(staff, 'app_void_document', { id: issued.id, reason: '' }), /reason/);
  const dup = await rpc(staff, 'app_duplicate_document', { id: issued.id });
  assert.equal(dup.status, 'draft');
  assert.equal(dup.number, null);
  assert.equal(dup.total_cents, issued.total_cents);
  const voided = await rpc(staff, 'app_void_document', { id: issued.id, reason: 'Wrong client address' });
  assert.equal(voided.status, 'void');
  assert.equal(voided.number, issued.number, 'void keeps its number');
});

/* ── conversion, deposits, payments ────────────────────────────── */
test('quote -> invoice conversion, deposit and payment tracking with derived status', async () => {
  const c = await newClient();
  let q = await rpc(owner, 'app_save_document', { kind: 'quote', client_id: c.id, tax_mode: 'exclusive', vat_rate: 15,
    deposit_type: 'percent', deposit_percent: 50,
    lines: [{ name: 'Print', qty: 10, unit_price_cents: 10000, cost: { unit_cost_cents: 4000 } }] });
  await rejects(rpc(owner, 'app_convert_quote', { id: q.id }), /Only sent or accepted/);
  q = await rpc(owner, 'app_issue_document', { id: q.id });
  q = await rpc(owner, 'app_set_quote_status', { id: q.id, status: 'accepted' });
  let inv = await rpc(owner, 'app_convert_quote', { id: q.id });
  assert.equal(inv.kind, 'invoice');
  assert.equal(inv.source_quote_number, q.number);
  assert.equal(inv.total_cents, 115000);
  assert.equal(inv.deposit_cents, 57500);
  assert.equal(inv.lines[0].cost.unit_cost_cents, 4000, 'internal cost carried over');
  assert.equal((await rpc(owner, 'app_get_document', { id: q.id })).status, 'converted');

  await rejects(rpc(owner, 'app_record_payment', { invoice_id: inv.id, amount_cents: 1000 }), /Issue the invoice/);
  inv = await rpc(owner, 'app_issue_document', { id: inv.id });
  inv = await rpc(staff, 'app_record_payment', { invoice_id: inv.id, amount_cents: 57500, is_deposit: true, reference: 'EFT 123' });
  assert.equal(inv.status, 'partially_paid');
  assert.equal(inv.balance_cents, 57500);
  await rejects(rpc(staff, 'app_record_payment', { invoice_id: inv.id, amount_cents: 60000 }), /more than the balance/);
  await rejects(rpc(staff, 'app_record_payment', { invoice_id: inv.id, amount_cents: 0 }), /more than zero/);
  inv = await rpc(staff, 'app_record_payment', { invoice_id: inv.id, amount_cents: 57500 });
  assert.equal(inv.status, 'paid');
  assert.equal(inv.balance_cents, 0);

  const pay = inv.payments[1];
  await rejects(api.sqlAdmin(`delete from payments where id = '${pay.id}'`), /cannot be deleted/);
  await rejects(api.sqlAdmin(`update payments set amount_cents = 1 where id = '${pay.id}'`), /cannot be edited/);
  await rejects(rpc(staff, 'app_void_document', { id: inv.id, reason: 'test' }), /Void the recorded payments first/);
  inv = await rpc(staff, 'app_void_payment', { id: pay.id, reason: 'Bounced' });
  assert.equal(inv.status, 'partially_paid');
  assert.equal(inv.paid_cents, 57500);
});

/* ── internal costing stays internal ───────────────────────────── */
test('staff never receive internal costing, cannot set it, and do not erase it when editing', async () => {
  const c = await newClient();
  const svc = await rpc(owner, 'app_save_service', { name: 'FDM print (per part)', unit_price_cents: 25000,
    costing: { material_grams: 50, print_hours: 3, labour_hours: 0.25 } });
  assert.ok(svc.costing.unit_cost_cents > 0);
  const staffSvc = (await rpc(staff, 'app_list_services', {})).find((s) => s.id === svc.id);
  assert.equal(staffSvc.costing, undefined);
  await rejects(rpc(staff, 'app_save_service', { id: svc.id, costing: { print_hours: 1 } }), /Owner access required/);

  const d = await rpc(staff, 'app_save_document', { kind: 'quote', client_id: c.id,
    lines: [{ name: 'FDM print', service_id: svc.id, qty: 4, unit_price_cents: 25000, cost: { unit_cost_cents: 1 } }] });
  assert.equal(d.lines[0].cost, undefined);
  assert.equal(d.cost_total_cents, undefined);
  const ownerView = await rpc(owner, 'app_get_document', { id: d.id });
  assert.equal(ownerView.lines[0].cost.unit_cost_cents, svc.costing.unit_cost_cents, 'staff-supplied cost ignored; service cost used');

  // staff edit keeps the owner's costing
  await rpc(owner, 'app_save_document', { id: d.id, lines: [{ ...ownerView.lines[0], cost: { unit_cost_cents: 7777 } }] });
  const again = await rpc(owner, 'app_get_document', { id: d.id });
  await rpc(staff, 'app_save_document', { id: d.id, lines: again.lines.map(({ cost, ...l }) => ({ ...l, qty: 5 })) });
  assert.equal((await rpc(owner, 'app_get_document', { id: d.id })).lines[0].cost.unit_cost_cents, 7777);

  for (const t of ['line_costs', 'service_costs', 'cost_settings', 'materials', 'audit_log']) {
    assert.deepEqual(await api.sqlAs(staff, `select * from ${t}`), [], t);
    assert.ok((await api.sqlAs(owner, `select * from ${t}`)).length > 0, `${t} visible to owner`);
  }
  assert.equal((await rpc(staff, 'app_get_settings', {})).costing, undefined);
  for (const fn of ['app_report', 'app_estimate_cost', 'app_list_materials', 'app_list_team', 'app_list_audit', 'app_import', 'app_save_settings']) {
    await rejects(rpc(staff, fn, { type: 'clients', rows: [] }), /Owner access required/);
  }
  await rejects(rpc(staff, 'app_export', { type: 'costing' }), /Owner access required/);

  // frozen revision snapshots contain no cost data
  const issued = await rpc(owner, 'app_issue_document', { id: d.id });
  const [rev] = await api.sqlAdmin(`select snapshot from document_revisions where document_id = '${issued.id}'`);
  assert.doesNotMatch(JSON.stringify(rev.snapshot), /unit_cost_cents|cost_total|internal_notes/);
});

/* ── CSV migration ─────────────────────────────────────────────── */
test('import keeps historical numbers, flags total mismatches, skips duplicates, advances counters', async () => {
  const res = await rpc(owner, 'app_import', { type: 'quotes', rows: [
    { number: 'QU900167', issue_date: '2026-10-01', client_name: 'Ndleko Minenhle', total_cents: 50000,
      lines: [{ name: 'Print', qty: 1, unit_price_cents: 50000 }] },
    { number: 'QU900096', issue_date: '2025-06-28', client_name: 'ARMSCOR', total_cents: 99999, status: 'accepted',
      lines: [{ name: 'Design', qty: 2, unit_price_cents: 30000 }] },
    { number: 'QU900167', issue_date: '2026-10-01', client_name: 'Dup', lines: [] },
    { number: '', issue_date: '2026-10-01', client_name: 'Nobody', lines: [] },
  ] });
  assert.equal(res.created, 2);
  assert.equal(res.skipped.length, 2);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0].warning, /99999 differs from recalculated total 60000/);
  const list = await rpc(owner, 'app_list_documents', { kind: 'quote', q: 'QU900' });
  const armscor = list.find((d) => d.number === 'QU900096');
  assert.equal(armscor.status, 'accepted');
  assert.equal(armscor.locked, true);
  const c = await newClient();
  const next = await rpc(owner, 'app_save_document', { kind: 'quote', client_id: c.id });
  assert.equal(next.number, 'QU900168', 'counter moved past imported QU900167');

  const inv = await rpc(owner, 'app_import', { type: 'invoices', rows: [
    { number: 'IN00500', issue_date: '2026-09-04', due_date: '2026-09-11', client_name: 'Sanele Mvelase', status: 'paid',
      lines: [{ name: 'Print', qty: 1, unit_price_cents: 120000 }] }] });
  assert.equal(inv.created, 1);
  const imported = (await rpc(owner, 'app_list_documents', { kind: 'invoice', q: 'IN00500' }))[0];
  assert.equal(imported.status, 'paid');
  assert.equal(imported.balance_cents, 0);
  const clients = await rpc(owner, 'app_import', { type: 'clients', rows: [{ name: 'ARMSCOR' }, { name: 'New Co', email: 'a@b.c' }] });
  assert.equal(clients.created, 1, 'existing client matched by name, not duplicated');
});

/* ── audit + reports ───────────────────────────────────────────── */
test('audit log records who changed what; reports summarise invoiced, received, outstanding and profit', async () => {
  const audit = await rpc(owner, 'app_list_audit', { limit: 500 });
  assert.ok(audit.some((a) => a.table_name === 'payments' && a.actor_email === 'staff@test.local'));
  assert.ok(audit.some((a) => a.table_name === 'documents' && a.action === 'update'));
  const r = await rpc(owner, 'app_report', { from: '2020-01-01', to: '2100-01-01' });
  assert.ok(r.totals.invoiced_cents > 0);
  assert.ok(r.received_cents > 0);
  assert.ok(r.profit.cost_cents > 0);
  assert.equal(r.profit.gross_profit_cents, r.profit.net_revenue_cents - r.profit.cost_cents);
  assert.ok(r.quotes.issued >= r.quotes.won);
});

test('exports: staff can export client-facing data, costing export is owner-only', async () => {
  const rows = await rpc(staff, 'app_export', { type: 'invoices' });
  assert.ok(rows.length > 0);
  assert.doesNotMatch(JSON.stringify(rows), /unit_cost|cost_cents/);
  const costing = await rpc(owner, 'app_export', { type: 'costing' });
  assert.ok(costing.some((r) => r.unit_cost_cents !== null));
});
