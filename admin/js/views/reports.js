// Reports (owner only - the database also refuses staff).
import { h, clear, money, busy, setTitle } from '../ui.js';
import { todayISO, marginPercent } from '../calc.js';
import { toCSV, downloadCSV } from '../csv.js';

function presets() {
  const t = todayISO(); const [y, m] = t.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y;
  // SA tax year runs 1 March - end February
  const taxStart = m >= 3 ? `${y}-03-01` : `${y - 1}-03-01`;
  return [
    ['This month', `${y}-${pad(m)}-01`, t],
    ['Last month', `${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${lastDay(py, pm)}`],
    ['This tax year', taxStart, t],
    ['This calendar year', `${y}-01-01`, t],
    ['Last 12 months', `${y - 1}-${pad(m)}-01`, t],
  ];
}

export async function renderReports(ctx) {
  const p = presets();
  const from = h('input', { type: 'date', value: p[2][1], 'aria-label': 'From' });
  const to = h('input', { type: 'date', value: p[2][2], 'aria-label': 'To' });
  const out = h('div', { class: 'stack' });
  const chips = h('div', { class: 'chips' }, p.map(([label, f, t], i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(i === 2),
    onclick: (e) => { from.value = f; to.value = t; chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget))); load(); } }, label)));
  [from, to].forEach((x) => x.addEventListener('change', () => { chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); load(); }));

  async function load() {
    const r = await ctx.api.rpc('report', { from: from.value, to: to.value });
    const kpi = (label, value, note) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', { class: 'num' }, value), note ? h('small', { class: 'muted' }, note) : null);
    const months = mergeMonths(r.invoiced_by_month, r.received_by_month);
    const max = Math.max(1, ...months.map((m) => Math.max(m.invoiced, m.received)));
    const o = r.outstanding; const q = r.quotes; const pr = r.profit;
    clear(out).append(
      h('div', { class: 'kpis kpis-4' },
        kpi('Invoiced (incl. VAT)', money(r.totals.invoiced_cents), `${r.totals.invoice_count} invoices`),
        kpi('Received', money(r.received_cents)),
        kpi('Outstanding now', money(o.total_cents), `${o.count} unpaid invoices`),
        kpi('VAT on invoices', money(r.totals.vat_cents))),
      h('section', { class: 'panel' }, h('h2', {}, 'Invoiced vs received by month'),
        months.length ? h('div', { class: 'bars', role: 'img', 'aria-label': 'Monthly invoiced and received amounts' },
          months.map((m) => h('div', { class: 'bar-group' },
            h('div', { class: 'bar-pair' },
              bar(m.invoiced / max, 'bar-invoiced', `${m.month} invoiced ${money(m.invoiced)}`),
              bar(m.received / max, 'bar-received', `${m.month} received ${money(m.received)}`)),
            h('span', { class: 'bar-label' }, m.month.slice(2))))) : h('p', { class: 'muted' }, 'No invoices in this period.'),
        h('div', { class: 'legend' }, h('span', { class: 'sw sw-invoiced' }), 'Invoiced', h('span', { class: 'sw sw-received' }), 'Received'),
        months.length ? h('details', {}, h('summary', {}, 'Show as table'), table(['Month', 'Invoiced', 'VAT', 'Received'],
          months.map((m) => [m.month, money(m.invoiced), money(m.vat), money(m.received)]))) : null),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' }, h('h2', {}, 'Who owes you (age of debt)'),
          table(['Age', 'Amount'], [['Not yet due', money(o.current_cents)], ['1–30 days late', money(o.d1_30_cents)],
            ['31–60 days late', money(o.d31_60_cents)], ['61–90 days late', money(o.d61_90_cents)], ['Over 90 days late', money(o.d90p_cents)]])),
        h('section', { class: 'panel' }, h('h2', {}, 'Quotes'),
          table(['', ''], [['Issued', String(q.issued)], ['Won (accepted or invoiced)', String(q.won)], ['Declined', String(q.declined)],
            ['Still open', String(q.open)], ['Win rate', `${q.conversion_percent}%`], ['Value won', money(q.value_won_cents)]]))),
      h('section', { class: 'panel internal' }, h('h2', {}, 'Profit (internal)'),
        h('div', { class: 'kpis' }, kpi('Revenue excl. VAT', money(pr.net_revenue_cents)), kpi('Cost of work', money(pr.cost_cents)),
          kpi('Gross profit', money(pr.gross_profit_cents)), kpi('Margin', `${marginPercent(pr.net_revenue_cents, pr.cost_cents)}%`)),
        pr.invoices_without_costing ? h('p', { class: 'muted' }, `${pr.invoices_without_costing} invoice(s) in this period have no costing, so profit is overstated.`) : null),
      h('section', { class: 'panel' }, h('h2', {}, 'Top clients'),
        r.top_clients.length ? table(['Client', 'Invoices', 'Invoiced'], r.top_clients.map((c) => [c.name, String(c.invoices), money(c.cents)])) : h('p', { class: 'muted' }, 'No invoices in this period.')),
      exportPanel(ctx, r));
  }
  await load();
  return h('div', {}, setTitle('Reports'), h('div', { class: 'toolbar' }, chips, h('div', { class: 'row-gap' }, from, h('span', {}, 'to'), to)), out);
}

function mergeMonths(inv, rec) {
  const map = new Map();
  inv.forEach((m) => map.set(m.month, { month: m.month, invoiced: m.cents, vat: m.vat_cents, received: 0 }));
  rec.forEach((m) => { const x = map.get(m.month) || { month: m.month, invoiced: 0, vat: 0, received: 0 }; x.received = m.cents; map.set(m.month, x); });
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}
function bar(fraction, cls, label) {
  const b = h('div', { class: `bar ${cls}`, title: label, 'aria-label': label });
  b.style.height = `${Math.max(2, Math.round(fraction * 160))}px`;
  return b;
}
function table(head, rows) {
  return h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
    head.some(Boolean) ? h('thead', {}, h('tr', {}, head.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))) : null,
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i ? 'num' : '' }, c)))))));
}
function exportPanel(ctx, r) {
  const btn = (label, type) => {
    const b = h('button', { type: 'button', class: 'btn btn-small' }, label);
    b.addEventListener('click', busy(b, async () => {
      if (type === 'summary') {
        const rows = mergeMonths(r.invoiced_by_month, r.received_by_month).map((m) => ({
          month: m.month, invoiced: (m.invoiced / 100).toFixed(2), vat: (m.vat / 100).toFixed(2), received: (m.received / 100).toFixed(2) }));
        downloadCSV(`report-${r.from}-to-${r.to}.csv`, toCSV(rows));
        return;
      }
      const rows = await ctx.api.rpc('export', { type });
      downloadCSV(`${type}-${todayISO()}.csv`, toCSV(rows.map(centsColumnsToRand)));
    }));
    return b;
  };
  return h('section', { class: 'panel' }, h('h2', {}, 'Export CSV'),
    h('div', { class: 'row-gap wrap' }, btn('This report', 'summary'), btn('Invoices', 'invoices'), btn('Quotes', 'quotes'),
      btn('Payments', 'payments'), btn('Costing (internal)', 'costing')));
}
export function centsColumnsToRand(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_cents')) out[k.replace(/_cents$/, '')] = v === null || v === undefined ? '' : (Number(v) / 100).toFixed(2);
    else out[k] = v;
  }
  return out;
}
