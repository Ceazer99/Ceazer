import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTotals, formatMoney, parseMoney, formatDate, parseDate, addDays, formatNumber,
  discountPercentOf, lineTotal, suggestedPrice, marginPercent, divRound,
} from '../admin/js/calc.js';
import { parseCSV, parseCSVObjects, toCSV, safeCell, guessMapping, buildImportRows } from '../admin/js/csv.js';

test('rounding is half away from zero (same as Postgres round(numeric))', () => {
  assert.equal(divRound(5n, 2n), 3n);
  assert.equal(divRound(-5n, 2n), -3n);
  assert.equal(divRound(4n, 3n), 1n);
  assert.equal(lineTotal(0.5, 1), 1);
  assert.equal(lineTotal(1.005, 100), 101);  // qty stored as numeric(12,3) -> 1.005
  assert.equal(lineTotal(1.0005, 100000), 100100); // rounded to 1.001 first, like the DB column
});

test('screenshot invoice IN00098: subtotal = total = R16,670.00, shown as in the old app', () => {
  const t = computeTotals({ tax_mode: 'none', lines: [
    { qty: 1, unit_price_cents: 40000 }, { qty: 1, unit_price_cents: 1420000 }, { qty: 1, unit_price_cents: 207000 }] });
  assert.equal(t.total_cents, 1667000);
  assert.equal(formatMoney(t.total_cents), 'R16,670.00');
  assert.equal(discountPercentOf(100000, 1667000), 6);
});

test('money formatting honours symbol, placement, separators and decimals', () => {
  assert.equal(formatMoney(1587000), 'R15,870.00');
  assert.equal(formatMoney(-1250), '-R12.50');
  assert.equal(formatMoney(123456789, { thousand_separator: ' ', decimal_separator: ',', currency_position: 'back' }), '1 234 567,89 R');
  assert.equal(formatMoney(1587050, { decimal_places: 0 }), 'R15,871');
  assert.equal(formatMoney(5, {}), 'R0.05');
});

test('money parsing accepts the formats people actually type and old exports use', () => {
  assert.equal(parseMoney('R14,200.00'), 1420000);
  assert.equal(parseMoney('14 200,50'), 1420050);
  assert.equal(parseMoney('1,234'), 123400);
  assert.equal(parseMoney('12,5'), 1250);
  assert.equal(parseMoney('(R1,000.00)'), -100000);
  assert.equal(parseMoney('-200'), -20000);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(19.99), 1999);
});

test('dates: DD/MMM/YYYY like the old app, ISO, and numeric day-first', () => {
  assert.equal(formatDate('2026-11-04', 'DD/MMM/YYYY'), '04/Nov/2026');
  assert.equal(formatDate('2026-11-04', 'YYYY-MM-DD'), '2026-11-04');
  assert.equal(parseDate('04/Nov/2026'), '2026-11-04');
  assert.equal(parseDate('4 November 2026'), '2026-11-04');
  assert.equal(parseDate('2026-11-04'), '2026-11-04');
  assert.equal(parseDate('04/11/2026'), '2026-11-04');
  assert.equal(parseDate('11/04/2026', 'MDY'), '2026-11-04');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('nonsense'), null);
  assert.equal(addDays('2026-11-05', 7), '2026-11-12');
});

test('document numbers are zero padded but never truncated', () => {
  assert.equal(formatNumber('QU', 117, 6), 'QU000117');
  assert.equal(formatNumber('IN', 98, 5), 'IN00098');
  assert.equal(formatNumber('IN', 1234567, 5), 'IN1234567');
});

test('costing helpers', () => {
  assert.equal(suggestedPrice(10000, 60), 16000);
  assert.equal(marginPercent(16000, 10000), 37.5);
  assert.equal(marginPercent(0, 10), 0);
});

test('CSV parser handles quotes, embedded newlines, ; delimiters and BOM', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseCSV('a;b\n1;"2\n3"'), [['a', 'b'], ['1', '2\n3']]);
  assert.throws(() => parseCSV('a,"b'), /unclosed quote/);
  const { headers, records } = parseCSVObjects('Name ,Email\nACME,a@b.c\n');
  assert.deepEqual(headers, ['Name', 'Email']);
  assert.equal(records[0].Name, 'ACME');
});

test('CSV export neutralises spreadsheet formulas (CSV injection)', () => {
  assert.equal(safeCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(safeCell('+27 82 404 6423'), "'+27 82 404 6423");
  assert.equal(safeCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(safeCell('-1250'), '-1250', 'plain negative numbers stay numbers');
  const csv = toCSV([{ name: '=cmd|"/c calc"!A1', total: 5 }]);
  assert.match(csv, /'=cmd/);
  assert.ok(csv.startsWith('﻿'));
});

test('import mapping guesses old-app headers and groups line rows into documents', () => {
  const text = [
    'Quote No,Quote date,Client,Item,Description,Rate,Qty,Amount,Discount,Shipping,Total',
    'QU000117,04/Nov/2026,Envelop Empowerment Group (Pyt) Ltd,Wall clock CAD Design,CAD Modelling,"R400.00",1,R400.00,"R1,000.00",R200.00,"R15,870.00"',
    'QU000117,04/Nov/2026,Envelop Empowerment Group (Pyt) Ltd,3D printing,3D printing 12x Safety Boot Wall Clock,"R14,200.00",1,"R14,200.00",,,',
    'QU000117,04/Nov/2026,Envelop Empowerment Group (Pyt) Ltd,VAT,,"R2,070.00",1,"R2,070.00",,,',
    'QU000096,28/Jun/2025,ARMSCOR,Design,,,2,"R600.00",,,R600.00',
    ',04/Nov/2026,No number,x,,R1,1,R1,,,',
    'QU000200,not a date,Someone,x,,R1,1,R1,,,',
  ].join('\n');
  const { headers, records } = parseCSVObjects(text);
  const map = guessMapping(headers, 'quotes');
  assert.equal(map.number, 'Quote No');
  assert.equal(map.issue_date, 'Quote date');
  assert.equal(map.client_name, 'Client');
  assert.equal(map.rate, 'Rate');
  const { rows, errors } = buildImportRows(records, map, 'quotes');
  assert.equal(rows.length, 2);
  const q = rows.find((r) => r.number === 'QU000117');
  assert.equal(q.lines.length, 3);
  assert.equal(q.discount_cents, 100000);
  assert.equal(q.shipping_cents, 20000);
  assert.equal(q.total_cents, 1587000);
  assert.equal(q.issue_date, '2026-11-04');
  assert.equal(q.tax_mode, 'none', 'historical VAT lines are kept as lines, not re-taxed');
  const t = computeTotals({ ...q, discount_type: 'amount', discount_amount_cents: q.discount_cents });
  assert.equal(t.total_cents, q.total_cents, 'regrouped lines reproduce the CSV total');
  const a = rows.find((r) => r.number === 'QU000096');
  assert.equal(a.lines[0].unit_price_cents, 30000, 'rate derived from amount / qty when missing');
  assert.equal(errors.length, 2);
  assert.match(errors.map((e) => e.message).join(' | '), /Missing document number.*Unreadable date/);
});

test('PDF model is built from client-facing fields only (costing and internal notes cannot leak)', async () => {
  const { buildPdfModel } = await import('../admin/js/pdf.js');
  const doc = {
    kind: 'quote', number: 'QU000117', revision: 2, status: 'sent', locked: true, issue_date: '2026-11-04', due_date: '2026-12-04',
    tax_mode: 'exclusive', vat_rate: 15, discount_type: 'amount', discount_amount_cents: 100000, deposit_type: 'percent', deposit_percent: 50,
    client_snapshot: { name: 'Envelop', billing_address: '37 Gillits Road' },
    company_snapshot: { name: 'Ceazers 3D Engineering Solutions', vat_number: '9117677287', bank_name: 'ABSA BANK' },
    lines: [{ name: 'CAD', description: 'x', qty: 1, unit_price_cents: 40000, line_total_cents: 40000, cost: { unit_cost_cents: 777777, breakdown: { material_grams: 5 } } }],
    subtotal_cents: 40000, discount_cents: 10000, shipping_cents: 0, vat_cents: 4500, total_cents: 34500, deposit_cents: 17250,
    cost_total_cents: 999999, internal_notes: 'TOP SECRET margin', paid_cents: 0, balance_cents: 34500,
  };
  const m = buildPdfModel(doc, doc.company_snapshot);
  const json = JSON.stringify(m);
  assert.doesNotMatch(json, /777777|999999|TOP SECRET|unit_cost|breakdown|material_grams/);
  assert.equal(m.title, 'Quote');
  assert.deepEqual(m.meta.find((x) => x[0] === 'Revision'), ['Revision', '2']);
  assert.ok(m.totals.some(([k, v]) => k === 'Discount (25.00%)' && v === '-R100.00'));
  assert.ok(m.totals.some(([k]) => k === 'Deposit required (50.00%)'));
  assert.equal(m.paymentMethods.length, 0, 'bank details only on invoices');
  assert.equal(m.filename, 'QU000117-R2.pdf');
  const inv = buildPdfModel({ ...doc, kind: 'invoice', number: 'IN00098', revision: 1 }, doc.company_snapshot);
  assert.equal(inv.title, 'Tax Invoice', 'VAT-registered + VAT applied => Tax Invoice');
  assert.ok(inv.paymentMethods.includes('Bank: ABSA BANK'));
  assert.equal(buildPdfModel({ ...doc, locked: false, status: 'draft' }, doc.company_snapshot).watermark, 'DRAFT');
  assert.equal(buildPdfModel({ ...doc, status: 'void' }, doc.company_snapshot).watermark, 'VOID');
});

test('client and service import rows', () => {
  const { headers, records } = parseCSVObjects('Client name,E-mail,Phone,Address\nARMSCOR,x@y.z,012,Pretoria\n,,,\n');
  const r = buildImportRows(records, guessMapping(headers, 'clients'), 'clients');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].email, 'x@y.z');
  const s = parseCSVObjects('Item,Description,Rate\nCAD hour,Modelling,"R400.00"\nBad,,R??\n');
  const out = buildImportRows(s.records, guessMapping(s.headers, 'services'), 'services');
  assert.equal(out.rows[0].unit_price_cents, 40000);
  assert.equal(out.errors.length, 1);
});
