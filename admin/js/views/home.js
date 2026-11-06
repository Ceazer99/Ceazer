// Home: what needs attention today.
import { h, money, date, statusBadge, icon, setTitle } from '../ui.js';

export async function renderHome(ctx) {
  const [overdue, open, drafts, quotes] = await Promise.all([
    ctx.api.rpc('list_documents', { kind: 'invoice', status: 'overdue', limit: 20 }),
    ctx.api.rpc('list_documents', { kind: 'invoice', status: 'open', limit: 200 }),
    ctx.api.rpc('list_documents', { kind: 'quote', status: 'draft', limit: 10 }),
    ctx.api.rpc('list_documents', { kind: 'quote', status: 'sent', limit: 20 }),
  ]);
  const owing = open.reduce((s, d) => s + d.balance_cents, 0);
  const quoted = quotes.reduce((s, d) => s + d.total_cents, 0);
  const tile = (label, value, href) => h('a', { class: 'kpi kpi-link', href }, h('span', {}, label), h('strong', { class: 'num' }, value));
  const list = (title, rows, path, empty) => h('section', { class: 'panel' }, h('h2', {}, title),
    rows.length ? h('div', { class: 'card-list compact' }, rows.slice(0, 8).map((d) => h('a', { class: 'doc-row', href: `#/${path}/${d.id}` },
      h('div', { class: 'doc-row-main' }, h('strong', {}, d.client_name || 'No client'), h('span', { class: 'muted' }, `${d.number || 'Draft'} · ${date(d.issue_date)}`)),
      h('div', { class: 'doc-row-side' }, h('strong', { class: 'num' }, money(d.kind === 'invoice' ? d.balance_cents : d.total_cents)), statusBadge(d))))) :
      h('p', { class: 'muted' }, empty));
  return h('div', {},
    setTitle(`Hello${ctx.me.full_name ? `, ${ctx.me.full_name.split(' ')[0]}` : ''}`,
      h('div', { class: 'row-gap' }, h('a', { class: 'btn btn-primary', href: '#/quotes/new' }, icon('plus', 18), 'New quote'),
        h('a', { class: 'btn', href: '#/invoices/new' }, icon('plus', 18), 'New invoice'))),
    h('div', { class: 'kpis kpis-4' },
      tile('Owed to you', money(owing), '#/invoices'),
      tile('Overdue invoices', String(overdue.length), '#/invoices'),
      tile('Quotes awaiting reply', String(quotes.length), '#/quotes'),
      tile('Value of open quotes', money(quoted), '#/quotes')),
    h('div', { class: 'grid-2' },
      list('Overdue invoices', overdue, 'invoices', 'Nothing overdue. Nice.'),
      list('Quotes awaiting a reply', quotes, 'quotes', 'No open quotes.')),
    drafts.length ? list('Draft quotes', drafts, 'quotes', '') : null);
}
