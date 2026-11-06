// Ceazers 3D admin - document calculations.
// Exact mirror of app_compute_totals / app_cost_of in
// supabase/migrations/0001_admin_schema.sql. The database is authoritative;
// this copy powers live previews. All money is integer cents. Fractions are
// handled with BigInt rational arithmetic and rounded half-away-from-zero,
// which is what Postgres round(numeric) does.

const B = (v) => BigInt(v);
const SCALE = 10000n; // percentages / rates / quantities carried as x10000

/** Round n/d (BigInt) to the nearest integer, halves away from zero. */
export function divRound(n, d) {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = a / d;
  const r = a % d;
  const res = r * 2n >= d ? q + 1n : q;
  return neg ? -res : res;
}

/** Decimal number/string -> BigInt scaled by 10^4 (exact for <= 4 decimals). */
export function scaled(v) {
  if (v === null || v === undefined || v === '') return 0n;
  const s = String(typeof v === 'number' ? v.toFixed(6) : v).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not a number: ${v}`);
  const frac = (m[3] || '').padEnd(6, '0');
  const units = B(m[2] || '0') * 1000000n + B(frac.slice(0, 6));
  // scale 10^6 -> 10^4, rounding the dropped digits
  const v4 = divRound(units, 100n);
  return m[1] === '-' ? -v4 : v4;
}

const num = (b) => Number(b);

/** Like scaled() but first rounded to decimals places, as a numeric(p, decimals) column stores it. */
export function scaledN(v, decimals) {
  const step = 10n ** B(4 - decimals);
  return divRound(scaled(v), step) * step;
}

export function lineTotal(qty, unitPriceCents) {
  return num(divRound(scaledN(qty, 3) * B(unitPriceCents || 0), SCALE));
}

/**
 * @param {object} d document fields (discount_*, shipping_cents, tax_mode,
 *   vat_rate, shipping_taxable, deposit_*, kind, status) and
 *   d.lines = [{ qty, unit_price_cents, taxable }], d.paid_cents (optional)
 */
export function computeTotals(d) {
  const lines = (d.lines || []).map((l) => ({ ...l, line_total_cents: lineTotal(l.qty ?? 1, l.unit_price_cents ?? 0) }));
  const sub = lines.reduce((s, l) => s + B(l.line_total_cents), 0n);
  const taxLines = lines.reduce((s, l) => s + (l.taxable === false ? 0n : B(l.line_total_cents)), 0n);

  let disc = 0n;
  if (d.discount_type === 'percent') disc = divRound(sub * scaled(d.discount_percent), 100n * SCALE);
  else if (d.discount_type === 'amount') disc = B(d.discount_amount_cents || 0);
  const subPos = sub > 0n ? sub : 0n;
  if (disc > subPos) disc = subPos;
  if (disc < 0n) disc = 0n;

  const shipping = B(d.shipping_cents || 0);
  const taxAfter = taxLines - (sub !== 0n ? divRound(disc * taxLines, sub) : 0n);
  let base = taxAfter + (d.shipping_taxable === false ? 0n : shipping);
  const rate = scaledN(d.vat_rate ?? 15, 3);

  let vat = 0n;
  let total;
  if (d.tax_mode === 'exclusive') {
    vat = divRound(base * rate, 100n * SCALE);
    total = sub - disc + shipping + vat;
  } else if (d.tax_mode === 'inclusive') {
    vat = divRound(base * rate, 100n * SCALE + rate);
    total = sub - disc + shipping;
  } else {
    base = 0n;
    total = sub - disc + shipping;
  }

  let dep = 0n;
  if (d.deposit_type === 'percent') dep = divRound(total * scaled(d.deposit_percent), 100n * SCALE);
  else if (d.deposit_type === 'amount') {
    const cap = total > 0n ? total : 0n;
    dep = B(d.deposit_amount_cents || 0);
    if (dep > cap) dep = cap;
  }

  const paid = B(d.paid_cents || 0);
  return {
    lines,
    subtotal_cents: num(sub),
    discount_cents: num(disc),
    taxable_cents: num(base),
    vat_cents: num(vat),
    total_cents: num(total),
    deposit_cents: num(dep),
    paid_cents: num(paid),
    balance_cents: num(total - paid),
  };
}

/** Discount as a percentage of the subtotal, for display ("6.00%"). */
export function discountPercentOf(discountCents, subtotalCents) {
  if (!subtotalCents) return 0;
  return Math.round((discountCents / subtotalCents) * 10000) / 100;
}

/**
 * Internal unit cost of a costed item (mirror of app_cost_of).
 * costing: { material_grams, print_hours, labour_hours, design_hours, other_cost_cents, material_id }
 * settings: cost_settings row; materialCostPerKgCents: cost of the chosen material
 */
export function unitCost(costing, settings, materialCostPerKgCents = 0) {
  const c = costing || {};
  const k = settings || {};
  const mat = divRound(B(materialCostPerKgCents || 0) * scaledN(c.material_grams, 3), 1000n * SCALE);
  const direct = mat * SCALE
    + scaledN(c.print_hours, 3) * (B(k.machine_rate_cents || 0) + B(k.electricity_rate_cents || 0))
    + scaledN(c.labour_hours, 3) * B(k.labour_rate_cents || 0)
    + scaledN(c.design_hours, 3) * B(k.design_rate_cents || 0)
    + B(c.other_cost_cents || 0) * SCALE;
  const f = 100n * SCALE + scaledN(k.failure_allowance_percent, 3);
  const o = 100n * SCALE + scaledN(k.overhead_percent, 3);
  return num(divRound(direct * f * o, SCALE * 100n * SCALE * 100n * SCALE));
}

export function suggestedPrice(unitCostCents, markupPercent) {
  return num(divRound(B(unitCostCents) * (100n * SCALE + scaledN(markupPercent, 3)), 100n * SCALE));
}

export function marginPercent(revenueCents, costCents) {
  if (!revenueCents) return 0;
  return Math.round(((revenueCents - costCents) / revenueCents) * 1000) / 10;
}

/* ── Money + date formatting / parsing ────────────────────────── */
export const DEFAULT_FORMAT = {
  currency_symbol: 'R', currency_position: 'front', thousand_separator: ',',
  decimal_separator: '.', decimal_places: 2, date_format: 'DD/MMM/YYYY',
};

export function formatMoney(cents, fmt = DEFAULT_FORMAT) {
  const f = { ...DEFAULT_FORMAT, ...fmt };
  const neg = cents < 0;
  let abs = Math.abs(Math.trunc(cents || 0));
  const places = Number(f.decimal_places);
  let whole; let frac = '';
  if (places === 2) { whole = Math.floor(abs / 100); frac = String(abs % 100).padStart(2, '0'); }
  else if (places === 1) { const t = num(divRound(B(abs), 10n)); whole = Math.floor(t / 10); frac = String(t % 10); }
  else { whole = num(divRound(B(abs), 100n)); }
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, f.thousand_separator);
  const n = places > 0 ? `${w}${f.decimal_separator}${frac}` : w;
  const s = f.currency_position === 'back' ? `${n} ${f.currency_symbol}`.trim() : `${f.currency_symbol}${n}`;
  return neg ? `-${s}` : s;
}

/** Parse "R14,200.00", "14 200,50", "1200" etc. to cents. Returns null if invalid. */
export function parseMoney(input, fmt = DEFAULT_FORMAT) {
  if (typeof input === 'number') return Number.isFinite(input) ? num(divRound(scaled(input) * 100n, SCALE)) : null;
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^[^\d-]+/, ''));
  s = s.replace(/[()]/g, '').replace(/[^\d.,\s'-]/g, '').replace(/-/g, '').replace(/[\s']/g, '');
  const dec = (fmt && fmt.decimal_separator) || '.';
  const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
  let decimalChar = dec;
  if (lastDot >= 0 && lastComma >= 0) decimalChar = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0 && dec !== ',') {
    // "1,234" is a thousands separator; "12,5" / "12,50" is a decimal comma
    decimalChar = /,\d{3}$/.test(s) ? '.' : ',';
  }
  const other = decimalChar === '.' ? ',' : '.';
  s = s.split(other).join('');
  if (decimalChar === ',') s = s.replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const cents = num(divRound(scaled(s) * 100n, SCALE));
  return neg ? -cents : cents;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso, format = DEFAULT_FORMAT.date_format) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  const [, y, mo, d] = m;
  return format.replace(/YYYY|YY|MMM|MM|DD/g, (t) => ({
    YYYY: y, YY: y.slice(2), MMM: MONTHS[Number(mo) - 1], MM: mo, DD: d,
  }[t]));
}

/**
 * Parse common date spellings to ISO yyyy-mm-dd. order = 'DMY' (default,
 * South Africa) or 'MDY' decides ambiguous numeric dates. Returns null if invalid.
 */
export function parseDate(input, order = 'DMY') {
  if (!input) return null;
  const s = String(input).trim();
  let y; let mo; let d;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) { [, y, mo, d] = m; }
  else if ((m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})$/.exec(s))) {
    d = m[1]; mo = MONTHS.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) + 1; y = m[3];
  } else if ((m = /^([A-Za-z]{3,9})[-/. ](\d{1,2})[-/. ,]+(\d{2,4})$/.exec(s))) {
    mo = MONTHS.findIndex((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase()) + 1; d = m[2]; y = m[3];
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    [, d, mo, y] = m;
    if (order === 'MDY') [d, mo] = [mo, d];
  } else return null;
  y = String(y); if (y.length === 2) y = `20${y}`;
  const yi = Number(y); const mi = Number(mo); const di = Number(d);
  if (!(mi >= 1 && mi <= 12 && di >= 1 && di <= 31 && yi >= 1900 && yi <= 2200)) return null;
  const dt = new Date(Date.UTC(yi, mi - 1, di));
  if (dt.getUTCMonth() !== mi - 1) return null;
  return `${y.padStart(4, '0')}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return dt.toISOString().slice(0, 10);
}

export function todayISO(now = new Date()) {
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now - tz).toISOString().slice(0, 10);
}

export function formatNumber(prefix, n, padding) {
  const s = String(n);
  return prefix + (s.length >= padding ? s : s.padStart(padding, '0'));
}
