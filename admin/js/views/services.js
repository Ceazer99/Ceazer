// Saved services / items. Owners also see and edit the internal cost recipe.
import { h, clear, icon, toast, money, field, textInput, textarea, moneyInput, busy, emptyState, toCents, setTitle } from '../ui.js';
import { unitCost, suggestedPrice, marginPercent } from '../calc.js';

export async function renderServices(ctx) {
  const host = h('div', { class: 'card-list' });
  const search = h('input', { type: 'search', placeholder: 'Search items', 'aria-label': 'Search items' });
  const showArchived = h('input', { type: 'checkbox' });
  async function load() {
    const rows = await ctx.api.rpc('list_services', { q: search.value.trim(), include_archived: showArchived.checked });
    clear(host);
    if (!rows.length) { host.appendChild(emptyState('No saved items', 'Save the services you quote often (CAD hours, print jobs, finishing) so you can add them in one tap.')); return; }
    rows.forEach((s) => {
      const cost = ctx.owner && s.costing ? s.costing.unit_cost_cents : null;
      host.appendChild(h('a', { class: 'doc-row', href: `#/items/${s.id}` },
        h('div', { class: 'doc-row-main' }, h('strong', {}, s.name, s.archived ? ' (archived)' : ''), h('span', { class: 'muted' }, s.description || `per ${s.unit}`)),
        h('div', { class: 'doc-row-side' }, h('strong', { class: 'num' }, money(s.unit_price_cents)),
          cost !== null ? h('span', { class: 'muted num internal-inline' }, `cost ${money(cost)} · ${marginPercent(s.unit_price_cents, cost)}%`) : null)));
    });
  }
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  showArchived.addEventListener('change', load);
  await load();
  return h('div', {}, setTitle('Items', h('a', { class: 'btn btn-primary', href: '#/items/new' }, icon('plus', 18), 'New item')),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), h('label', { class: 'check' }, showArchived, h('span', {}, 'Show archived'))),
    host);
}

export async function renderService(ctx, id) {
  const [all, materials] = await Promise.all([
    ctx.api.rpc('list_services', { include_archived: true }),
    ctx.owner ? ctx.api.rpc('list_materials', {}) : Promise.resolve([]),
  ]);
  const s = id === 'new' ? { name: '', description: '', unit: 'each', unit_price_cents: 0, taxable: true } : all.find((x) => x.id === id);
  if (!s) throw new Error('Item not found');
  const k = ctx.settings.costing || {};
  const c = s.costing || {};

  const name = textInput('name', s.name, { required: true, maxlength: 200 });
  const desc = textarea('description', s.description, { rows: 3, maxlength: 2000 });
  const unit = textInput('unit', s.unit, { maxlength: 20 });
  const price = moneyInput('price', s.unit_price_cents);
  const taxable = h('input', { type: 'checkbox', checked: s.taxable !== false });
  const err = h('p', { class: 'field-error', role: 'alert' });

  // owner-only costing recipe
  const matSel = h('select', { name: 'material_id' }, h('option', { value: '' }, 'No material'),
    materials.map((m) => h('option', { value: m.id, selected: m.id === c.material_id ? 'selected' : null }, `${m.name} (${money(m.cost_per_kg_cents)}/kg)`)));
  const n = (v) => h('input', { type: 'text', inputmode: 'decimal', class: 'num', value: String(v ?? 0) });
  const grams = n(c.material_grams); const ph = n(c.print_hours); const lh = n(c.labour_hours); const dh = n(c.design_hours);
  const other = moneyInput('other', c.other_cost_cents || 0);
  const markup = n(k.default_markup_percent ?? 60);
  const out = h('div', { class: 'kpis' });
  const recipe = () => ({ material_id: matSel.value || null, material_grams: Number(grams.value) || 0, print_hours: Number(ph.value) || 0,
    labour_hours: Number(lh.value) || 0, design_hours: Number(dh.value) || 0, other_cost_cents: toCents(other.value) || 0 });
  let suggested = 0;
  const recalc = () => {
    const m = materials.find((x) => x.id === matSel.value);
    const cost = unitCost(recipe(), k, m ? m.cost_per_kg_cents : 0);
    suggested = suggestedPrice(cost, Number(markup.value) || 0);
    const p = toCents(price.value) || 0;
    clear(out).append(kpiEl('Unit cost', money(cost)), kpiEl('Suggested price', money(suggested)), kpiEl('Margin at your price', `${marginPercent(p, cost)}%`));
  };
  const costing = ctx.owner ? h('section', { class: 'panel internal' },
    h('div', { class: 'internal-tag' }, icon('lock', 14), 'Internal costing · owner only · never printed'),
    field('Material', matSel),
    h('div', { class: 'grid-4' }, field('Grams per unit', grams), field('Print hours', ph), field('Labour hours', lh), field('Design hours', dh)),
    h('div', { class: 'grid-2' }, field('Other cost per unit', other), field('Markup %', markup)),
    out,
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => { price.value = (suggested / 100).toFixed(2); recalc(); } }, 'Use suggested price'),
    h('p', { class: 'muted' }, 'New quote lines made from this item carry this unit cost, so you see the margin per quote.')) : null;
  if (ctx.owner) { [matSel, grams, ph, lh, dh, other, markup, price].forEach((x) => x.addEventListener('input', recalc)); matSel.addEventListener('change', recalc); recalc(); }

  const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save item');
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const p = toCents(price.value);
    if (!name.value.trim()) { err.textContent = 'Enter a name.'; return; }
    if (p === null) { err.textContent = 'Enter a valid price.'; return; }
    const saved = await ctx.api.rpc('save_service', { id: s.id, name: name.value.trim(), description: desc.value, unit: unit.value,
      unit_price_cents: p, taxable: taxable.checked, ...(ctx.owner ? { costing: recipe() } : {}) });
    toast('Item saved');
    if (!s.id) ctx.navigate(`/items/${saved.id}`);
  }));
  const archive = s.id ? h('button', { type: 'button', class: 'btn btn-ghost' }, s.archived ? 'Restore' : 'Archive') : null;
  archive?.addEventListener('click', busy(archive, async () => {
    await ctx.api.rpc('save_service', { id: s.id, archived: !s.archived }); toast(s.archived ? 'Item restored' : 'Item archived'); ctx.navigate('/items');
  }));

  return h('div', { class: 'narrow' },
    h('a', { class: 'back', href: '#/items' }, icon('back', 16), 'Items'),
    setTitle(s.id ? s.name : 'New item'),
    h('section', { class: 'panel stack' },
      field('Name *', name), field('Description (printed on documents)', desc),
      h('div', { class: 'grid-2' }, field('Price', price), field('Unit', unit, 'e.g. each, hour, part')),
      h('label', { class: 'check' }, taxable, h('span', {}, 'VAT applies')), err),
    costing,
    h('div', { class: 'action-bar' }, archive, h('span', { class: 'spacer' }), save));
}

const kpiEl = (label, value) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', { class: 'num' }, value));
