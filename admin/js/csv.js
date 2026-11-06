// Ceazers 3D admin - CSV parsing, safe export and migration mapping.
import { parseMoney, parseDate } from './calc.js';

/* ── Parsing (RFC 4180 + delimiter detection + BOM) ───────────── */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = [',', ';', '\t'].map((d) => [d, countOutsideQuotes(firstLine, d)]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}
function countOutsideQuotes(line, d) {
  let n = 0; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
  return n;
}

export function parseCSV(text, delimiter) {
  const src = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src);
  const rows = []; let row = []; let field = ''; let i = 0; let quoted = false;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  if (quoted) throw new Error('CSV has an unclosed quote');
  return rows;
}

/** First row as headers -> array of objects keyed by trimmed header. */
export function parseCSVObjects(text, delimiter) {
  const rows = parseCSV(text, delimiter);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, records };
}

/* ── Export (formula-injection safe) ──────────────────────────── */
// Cells starting with = + - @ (or tab/CR) are executed as formulas by Excel/
// Sheets. Prefix them with an apostrophe so exported client data can't run.
export function safeCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [cols.map(safeCell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => safeCell(r[c])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ── Migration mapping ────────────────────────────────────────── */
// Field -> header synonyms (lower-case, punctuation stripped). Covers the
// screenshots' app ("Quote No", "Rate", "Qty", "Amount"...) and generic exports.
export const IMPORT_FIELDS = {
  clients: {
    name: ['name', 'client', 'client name', 'company', 'contact', 'contact name', 'customer', 'full name'],
    contact_person: ['contact person', 'attention', 'attn'],
    email: ['email', 'e mail', 'email address'],
    phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone number'],
    billing_address: ['address', 'billing address', 'billing', 'street'],
    shipping_address: ['shipping address', 'ship to', 'delivery address'],
    vat_number: ['vat', 'vat number', 'vat no', 'tax number'],
    notes: ['notes', 'note', 'comments'],
  },
  services: {
    name: ['name', 'item', 'item name', 'service', 'product', 'title'],
    description: ['description', 'details', 'desc'],
    unit_price: ['rate', 'price', 'unit price', 'amount', 'cost'],
    taxable: ['taxable', 'tax'],
  },
  documents: {
    number: ['number', 'no', 'quote no', 'quote number', 'invoice no', 'invoice number', 'document number', 'doc no', 'reference'],
    issue_date: ['date', 'quote date', 'invoice date', 'issue date', 'created'],
    due_date: ['due date', 'due', 'valid until', 'expiry'],
    client_name: ['client', 'client name', 'customer', 'company', 'billing name', 'name', 'bill to', 'invoice to'],
    client_email: ['client email', 'email'],
    client_phone: ['client phone', 'phone'],
    client_address: ['client address', 'address', 'billing address'],
    status: ['status', 'state', 'paid status'],
    item: ['item', 'item name', 'product', 'service', 'line item'],
    description: ['description', 'item description', 'details'],
    qty: ['qty', 'quantity', 'units'],
    rate: ['rate', 'price', 'unit price'],
    amount: ['amount', 'line total', 'line amount'],
    discount: ['discount', 'discount amount'],
    shipping: ['shipping', 'delivery', 'freight'],
    total: ['total', 'grand total', 'document total'],
    paid: ['paid', 'amount paid', 'paid amount'],
    paid_on: ['paid on', 'payment date', 'date paid'],
    notes: ['notes', 'note', 'comments'],
  },
};

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Best-guess header -> field mapping. Each header is used at most once. */
export function guessMapping(headers, kind) {
  const fields = IMPORT_FIELDS[kind === 'quotes' || kind === 'invoices' ? 'documents' : kind];
  const used = new Set();
  const map = {};
  // exact synonym matches first, in field priority order
  for (const [field, syns] of Object.entries(fields)) {
    const h = headers.find((x) => !used.has(x) && syns.includes(norm(x)));
    if (h) { map[field] = h; used.add(h); }
  }
  return map;
}

const truthy = (v) => /^(y|yes|true|1|taxable|vat)$/i.test(String(v || '').trim());

function mapStatus(raw, kind) {
  const s = norm(raw);
  if (!s) return '';
  if (/void|cancel/.test(s)) return 'void';
  if (kind === 'invoices') {
    if (/partial/.test(s)) return 'partially_paid';
    if (/paid|settled|closed/.test(s) && !/unpaid|not paid/.test(s)) return 'paid';
    return 'issued';
  }
  if (/accept|approv|won/.test(s)) return 'accepted';
  if (/declin|reject|lost/.test(s)) return 'declined';
  if (/convert|invoiced/.test(s)) return 'converted';
  return 'sent';
}

/**
 * Turn CSV records into import rows for app_import.
 * Documents: one CSV row per line item; rows sharing a document number are
 * grouped. Header-only values (date, client, totals) are taken from the
 * first row of each group.
 * Returns { rows, errors: [{ row, message }] }.
 */
export function buildImportRows(records, mapping, kind, opts = {}) {
  const order = opts.dateOrder || 'DMY';
  const fmt = opts.format;
  const get = (rec, field) => (mapping[field] ? (rec[mapping[field]] ?? '').trim() : '');
  const errors = [];

  if (kind === 'clients') {
    const rows = [];
    records.forEach((rec, i) => {
      const name = get(rec, 'name');
      if (!name) { errors.push({ row: i + 2, message: 'Missing client name' }); return; }
      rows.push({
        name, contact_person: get(rec, 'contact_person'), email: get(rec, 'email'), phone: get(rec, 'phone'),
        billing_address: get(rec, 'billing_address'), shipping_address: get(rec, 'shipping_address'),
        vat_number: get(rec, 'vat_number'), notes: get(rec, 'notes'),
      });
    });
    return { rows, errors };
  }

  if (kind === 'services') {
    const rows = [];
    records.forEach((rec, i) => {
      const name = get(rec, 'name');
      if (!name) { errors.push({ row: i + 2, message: 'Missing item name' }); return; }
      const price = get(rec, 'unit_price') ? parseMoney(get(rec, 'unit_price'), fmt) : 0;
      if (price === null) { errors.push({ row: i + 2, message: `Unreadable price "${get(rec, 'unit_price')}"` }); return; }
      rows.push({ name, description: get(rec, 'description'), unit_price_cents: price,
        taxable: mapping.taxable ? truthy(get(rec, 'taxable')) : false });
    });
    return { rows, errors };
  }

  // quotes / invoices
  const groups = new Map();
  records.forEach((rec, i) => {
    const rowNo = i + 2;
    const number = get(rec, 'number');
    if (!number) { errors.push({ row: rowNo, message: 'Missing document number' }); return; }
    let g = groups.get(number);
    if (!g) {
      const issue = parseDate(get(rec, 'issue_date'), order);
      if (!issue) { errors.push({ row: rowNo, message: `Unreadable date "${get(rec, 'issue_date')}" for ${number}` }); return; }
      const client = get(rec, 'client_name');
      if (!client) { errors.push({ row: rowNo, message: `Missing client for ${number}` }); return; }
      const money = (field) => {
        const raw = get(rec, field);
        if (!raw) return null;
        const v = parseMoney(raw, fmt);
        if (v === null) errors.push({ row: rowNo, message: `Unreadable ${field} "${raw}" for ${number}` });
        return v;
      };
      g = {
        number, issue_date: issue, due_date: parseDate(get(rec, 'due_date'), order) || '',
        client_name: client, client_email: get(rec, 'client_email'), client_phone: get(rec, 'client_phone'),
        client_address: get(rec, 'client_address'), status: mapStatus(get(rec, 'status'), kind),
        notes: get(rec, 'notes'), discount_cents: money('discount') || 0, shipping_cents: money('shipping') || 0,
        total_cents: money('total'), paid_cents: money('paid') || 0,
        paid_on: parseDate(get(rec, 'paid_on'), order) || '',
        tax_mode: 'none', lines: [],
      };
      groups.set(number, g);
    }
    const item = get(rec, 'item'); const desc = get(rec, 'description');
    if (!item && !desc && !get(rec, 'rate') && !get(rec, 'amount')) return; // header-only row
    const qtyRaw = get(rec, 'qty');
    const qty = qtyRaw ? Number(qtyRaw.replace(',', '.')) : 1;
    if (!Number.isFinite(qty)) { errors.push({ row: rowNo, message: `Unreadable quantity "${qtyRaw}"` }); return; }
    let rate = get(rec, 'rate') ? parseMoney(get(rec, 'rate'), fmt) : null;
    const amount = get(rec, 'amount') ? parseMoney(get(rec, 'amount'), fmt) : null;
    if (rate === null && amount !== null) rate = qty ? Math.round(amount / qty) : amount;
    if (rate === null) { errors.push({ row: rowNo, message: `Missing rate/amount on ${number}` }); return; }
    g.lines.push({ name: item, description: desc, qty, unit_price_cents: rate, taxable: false });
  });
  return { rows: [...groups.values()], errors };
}

export function downloadCSV(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
