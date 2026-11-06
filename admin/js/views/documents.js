// Quotes + invoices: list, editor (drafts), viewer (issued), payments, PDFs.
import {
  h, clear, icon, toast, money, date, toCents, centsToInput, field, textInput, moneyInput, select, textarea,
  modal, confirmDialog, promptDialog, statusBadge, busy, emptyState, setTitle,
} from '../ui.js';
import { computeTotals, unitCost, suggestedPrice, marginPercent, todayISO, addDays, discountPercentOf } from '../calc.js';
import { buildPdfModel, renderPdf } from '../pdf.js';
import { clientForm } from './clients.js';
import { LOST_REASONS, labelOf } from '../lists.js';

const LABEL = { quote: 'Quote', invoice: 'Invoice' };
const PLURAL = { quote: 'quotes', invoice: 'invoices' };
const FILTERS = {
  quote: [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['converted', 'Invoiced'], ['void', 'Void']],
  invoice: [['', 'All'], ['draft', 'Draft'], ['open', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']],
};

/* ════════════════════════════ list ════════════════════════════ */
export async function renderDocumentList(ctx, kind) {
  const state = { q: '', status: '' };
  const listHost = h('div', { class: 'doc-list' });
  const newBtn = h('a', { class: 'btn btn-primary', href: `#/${PLURAL[kind]}/new` }, icon('plus', 18), `New ${LABEL[kind].toLowerCase()}`);
  const search = h('input', { type: 'search', placeholder: `Search ${PLURAL[kind]} by client or number`, 'aria-label': 'Search' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' },
    FILTERS[kind].map(([v, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(v === ''), dataset: { v },
      onclick: (e) => {
        state.status = v;
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
        load();
      } }, label)));

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value.trim(); load(); }, 250); });

  async function load() {
    const rows = await ctx.api.rpc('list_documents', { kind, q: state.q, status: state.status, limit: 300 });
    clear(listHost);
    if (!rows.length) {
      listHost.appendChild(emptyState(`No ${PLURAL[kind]} yet`, state.q || state.status ? 'Nothing matches this search.' :
        `Create your first ${LABEL[kind].toLowerCase()} or import your history from Settings → Import & export.`, state.q || state.status ? null : newBtn.cloneNode(true)));
      return;
    }
    let lastDate = null;
    for (const d of rows) {
      if (d.issue_date !== lastDate) { listHost.appendChild(h('div', { class: 'date-row' }, date(d.issue_date))); lastDate = d.issue_date; }
      listHost.appendChild(h('a', { class: 'doc-row', href: `#/${PLURAL[kind]}/${d.id}` },
        h('div', { class: 'doc-row-main' },
          h('strong', {}, d.client_name || 'No client'),
          h('span', { class: 'muted' }, d.number || 'Draft (no number yet)', d.revision > 1 ? ` · rev ${d.revision}` : '', d.imported ? ' · imported' : '')),
        h('div', { class: 'doc-row-side' },
          h('strong', { class: 'num' }, money(d.total_cents)),
          kind === 'invoice' && d.balance_cents > 0 && d.paid_cents > 0 ? h('span', { class: 'muted num' }, `${money(d.balance_cents)} due`) : null,
          statusBadge(d))));
    }
  }
  await load();
  const fab = h('a', { class: 'fab', href: `#/${PLURAL[kind]}/new`, 'aria-label': `New ${LABEL[kind].toLowerCase()}` }, icon('plus', 26));
  return h('div', {}, setTitle(kind === 'quote' ? 'Quotes' : 'Invoices', newBtn), h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), chips), listHost, fab);
}

/* ════════════════════════════ router ════════════════════════════ */
export async function renderDocument(ctx, kind, id) {
  if (id === 'new') return renderEditor(ctx, kind, null);
  const doc = await ctx.api.rpc('get_document', { id });
  if (doc.kind !== kind) { ctx.navigate(`/${PLURAL[doc.kind]}/${doc.id}`); return h('div'); }
  return doc.locked ? renderViewer(ctx, doc) : renderEditor(ctx, kind, doc);
}

/* ════════════════════════════ editor ════════════════════════════ */
async function renderEditor(ctx, kind, existing) {
  const s = ctx.settings;
  const [clients, services, materials] = await Promise.all([
    ctx.api.rpc('list_clients', {}),
    ctx.api.rpc('list_services', {}),
    ctx.owner ? ctx.api.rpc('list_materials', {}) : Promise.resolve([]),
  ]);
  const categories = await ctx.api.rpc('list_categories', {});
  const today = todayISO();
  const doc = existing ? structuredClone(existing) : {
    kind, title: LABEL[kind], client_id: '', client_snapshot: {}, issue_date: today,
    due_date: addDays(today, kind === 'quote' ? s.quote_validity_days : s.terms_days),
    reference: '', notes: '', terms: kind === 'quote' ? s.quote_terms : s.invoice_terms, internal_notes: '',
    discount_type: 'none', discount_percent: 0, discount_amount_cents: 0, shipping_cents: 0,
    tax_mode: s.tax_mode, vat_rate: s.vat_rate, shipping_taxable: s.shipping_taxable,
    deposit_type: kind === 'quote' && Number(s.default_deposit_percent) > 0 ? 'percent' : 'none',
    deposit_percent: s.default_deposit_percent, deposit_amount_cents: 0, lines: [], revision: 1,
  };
  if (!doc.lines.length && !existing) doc.lines.push(blankLine(s));
  if (!existing) {
    const pre = sessionStorage.getItem('admin.newDocClient');
    sessionStorage.removeItem('admin.newDocClient');
    const c = pre && clients.find((x) => x.id === pre);
    if (c) {
      doc.client_id = c.id;
      doc.client_snapshot = { name: c.name, email: c.email, phone: c.phone, billing_address: c.billing_address,
        shipping_address: c.shipping_address || c.billing_address, contact_person: c.contact_person, vat_number: c.vat_number };
    }
  }
  let dirty = false;
  const markDirty = () => { dirty = true; refresh(); };

  /* ── client ── */
  const clientSel = h('select', { name: 'client_id', 'aria-label': 'Client' },
    h('option', { value: '' }, 'Choose a client…'),
    clients.map((c) => h('option', { value: c.id, selected: c.id === doc.client_id ? 'selected' : null }, c.name)));
  const billTA = textarea('billing_address', doc.client_snapshot?.billing_address || '', { rows: 3 });
  const shipTA = textarea('shipping_address', doc.client_snapshot?.shipping_address || '', { rows: 3 });
  const addrWrap = h('div', { class: 'grid-2' }, field('Billing address (on this document)', billTA), field('Shipping address (on this document)', shipTA));
  clientSel.addEventListener('change', () => {
    const c = clients.find((x) => x.id === clientSel.value);
    doc.client_id = clientSel.value;
    doc.client_snapshot = c ? { name: c.name, email: c.email, phone: c.phone, billing_address: c.billing_address, shipping_address: c.shipping_address || c.billing_address, contact_person: c.contact_person, vat_number: c.vat_number } : {};
    billTA.value = doc.client_snapshot.billing_address || ''; shipTA.value = doc.client_snapshot.shipping_address || '';
    markDirty();
  });
  [billTA, shipTA].forEach((t) => t.addEventListener('input', () => {
    doc.client_snapshot = { ...doc.client_snapshot, billing_address: billTA.value, shipping_address: shipTA.value }; dirty = true;
  }));
  const newClientBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('plus', 16), 'New client');
  newClientBtn.addEventListener('click', async () => {
    const created = await clientForm(ctx, null, { asModal: true });
    if (created) {
      clients.push(created);
      clientSel.appendChild(h('option', { value: created.id }, created.name));
      clientSel.value = created.id; clientSel.dispatchEvent(new Event('change'));
    }
  });

  /* ── details ── */
  const bind = (input, key, transform = (v) => v) => { input.addEventListener('input', () => { doc[key] = transform(input.value); markDirty(); }); return input; };
  const titleIn = bind(textInput('title', doc.title, { maxlength: 60 }), 'title');
  const issueIn = bind(h('input', { type: 'date', value: doc.issue_date, required: true }), 'issue_date');
  const dueIn = bind(h('input', { type: 'date', value: doc.due_date || '' }), 'due_date');
  const refIn = bind(textInput('reference', doc.reference, { maxlength: 80, placeholder: 'PO number, project…' }), 'reference');

  /* ── lines ── */
  const linesHost = h('div', { class: 'lines' });
  function renderLines() {
    clear(linesHost);
    doc.lines.forEach((l, i) => linesHost.appendChild(lineCard(l, i)));
    if (!doc.lines.length) linesHost.appendChild(h('p', { class: 'muted' }, 'No items yet.'));
  }
  function lineCard(l, i) {
    const amount = h('strong', { class: 'num line-amount' });
    const name = textInput('name', l.name, { placeholder: 'Item', 'aria-label': 'Item name', maxlength: 300 });
    const desc = textarea('description', l.description, { rows: 2, placeholder: 'Description (optional)', 'aria-label': 'Description', maxlength: 2000 });
    const qty = h('input', { type: 'text', inputmode: 'decimal', value: String(l.qty ?? 1), class: 'num', 'aria-label': 'Quantity' });
    const rate = moneyInput('rate', l.unit_price_cents, { 'aria-label': 'Rate' });
    const taxable = h('input', { type: 'checkbox', checked: l.taxable !== false, 'aria-label': 'Taxable' });
    const cat = select('category', [['', 'Category…'], ...categories.map((x) => [x.id, x.label])], l.category || '', { 'aria-label': 'Category' });
    cat.classList.toggle('needs-value', !cat.value);
    cat.addEventListener('change', () => { l.category = cat.value || null; cat.classList.toggle('needs-value', !cat.value); dirty = true; });
    const upd = () => {
      l.name = name.value; l.description = desc.value;
      const q = Number(String(qty.value).replace(',', '.'));
      l.qty = Number.isFinite(q) ? q : 0;
      const r = toCents(rate.value); l.unit_price_cents = r ?? 0;
      qty.classList.toggle('invalid', !Number.isFinite(q)); rate.classList.toggle('invalid', r === null && rate.value !== '');
      l.taxable = taxable.checked;
      markDirty();
    };
    [name, desc, qty, rate].forEach((x) => x.addEventListener('input', upd));
    taxable.addEventListener('change', upd);
    rate.addEventListener('blur', () => { if (toCents(rate.value) !== null) rate.value = centsToInput(toCents(rate.value)); });
    const move = (dir) => { const j = i + dir; if (j < 0 || j >= doc.lines.length) return; [doc.lines[i], doc.lines[j]] = [doc.lines[j], doc.lines[i]]; renderLines(); markDirty(); };
    const card = h('div', { class: 'line-card' },
      h('div', { class: 'line-top' }, h('span', { class: 'line-no' }, String(i + 1)), name,
        h('div', { class: 'line-tools' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', onclick: () => move(-1) }, icon('up', 16)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move down', onclick: () => move(1) }, icon('down', 16)),
          h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Remove item', onclick: () => { doc.lines.splice(i, 1); renderLines(); markDirty(); } }, icon('trash', 16)))),
      desc,
      h('div', { class: 'line-nums' },
        field('Qty', qty), field('Rate', rate), field('Category', cat),
        doc.tax_mode !== 'none' ? h('label', { class: 'check' }, taxable, h('span', {}, 'VAT')) : null,
        h('div', { class: 'line-total' }, h('span', { class: 'muted' }, 'Amount'), amount)),
      ctx.owner ? costRow(l) : null);
    card._amount = amount;
    return card;
  }
  function costRow(l) {
    l.cost = l.cost || null;
    const out = h('span', { class: 'muted' });
    const show = () => {
      if (!l.cost) { out.textContent = 'No internal cost set'; return; }
      const rev = Math.round((Number(l.qty) || 0) * l.unit_price_cents);
      const cost = Math.round((Number(l.qty) || 0) * l.cost.unit_cost_cents);
      out.textContent = `Cost ${money(l.cost.unit_cost_cents)} each · margin ${marginPercent(rev, cost)}%`;
    };
    show();
    const btn = h('button', { type: 'button', class: 'btn btn-small btn-internal' }, l.cost ? 'Edit costing' : 'Add costing');
    btn.addEventListener('click', async () => {
      const res = await costingDialog(ctx, materials, l);
      if (res) { l.cost = res.cost; if (res.applyPrice) l.unit_price_cents = res.price; renderLines(); markDirty(); }
    });
    return h('div', { class: 'internal-row' }, h('span', { class: 'internal-tag' }, icon('lock', 14), 'Internal'), out, btn);
  }

  const addSaved = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('items', 16), 'Add saved item');
  addSaved.addEventListener('click', async () => {
    const svc = await pickService(services);
    if (svc) {
      doc.lines.push({ name: svc.name, description: svc.description, qty: 1, unit_price_cents: svc.unit_price_cents,
        taxable: svc.taxable, service_id: svc.id, category: svc.category || null, cost: svc.costing ? { unit_cost_cents: svc.costing.unit_cost_cents, breakdown: { source: 'service' } } : null });
      renderLines(); markDirty();
    }
  });
  const addBlank = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { doc.lines.push(blankLine(s)); renderLines(); markDirty(); linesHost.lastChild?.querySelector('input')?.focus(); } }, icon('plus', 16), 'Add blank line');

  /* ── figures ── */
  const discType = select('discount_type', [['none', 'No discount'], ['percent', 'Percent %'], ['amount', 'Fixed amount']], doc.discount_type);
  const discVal = h('input', { type: 'text', inputmode: 'decimal', class: 'num', 'aria-label': 'Discount value',
    value: doc.discount_type === 'percent' ? String(doc.discount_percent) : centsToInput(doc.discount_amount_cents) });
  const shipIn = moneyInput('shipping', doc.shipping_cents, { 'aria-label': 'Shipping' });
  const taxMode = select('tax_mode', [['exclusive', 'Add VAT to prices'], ['inclusive', 'Prices include VAT'], ['none', 'No VAT']], doc.tax_mode);
  const vatIn = h('input', { type: 'text', inputmode: 'decimal', class: 'num', value: String(doc.vat_rate), 'aria-label': 'VAT rate' });
  const shipTax = h('input', { type: 'checkbox', checked: doc.shipping_taxable !== false });
  const depType = select('deposit_type', [['none', 'No deposit'], ['percent', 'Percent %'], ['amount', 'Fixed amount']], doc.deposit_type);
  const depVal = h('input', { type: 'text', inputmode: 'decimal', class: 'num', 'aria-label': 'Deposit value',
    value: doc.deposit_type === 'percent' ? String(doc.deposit_percent) : centsToInput(doc.deposit_amount_cents) });
  const readFigures = () => {
    doc.discount_type = discType.value;
    if (doc.discount_type === 'percent') doc.discount_percent = clampNum(discVal.value, 0, 100);
    if (doc.discount_type === 'amount') doc.discount_amount_cents = Math.max(0, toCents(discVal.value) ?? 0);
    doc.shipping_cents = Math.max(0, toCents(shipIn.value) ?? 0);
    doc.tax_mode = taxMode.value;
    doc.vat_rate = clampNum(vatIn.value, 0, 100);
    doc.shipping_taxable = shipTax.checked;
    doc.deposit_type = depType.value;
    if (doc.deposit_type === 'percent') doc.deposit_percent = clampNum(depVal.value, 0, 100);
    if (doc.deposit_type === 'amount') doc.deposit_amount_cents = Math.max(0, toCents(depVal.value) ?? 0);
    discVal.disabled = doc.discount_type === 'none'; depVal.disabled = doc.deposit_type === 'none';
    vatIn.disabled = doc.tax_mode === 'none'; shipTax.disabled = doc.tax_mode === 'none';
  };
  discType.addEventListener('change', () => { discVal.value = discType.value === 'percent' ? String(doc.discount_percent || 0) : centsToInput(doc.discount_amount_cents); readFigures(); markDirty(); });
  depType.addEventListener('change', () => { depVal.value = depType.value === 'percent' ? String(doc.deposit_percent || 0) : centsToInput(doc.deposit_amount_cents); readFigures(); markDirty(); });
  taxMode.addEventListener('change', () => { readFigures(); renderLines(); markDirty(); });
  [discVal, shipIn, vatIn, depVal].forEach((x) => x.addEventListener('input', () => { readFigures(); markDirty(); }));
  shipTax.addEventListener('change', () => { readFigures(); markDirty(); });
  readFigures();

  const totalsBox = h('dl', { class: 'totals' });
  const internalBox = h('div', { class: 'internal-summary' });
  const notesIn = bind(textarea('notes', doc.notes, { rows: 3, placeholder: 'Printed on the document' }), 'notes');
  const termsIn = bind(textarea('terms', doc.terms, { rows: 3, placeholder: 'Payment terms, lead time, validity…' }), 'terms');
  const intIn = bind(textarea('internal_notes', doc.internal_notes, { rows: 2, placeholder: 'Never printed' }), 'internal_notes');

  function refresh() {
    const t = computeTotals(doc);
    linesHost.querySelectorAll('.line-card').forEach((card, i) => { if (card._amount && t.lines[i]) card._amount.textContent = money(t.lines[i].line_total_cents); });
    clear(totalsBox);
    const row = (k, v, cls) => [h('dt', { class: cls }, k), h('dd', { class: `num ${cls || ''}` }, v)];
    totalsBox.append(...row('Subtotal', money(t.subtotal_cents)));
    if (t.discount_cents) totalsBox.append(...row(`Discount (${(doc.discount_type === 'percent' ? Number(doc.discount_percent) : discountPercentOf(t.discount_cents, t.subtotal_cents)).toFixed(2)}%)`, `-${money(t.discount_cents)}`));
    if (doc.shipping_cents) totalsBox.append(...row('Shipping', money(doc.shipping_cents)));
    if (doc.tax_mode === 'exclusive') totalsBox.append(...row(`VAT ${Number(doc.vat_rate)}%`, money(t.vat_cents)));
    totalsBox.append(...row('Total', money(t.total_cents), 'grand'));
    if (doc.tax_mode === 'inclusive') totalsBox.append(...row(`Includes VAT ${Number(doc.vat_rate)}%`, money(t.vat_cents)));
    if (t.deposit_cents) totalsBox.append(...row('Deposit required', money(t.deposit_cents)));
    if (ctx.owner) {
      const cost = doc.lines.reduce((sum, l, i) => sum + (l.cost ? Math.round((Number(l.qty) || 0) * l.cost.unit_cost_cents) : 0), 0);
      const net = t.total_cents - t.vat_cents;
      const missing = doc.lines.filter((l) => !l.cost).length;
      clear(internalBox).append(
        h('div', { class: 'internal-tag' }, icon('lock', 14), 'Internal costing · owner only · never printed'),
        h('div', { class: 'kpis' },
          kpi('Revenue (excl. VAT)', money(net)), kpi('Cost', money(cost)), kpi('Profit', money(net - cost)), kpi('Margin', `${marginPercent(net, cost)}%`)),
        missing ? h('p', { class: 'muted' }, `${missing} item(s) have no cost set, so profit is overstated.`) : null);
    }
  }

  /* ── actions ── */
  const saveBtn = h('button', { type: 'button', class: 'btn' }, 'Save draft');
  const previewBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('download', 16), 'Preview PDF');
  const issueBtn = h('button', { type: 'button', class: 'btn btn-primary' }, kind === 'quote' ? 'Save & send quote' : 'Save & issue invoice');
  const payload = () => ({
    id: doc.id, kind, title: doc.title, client_id: doc.client_id || null, client_snapshot: doc.client_id ? {
      billing_address: billTA.value, shipping_address: shipTA.value } : undefined,
    issue_date: doc.issue_date, due_date: doc.due_date || null, reference: doc.reference, notes: doc.notes, terms: doc.terms,
    internal_notes: doc.internal_notes, discount_type: doc.discount_type, discount_percent: doc.discount_percent,
    discount_amount_cents: doc.discount_amount_cents, shipping_cents: doc.shipping_cents, tax_mode: doc.tax_mode,
    vat_rate: doc.vat_rate, shipping_taxable: doc.shipping_taxable, deposit_type: doc.deposit_type,
    deposit_percent: doc.deposit_percent, deposit_amount_cents: doc.deposit_amount_cents,
    lines: doc.lines.filter((l) => l.name || l.description || l.unit_price_cents).map((l) => ({
      id: l.id, service_id: l.service_id || null, name: l.name, description: l.description, qty: l.qty,
      unit_price_cents: l.unit_price_cents, taxable: l.taxable !== false, category: l.category || null, ...(ctx.owner && l.cost ? { cost: l.cost } : {}),
    })),
  });
  const validate = (forIssue) => {
    if (doc.lines.some((l) => !Number.isFinite(Number(l.qty)))) throw new Error('Fix the highlighted quantities first.');
    if (!doc.issue_date) throw new Error('Choose a date.');
    if (forIssue && !doc.client_id) throw new Error('Choose a client first.');
    if (forIssue && !payload().lines.length) throw new Error('Add at least one item.');
  };
  async function save() {
    validate(false);
    const saved = await ctx.api.rpc('save_document', payload());
    dirty = false;
    return saved;
  }
  saveBtn.addEventListener('click', busy(saveBtn, async () => {
    const saved = await save();
    toast(`${LABEL[kind]} saved${saved.number ? ` as ${saved.number}` : ''}`);
    if (!doc.id) ctx.navigate(`/${PLURAL[kind]}/${saved.id}`); else Object.assign(doc, { number: saved.number });
  }));
  previewBtn.addEventListener('click', busy(previewBtn, async () => {
    const t = computeTotals(doc);
    const model = buildPdfModel({ ...doc, ...t, lines: t.lines, company_snapshot: null, locked: false, status: 'draft' }, ctx.settings);
    await openPdf(await renderPdf(model, await brandingAssets(ctx)), model.filename);
  }));
  issueBtn.addEventListener('click', busy(issueBtn, async () => {
    validate(true);
    const t = computeTotals(doc);
    const ok = await confirmDialog(kind === 'quote' ? 'Send quote?' : 'Issue invoice?',
      `${kind === 'invoice' ? 'The invoice gets its number now and ' : 'The quote '}is locked once issued (total ${money(t.total_cents)}). ${kind === 'quote' ? 'You can still revise it later; the earlier version is kept.' : 'To change it later you void it and issue a corrected copy.'}`,
      kind === 'quote' ? 'Send' : 'Issue');
    if (!ok) return;
    const saved = await save();
    const issued = await ctx.api.rpc('issue_document', { id: saved.id });
    await storePdf(ctx, issued).catch((e) => toast(`Issued, but the PDF could not be stored yet: ${e.message}`, 'error'));
    toast(`${LABEL[kind]} ${issued.number} ${kind === 'quote' ? 'sent' : 'issued'}`);
    ctx.navigate(`/${PLURAL[kind]}/${issued.id}`);
  }));

  const extra = [];
  if (doc.id && doc.number) {
    const voidBtn = h('button', { type: 'button', class: 'btn btn-ghost danger' }, 'Void');
    voidBtn.addEventListener('click', busy(voidBtn, async () => {
      const reason = await promptDialog(`Void ${doc.number}?`, 'Reason (kept in the history)', { minLength: 3, okLabel: 'Void', danger: true });
      if (!reason) return;
      await ctx.api.rpc('void_document', { id: doc.id, reason });
      toast(`${doc.number} voided`); ctx.navigate(`/${PLURAL[kind]}`);
    }));
    extra.push(voidBtn);
  } else if (doc.id) {
    const delBtn = h('button', { type: 'button', class: 'btn btn-ghost danger' }, icon('trash', 16), 'Delete draft');
    delBtn.addEventListener('click', busy(delBtn, async () => {
      if (!(await confirmDialog('Delete draft?', 'This draft has no number yet, so it can be deleted completely.', 'Delete', true))) return;
      await ctx.api.rpc('delete_draft', { id: doc.id }); toast('Draft deleted'); ctx.navigate(`/${PLURAL[kind]}`);
    }));
    extra.push(delBtn);
  }

  window.onbeforeunload = () => (dirty ? 'You have unsaved changes' : undefined);
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });

  renderLines(); refresh();
  const heading = existing
    ? `${existing.number || `Draft ${LABEL[kind].toLowerCase()}`}${existing.revision > 1 ? ` · revision ${existing.revision}` : ''}`
    : `New ${LABEL[kind].toLowerCase()}`;
  return h('div', { class: 'editor' },
    h('a', { class: 'back', href: `#/${PLURAL[kind]}` }, icon('back', 16), kind === 'quote' ? 'Quotes' : 'Invoices'),
    setTitle(heading, statusBadge(existing || { status: 'draft' })),
    h('section', { class: 'panel' }, h('h2', {}, 'Client'),
      h('div', { class: 'row-gap' }, clientSel, newClientBtn), addrWrap),
    h('section', { class: 'panel' }, h('h2', {}, 'Details'),
      h('div', { class: 'grid-4' },
        field('Title', titleIn),
        field(`${LABEL[kind]} no`, h('input', { type: 'text', readonly: true, value: doc.number || (kind === 'invoice' ? 'Assigned when issued' : 'Assigned when saved') })),
        field(`${LABEL[kind]} date`, issueIn),
        field(kind === 'quote' ? 'Valid until' : 'Due date', dueIn)),
      field('Reference', refIn)),
    h('section', { class: 'panel' }, h('h2', {}, 'Items'), linesHost, h('div', { class: 'row-gap' }, addSaved, addBlank)),
    h('section', { class: 'panel' }, h('h2', {}, 'Figures'),
      h('div', { class: 'grid-figures' },
        h('div', { class: 'stack' },
          h('div', { class: 'pair' }, field('Discount', discType), field('Value', discVal)),
          field('Shipping', shipIn),
          h('div', { class: 'pair' }, field('VAT', taxMode), field('Rate %', vatIn)),
          h('label', { class: 'check' }, shipTax, h('span', {}, 'Charge VAT on shipping')),
          h('div', { class: 'pair' }, field('Deposit', depType), field('Value', depVal))),
        totalsBox),
      ctx.owner ? internalBox : null),
    h('section', { class: 'panel' }, h('h2', {}, 'Notes & terms'), h('div', { class: 'grid-2' }, field('Notes', notesIn), field('Terms', termsIn)),
      field('Internal notes (not printed)', intIn)),
    h('div', { class: 'action-bar' }, extra, h('span', { class: 'spacer' }), previewBtn, saveBtn, issueBtn));
}

const clampNum = (v, min, max) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const blankLine = (s) => ({ name: '', description: '', qty: 1, unit_price_cents: 0, taxable: s.tax_mode !== 'none', category: null, cost: null });
const kpi = (label, value) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', { class: 'num' }, value));

async function pickService(services) {
  const list = h('div', { class: 'pick-list' });
  const search = h('input', { type: 'search', placeholder: 'Search saved items', 'aria-label': 'Search saved items' });
  let chosen = null;
  const draw = () => {
    clear(list);
    const q = search.value.toLowerCase();
    const rows = services.filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    if (!rows.length) list.appendChild(h('p', { class: 'muted' }, 'No saved items. Add them under Items.'));
    rows.forEach((s) => list.appendChild(h('button', { type: 'button', class: 'pick', onclick: () => { chosen = s; document.querySelector('.modal-overlay .modal-actions .btn-primary')?.click(); } },
      h('span', {}, h('strong', {}, s.name), h('small', { class: 'muted' }, s.description)), h('span', { class: 'num' }, money(s.unit_price_cents)))));
  };
  search.addEventListener('input', draw); draw();
  await modal('Add saved item', h('div', { class: 'stack' }, search, list), [{ label: 'Cancel', value: null }, { label: 'Add', class: 'btn-primary hidden-btn', value: true }]);
  return chosen;
}

export async function costingDialog(ctx, materials, l) {
  const k = ctx.settings.costing || {};
  const b = (l.cost && l.cost.breakdown) || {};
  const matSel = select('material_id', [['', 'No material'], ...materials.map((m) => [m.id, `${m.name} (${money(m.cost_per_kg_cents)}/kg)`])], b.material_id || '');
  const num = (name, v, label) => field(label, h('input', { type: 'text', inputmode: 'decimal', class: 'num', name, value: v ?? 0 }));
  const grams = num('material_grams', b.material_grams, 'Material (grams per unit)');
  const ph = num('print_hours', b.print_hours, 'Print hours per unit');
  const lh = num('labour_hours', b.labour_hours, 'Labour hours (post-processing, assembly)');
  const dh = num('design_hours', b.design_hours, 'Design / CAD hours');
  const other = field('Other cost per unit (hardware, paint…)', moneyInput('other', b.other_cost_cents || 0));
  const manual = field('Unit cost', moneyInput('manual', l.cost?.unit_cost_cents || 0));
  const markup = field('Markup %', h('input', { type: 'text', inputmode: 'decimal', class: 'num', value: String(k.default_markup_percent ?? 60) }));
  const out = h('div', { class: 'kpis' });
  const valOf = (wrap) => wrap.querySelector('input,select').value;
  let result = null;
  const calc = (useManual) => {
    const m = materials.find((x) => x.id === matSel.value);
    const breakdown = { material_id: matSel.value || null, material_grams: Number(valOf(grams)) || 0, print_hours: Number(valOf(ph)) || 0,
      labour_hours: Number(valOf(lh)) || 0, design_hours: Number(valOf(dh)) || 0, other_cost_cents: toCents(valOf(other)) || 0 };
    const computed = unitCost(breakdown, k, m ? m.cost_per_kg_cents : 0);
    const unit = useManual ? (toCents(valOf(manual)) || 0) : computed;
    const price = suggestedPrice(unit, Number(valOf(markup)) || 0);
    clear(out).append(kpi('Unit cost', money(unit)), kpi('Suggested price', money(price)), kpi('Margin at current price', `${marginPercent(l.unit_price_cents, unit)}%`));
    result = { cost: { unit_cost_cents: unit, breakdown: useManual ? { source: 'manual' } : breakdown }, price };
  };
  const mode = select('mode', [['recipe', 'Calculate from recipe'], ['manual', 'Enter unit cost directly']],
    l.cost && l.cost.breakdown && l.cost.breakdown.source === 'manual' ? 'manual' : 'recipe');
  const recipe = h('div', { class: 'stack' }, field('Material', matSel), h('div', { class: 'grid-2' }, grams, ph, lh, dh), other);
  const sync = () => { const m = mode.value === 'manual'; recipe.hidden = m; manual.hidden = !m; calc(m); };
  const body = h('div', { class: 'stack' },
    h('p', { class: 'muted' }, `Rates from Settings → Costing: machine ${money(k.machine_rate_cents)}/h, power ${money(k.electricity_rate_cents)}/h, labour ${money(k.labour_rate_cents)}/h, design ${money(k.design_rate_cents)}/h, failures +${k.failure_allowance_percent}%, overhead +${k.overhead_percent}%.`),
    field('Method', mode), recipe, manual, markup, out);
  body.addEventListener('input', sync);
  body.addEventListener('change', sync);
  sync();
  const choice = await modal('Internal costing', body, [
    { label: 'Cancel', value: null },
    { label: 'Use suggested price', value: 'price' },
    { label: 'Save cost', class: 'btn-primary', value: 'cost' },
  ]);
  if (!choice) return null;
  return { cost: result.cost, applyPrice: choice === 'price', price: result.price };
}

/* ════════════════════════════ viewer ════════════════════════════ */
async function renderViewer(ctx, doc) {
  const kind = doc.kind;
  const actions = h('div', { class: 'row-gap wrap' });
  const add = (label, fn, cls = 'btn') => { const b = h('button', { type: 'button', class: cls }, label); b.addEventListener('click', busy(b, fn)); actions.appendChild(b); return b; };
  const reload = () => ctx.navigate(`/${PLURAL[kind]}/${doc.id}?t=${Date.now()}`);
  const go = (d) => ctx.navigate(`/${PLURAL[d.kind]}/${d.id}`);

  add(h('span', {}, icon('download', 16), ' PDF'), async () => openPdf(await getPdf(ctx, doc), buildPdfModel(doc, ctx.settings).filename), 'btn btn-primary');
  if (doc.status !== 'void') {
    add(h('span', {}, icon('mail', 16), ' Email'), async () => shareEmail(ctx, doc));
    add(h('span', {}, icon('chat', 16), ' WhatsApp'), async () => shareWhatsApp(ctx, doc));
  }
  if (kind === 'quote') {
    if (doc.status === 'sent') {
      add('Mark accepted', async () => { await ctx.api.rpc('set_quote_status', { id: doc.id, status: 'accepted' }); toast('Marked accepted'); reload(); });
      add(doc.expired ? 'Mark lost' : 'Mark declined', async () => {
        const reason = select('lost_reason', [['', 'Choose a reason…'], ...LOST_REASONS], doc.expired ? 'no_response' : '');
        const note = textInput('lost_note', '', { maxlength: 300, placeholder: 'Optional: what did they say?' });
        const err = h('p', { class: 'field-error' });
        const ok = await modal('Why was this quote lost?', h('div', { class: 'stack' },
          h('p', { class: 'muted' }, 'This is the most useful thing to record for pricing and spotting new services.'),
          field('Reason', reason), field('Note', note), err), [
          { label: 'Cancel', value: false },
          { label: 'Mark lost', class: 'btn-primary', onClick: async () => {
            if (!reason.value) { err.textContent = 'Choose a reason.'; return false; }
            try { await ctx.api.rpc('set_quote_status', { id: doc.id, status: 'declined', lost_reason: reason.value, lost_note: note.value }); return true; }
            catch (e) { err.textContent = e.message; return false; }
          } },
        ]);
        if (ok) { toast('Quote marked as lost'); reload(); }
      });
    }
    if (['sent', 'accepted'].includes(doc.status)) {
      add('Convert to invoice', async () => {
        if (!(await confirmDialog('Convert to invoice?', 'A draft invoice is created with the same items, discount, shipping and deposit. The quote is marked as invoiced.', 'Convert'))) return;
        const inv = await ctx.api.rpc('convert_quote', { id: doc.id }); toast('Draft invoice created'); go(inv);
      }, 'btn btn-primary');
    }
    if (['sent', 'accepted', 'declined'].includes(doc.status)) {
      add('Revise', async () => {
        if (!(await confirmDialog('Revise quote?', `Revision ${doc.revision} stays on record exactly as sent. You will edit revision ${doc.revision + 1}.`, 'Revise'))) return;
        await ctx.api.rpc('revise_quote', { id: doc.id }); reload();
      });
    }
  } else if (['issued', 'partially_paid'].includes(doc.status)) {
    add('Record payment', async () => { if (await paymentDialog(ctx, doc)) reload(); }, 'btn btn-primary');
  }
  add('Duplicate', async () => { const d = await ctx.api.rpc('duplicate_document', { id: doc.id }); toast('Copy created as a draft'); go(d); });
  if (doc.status !== 'void' && !(kind === 'quote' && doc.status === 'converted')) {
    add('Void', async () => {
      const reason = await promptDialog(`Void ${doc.number}?`, 'Reason (kept in the history)', { minLength: 3, okLabel: 'Void', danger: true });
      if (!reason) return;
      await ctx.api.rpc('void_document', { id: doc.id, reason }); toast(`${doc.number} voided`); reload();
    }, 'btn btn-ghost danger');
  }

  const model = buildPdfModel(doc, ctx.settings);
  const summary = h('div', { class: 'kpis' },
    kpi('Total', money(doc.total_cents)),
    doc.deposit_cents ? kpi('Deposit', money(doc.deposit_cents)) : null,
    kind === 'invoice' ? kpi('Paid', money(doc.paid_cents)) : null,
    kind === 'invoice' ? kpi('Balance', money(doc.balance_cents)) : null,
    kind === 'quote' && doc.due_date ? kpi('Valid until', date(doc.due_date)) : kpi('Due', date(doc.due_date)));

  const links = [];
  if (doc.source_quote_id) links.push(h('a', { href: `#/quotes/${doc.source_quote_id}` }, `From quote ${doc.source_quote_number}`));
  (doc.invoice_ids || []).forEach((i) => links.push(h('a', { href: `#/invoices/${i.id}` }, `Invoice ${i.number || '(draft)'}`)));

  const sections = [
    h('a', { class: 'back', href: `#/${PLURAL[kind]}` }, icon('back', 16), kind === 'quote' ? 'Quotes' : 'Invoices'),
    setTitle(`${doc.number}${doc.revision > 1 ? ` · rev ${doc.revision}` : ''}`, statusBadge(doc)),
    h('section', { class: 'panel' },
      h('p', { class: 'lead' }, doc.client_snapshot?.name || ''),
      summary,
      doc.status === 'void' ? h('p', { class: 'field-error' }, `Void: ${doc.void_reason || ''}`) : null,
      doc.status === 'declined' ? h('p', { class: 'muted' }, `Lost: ${labelOf(LOST_REASONS, doc.lost_reason)}${doc.lost_note ? ` (${doc.lost_note})` : ''}`) : null,
      doc.imported ? h('p', { class: 'muted' }, `Imported from your previous app${doc.imported_total_cents != null && doc.imported_total_cents !== doc.total_cents ? ` (original total ${money(doc.imported_total_cents)})` : ''}.`) : null,
      links.length ? h('p', { class: 'row-gap' }, links) : null,
      actions),
    h('section', { class: 'panel paper-wrap' }, docPreview(model)),
  ];
  if (kind === 'invoice') sections.push(paymentsPanel(ctx, doc, reload));
  if (ctx.owner && doc.cost_total_cents !== undefined) {
    const net = doc.total_cents - doc.vat_cents;
    sections.push(h('section', { class: 'panel internal' },
      h('div', { class: 'internal-tag' }, icon('lock', 14), 'Internal costing · owner only · never printed'),
      h('div', { class: 'kpis' }, kpi('Revenue (excl. VAT)', money(net)), kpi('Cost', money(doc.cost_total_cents)),
        kpi('Profit', money(net - doc.cost_total_cents)), kpi('Margin', `${marginPercent(net, doc.cost_total_cents)}%`)),
      doc.internal_notes ? h('p', {}, doc.internal_notes) : null));
  } else if (doc.internal_notes) {
    sections.push(h('section', { class: 'panel' }, h('h2', {}, 'Internal notes'), h('p', {}, doc.internal_notes)));
  }
  sections.push(await historyPanel(ctx, doc));
  return h('div', { class: 'viewer' }, sections);
}

function docPreview(m) {
  return h('article', { class: 'paper', 'aria-label': `${m.title} preview` },
    m.watermark ? h('div', { class: 'watermark', 'aria-hidden': 'true' }, m.watermark) : null,
    h('div', { class: 'paper-head' },
      h('div', {}, h('img', { src: '/images/logo.png', alt: '', class: 'paper-logo' }), h('h3', {}, m.companyName), m.company.map((t) => h('div', {}, t))),
      h('div', { class: 'paper-meta' }, h('h2', {}, m.title), h('table', {}, h('tbody', {}, m.meta.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))))))),
    h('div', { class: 'paper-parties' },
      [m.billTo, m.shipTo].map((p) => h('div', {}, h('div', { class: 'paper-band' }, p.heading), p.lines.map((t) => h('div', {}, t))))),
    h('div', { class: 'table-scroll' }, h('table', { class: 'paper-items' },
      h('thead', {}, h('tr', {}, m.columns.map((c, i) => h('th', { class: i >= 2 ? 'num' : '' }, c)))),
      h('tbody', {}, m.rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i >= 2 ? 'num' : '' }, c))))))),
    h('div', { class: 'paper-foot' },
      m.paymentMethods.length ? h('div', { class: 'paper-pay' }, h('div', { class: 'paper-band' }, 'Payment methods'), m.paymentMethods.map((t) => h('div', {}, t))) : h('div'),
      h('table', { class: 'paper-totals' }, h('tbody', {}, m.totals.map(([k, v, strong]) => h('tr', { class: strong ? 'strong' : '' }, h('th', {}, k), h('td', { class: 'num' }, v)))))),
    m.notes.length ? h('div', { class: 'paper-notes' }, h('strong', {}, 'Notes'), m.notes.map((t) => h('div', {}, t))) : null,
    m.terms.length ? h('div', { class: 'paper-notes' }, h('strong', {}, 'Terms'), m.terms.map((t) => h('div', {}, t))) : null,
    m.footer ? h('p', { class: 'paper-footer' }, m.footer) : null);
}

function paymentsPanel(ctx, doc, reload) {
  const rows = (doc.payments || []).map((p) => {
    const voidBtn = !p.voided && doc.status !== 'void' ? h('button', { type: 'button', class: 'btn btn-small btn-ghost danger' }, 'Void') : null;
    voidBtn?.addEventListener('click', busy(voidBtn, async () => {
      const reason = await promptDialog('Void payment?', 'Reason (e.g. bounced, recorded twice)', { minLength: 3, okLabel: 'Void payment', danger: true });
      if (!reason) return;
      await ctx.api.rpc('void_payment', { id: p.id, reason }); toast('Payment voided'); reload();
    }));
    return h('tr', { class: p.voided ? 'voided' : '' },
      h('td', {}, date(p.paid_on)), h('td', {}, p.is_deposit ? 'Deposit' : 'Payment', p.imported ? ' (imported)' : ''),
      h('td', {}, p.method.toUpperCase(), p.reference ? ` · ${p.reference}` : ''),
      h('td', { class: 'num' }, money(p.amount_cents)), h('td', {}, p.voided ? `Void: ${p.void_reason}` : voidBtn));
  });
  return h('section', { class: 'panel' }, h('h2', {}, 'Payments'),
    doc.deposit_cents ? h('p', { class: 'muted' }, `Deposit required: ${money(doc.deposit_cents)} · ${doc.paid_cents >= doc.deposit_cents ? 'deposit received' : `${money(doc.deposit_cents - doc.paid_cents)} of the deposit outstanding`}`) : null,
    rows.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Type'), h('th', {}, 'Method'), h('th', { class: 'num' }, 'Amount'), h('th', {}, ''))),
      h('tbody', {}, rows))) : h('p', { class: 'muted' }, 'No payments recorded yet.'),
    h('p', {}, h('strong', {}, `Paid ${money(doc.paid_cents)} of ${money(doc.total_cents)} · balance ${money(doc.balance_cents)}`), doc.overdue ? h('span', { class: 'badge badge-overdue' }, 'Overdue') : null));
}

async function paymentDialog(ctx, doc) {
  const firstDeposit = !(doc.payments || []).some((p) => !p.voided) && doc.deposit_cents > 0 && doc.deposit_cents < doc.balance_cents;
  const amount = moneyInput('amount', firstDeposit ? doc.deposit_cents : doc.balance_cents);
  const paidOn = h('input', { type: 'date', value: todayISO(), max: todayISO() });
  const method = select('method', [['eft', 'EFT / bank transfer'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']], 'eft');
  const ref = textInput('reference', '', { placeholder: 'Bank reference', maxlength: 80 });
  const isDep = h('input', { type: 'checkbox', checked: firstDeposit });
  const err = h('p', { class: 'field-error' });
  const res = await modal(`Record payment · ${doc.number}`, h('div', { class: 'stack' },
    h('p', { class: 'muted' }, `Balance due ${money(doc.balance_cents)}${doc.deposit_cents ? ` · deposit ${money(doc.deposit_cents)}` : ''}`),
    field('Amount', amount), field('Date received', paidOn), field('Method', method), field('Reference', ref),
    h('label', { class: 'check' }, isDep, h('span', {}, 'This is the deposit')), err), [
    { label: 'Cancel', value: null },
    { label: 'Record payment', class: 'btn-primary', onClick: async () => {
      const cents = toCents(amount.value);
      if (!cents || cents <= 0) { err.textContent = 'Enter an amount.'; return false; }
      try {
        await ctx.api.rpc('record_payment', { invoice_id: doc.id, amount_cents: cents, paid_on: paidOn.value, method: method.value, reference: ref.value, is_deposit: isDep.checked });
        toast('Payment recorded'); return true;
      } catch (e) { err.textContent = e.message; return false; }
    } },
  ]);
  return !!res;
}

async function historyPanel(ctx, doc) {
  const items = [];
  (doc.revisions || []).forEach((r) => {
    const file = (doc.files || []).filter((f) => f.revision === r.revision).pop();
    const btn = file ? h('button', { type: 'button', class: 'btn btn-small btn-ghost' }, icon('download', 14), 'PDF') : null;
    btn?.addEventListener('click', busy(btn, async () => openPdfUrl(await ctx.api.storage.signedUrl('documents', file.storage_path, 60))));
    items.push(h('li', {}, h('span', {}, `Revision ${r.revision} issued ${new Date(r.created_at).toLocaleString('en-ZA')}`), btn));
  });
  let audit = null;
  if (ctx.owner) {
    const rows = await ctx.api.rpc('list_audit', { row_id: doc.id, limit: 50 }).catch(() => []);
    audit = h('details', {}, h('summary', {}, `Audit trail (${rows.length})`),
      h('ul', { class: 'audit' }, rows.map((a) => h('li', {}, `${new Date(a.at).toLocaleString('en-ZA')} · ${a.actor_email} · ${a.action} ${a.table_name.replace('_', ' ')}`))));
  }
  return h('section', { class: 'panel' }, h('h2', {}, 'History'), items.length ? h('ul', { class: 'history' }, items) : h('p', { class: 'muted' }, 'No issued revisions.'), audit);
}

/* ════════════════════════════ PDFs + sharing ════════════════════════════ */
export async function brandingAssets(ctx) {
  const s = ctx.settings; const out = {};
  try { if (s.logo_path) out.logoUrl = await ctx.api.storage.signedUrl('branding', s.logo_path, 120); } catch { /* fallback logo */ }
  try { if (s.signature_path) out.signatureUrl = await ctx.api.storage.signedUrl('branding', s.signature_path, 120); } catch { /* none */ }
  return out;
}

async function storePdf(ctx, doc) {
  const model = buildPdfModel(doc, ctx.settings);
  const blob = await renderPdf(model, await brandingAssets(ctx));
  const path = `${doc.kind}s/${doc.id}/${model.filename}`;
  await ctx.api.storage.upload('documents', path, blob);
  await ctx.api.rpc('attach_file', { document_id: doc.id, storage_path: path });
  return { blob, path };
}

/** Stored PDF for the current revision; generated + stored on first use. */
async function getPdf(ctx, doc) {
  const file = (doc.files || []).filter((f) => f.revision === doc.revision).pop();
  if (file) {
    try { return await ctx.api.storage.download('documents', file.storage_path); } catch { /* regenerate below */ }
  }
  if (doc.status === 'void') return renderPdf(buildPdfModel(doc, ctx.settings), await brandingAssets(ctx));
  return (await storePdf(ctx, doc)).blob;
}

async function shareLink(ctx, doc) {
  await getPdf(ctx, doc);
  const fresh = await ctx.api.rpc('get_document', { id: doc.id });
  const file = (fresh.files || []).filter((f) => f.revision === fresh.revision).pop();
  if (!file) throw new Error('PDF is not stored yet');
  return ctx.api.storage.signedUrl('documents', file.storage_path, 7 * 24 * 3600);
}

function fill(template, ctx, doc, link) {
  const s = ctx.settings;
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => ({
    type: LABEL[doc.kind], number: doc.number, company: s.name, client: doc.client_snapshot?.name || '',
    total: money(doc.total_cents), balance: money(doc.balance_cents), due_date: date(doc.due_date), link,
  }[k] ?? `{${k}}`));
}

async function shareEmail(ctx, doc) {
  const s = ctx.settings;
  const link = await shareLink(ctx, doc);
  const defaultBody = `Hi {client},\n\nPlease find your ${LABEL[doc.kind].toLowerCase()} {number} for {total} here:\n{link}\n(The link expires in 7 days.)\n\n${doc.kind === 'invoice' ? `Bank: ${s.bank_name}\nAccount: ${s.bank_account}\nReference: {number}\n\n` : ''}Kind regards,\n${s.name}`;
  const body = fill(s.email_body || defaultBody, ctx, doc, link);
  const finalBody = body.includes(link) ? body : `${body}\n\n${LABEL[doc.kind]} PDF (link valid 7 days): ${link}`;
  const q = new URLSearchParams();
  if (s.email_cc) q.set('cc', s.email_cc);
  if (s.email_bcc) q.set('bcc', s.email_bcc);
  q.set('subject', fill(s.email_subject, ctx, doc, link));
  q.set('body', finalBody);
  window.location.href = `mailto:${encodeURIComponent(doc.client_snapshot?.email || '')}?${q.toString().replace(/\+/g, '%20')}`;
}

async function shareWhatsApp(ctx, doc) {
  const link = await shareLink(ctx, doc);
  let phone = String(doc.client_snapshot?.phone || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = `27${phone.slice(1)}`;
  const text = `Hi ${doc.client_snapshot?.name || ''}, here is your ${LABEL[doc.kind].toLowerCase()} ${doc.number} for ${money(doc.total_cents)} from ${ctx.settings.name}: ${link} (link valid 7 days)`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

async function openPdf(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function openPdfUrl(url) { window.open(url, '_blank', 'noopener'); }
