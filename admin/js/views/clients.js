// Clients (contacts): list, detail with their documents, create/edit form.
import { h, clear, icon, toast, money, date, field, textInput, textarea, modal, busy, emptyState, statusBadge, formValues, setTitle, select } from '../ui.js';
import { CLIENT_TYPES, LEAD_SOURCES, withBlank, labelOf } from '../lists.js';

export async function renderClients(ctx) {
  const host = h('div', { class: 'card-list' });
  const search = h('input', { type: 'search', placeholder: 'Search clients', 'aria-label': 'Search clients' });
  const showArchived = h('input', { type: 'checkbox' });
  async function load() {
    const rows = await ctx.api.rpc('list_clients', { q: search.value.trim(), include_archived: showArchived.checked });
    clear(host);
    if (!rows.length) { host.appendChild(emptyState('No clients found', search.value ? 'Try another search.' : 'Add your first client, or import contacts from Settings → Import & export.')); return; }
    rows.forEach((c) => host.appendChild(h('a', { class: 'doc-row', href: `#/clients/${c.id}` },
      h('div', { class: 'doc-row-main' }, h('strong', {}, c.name, c.archived ? ' (archived)' : ''),
        h('span', { class: 'muted' }, [c.client_type ? labelOf(CLIENT_TYPES, c.client_type) : null, c.contact_person, c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details')),
      h('div', { class: 'doc-row-side' }, c.open_balance_cents ? h('strong', { class: 'num' }, `${money(c.open_balance_cents)} owing`) : null))));
  }
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  showArchived.addEventListener('change', load);
  await load();
  const add = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus', 18), 'New client');
  add.addEventListener('click', async () => { const c = await clientForm(ctx, null, { asModal: true }); if (c) ctx.navigate(`/clients/${c.id}`); });
  return h('div', {}, setTitle('Clients', add),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), h('label', { class: 'check' }, showArchived, h('span', {}, 'Show archived'))),
    host);
}

export async function renderClient(ctx, id) {
  const all = await ctx.api.rpc('list_clients', { include_archived: true });
  const c = all.find((x) => x.id === id);
  if (!c) throw new Error('Client not found');
  const [quotes, invoices] = await Promise.all([
    ctx.api.rpc('list_documents', { kind: 'quote', client_id: id, limit: 100 }),
    ctx.api.rpc('list_documents', { kind: 'invoice', client_id: id, limit: 100 }),
  ]);
  const docRows = (rows, path) => rows.length ? rows.map((d) => h('a', { class: 'doc-row', href: `#/${path}/${d.id}` },
    h('div', { class: 'doc-row-main' }, h('strong', {}, d.number || 'Draft'), h('span', { class: 'muted' }, date(d.issue_date))),
    h('div', { class: 'doc-row-side' }, h('strong', { class: 'num' }, money(d.total_cents)), statusBadge(d)))) : [h('p', { class: 'muted' }, 'None yet.')];
  const form = await clientForm(ctx, c, { asModal: false, onSaved: () => toast('Client saved') });
  const newQuote = h('a', { class: 'btn', href: '#/quotes/new' }, 'New quote');
  newQuote.addEventListener('click', () => sessionStorage.setItem('admin.newDocClient', id));
  return h('div', {},
    h('a', { class: 'back', href: '#/clients' }, icon('back', 16), 'Clients'),
    setTitle(c.name, c.open_balance_cents ? h('span', { class: 'badge badge-issued' }, `${money(c.open_balance_cents)} owing`) : null),
    h('div', { class: 'grid-main-side' },
      h('div', { class: 'stack' }, h('section', { class: 'panel' }, h('h2', {}, 'Details'), form), privacyPanel(ctx, c)),
      h('div', { class: 'stack' },
        h('section', { class: 'panel' }, h('h2', {}, 'Quotes'), h('div', { class: 'card-list compact' }, docRows(quotes, 'quotes'))),
        h('section', { class: 'panel' }, h('h2', {}, 'Invoices'), h('div', { class: 'card-list compact' }, docRows(invoices, 'invoices'))))));
}

/** POPIA: marketing opt-out (anyone), access export + erasure (owner). */
function privacyPanel(ctx, c) {
  const opt = h('input', { type: 'checkbox', checked: !!c.marketing_opt_out });
  opt.addEventListener('change', async () => {
    try {
      await ctx.api.rpc('set_marketing_opt_out', { id: c.id, opt_out: opt.checked });
      toast(opt.checked ? 'Marked: do not send marketing' : 'Marketing allowed again');
    } catch (e) { opt.checked = !opt.checked; toast(e.message, 'error'); }
  });
  const items = [
    h('label', { class: 'check' }, opt, h('span', {}, 'Do not send this client marketing (they opted out)')),
    c.marketing_opt_out_at ? h('p', { class: 'muted small' }, `Opted out on ${new Date(c.marketing_opt_out_at).toLocaleDateString('en-ZA')}`) : null,
  ];
  if (ctx.owner) {
    const exp = h('button', { type: 'button', class: 'btn btn-small' }, 'Export their data');
    exp.addEventListener('click', busy(exp, async () => {
      const data = await ctx.api.rpc('person_export', { client_id: c.id });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `personal-information-${c.name.replace(/[^A-Za-z0-9]+/g, '-')}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      toast('Export downloaded. Send it to the person only after confirming who they are.');
    }));
    const erase = h('button', { type: 'button', class: 'btn btn-small btn-ghost danger' }, 'Erase personal data');
    erase.addEventListener('click', busy(erase, async () => {
      const reason = textInput('reason', '', { placeholder: 'e.g. Deletion request by email, 7 Nov 2026', maxlength: 200 });
      const err = h('p', { class: 'field-error' });
      const ok = await modal(`Erase ${c.name}?`, h('div', { class: 'stack' },
        h('p', {}, 'This permanently deletes the client, their enquiries and any unnumbered drafts, and blanks their details in the audit history.'),
        h('p', { class: 'muted' }, 'If they have quotes or invoices, the law requires those records to be kept for 7 years, so erasure will be refused. Turn on the marketing opt-out instead.'),
        field('Reason (kept as a note)', reason), err), [
        { label: 'Cancel', value: false },
        { label: 'Erase permanently', class: 'btn-danger', onClick: async () => {
          try { await ctx.api.rpc('erase_client', { id: c.id, reason: reason.value }); return true; }
          catch (e) { err.textContent = e.message; return false; }
        } }]);
      if (ok) { toast('Personal data erased'); ctx.navigate('/clients'); }
    }));
    items.push(h('div', { class: 'row-gap wrap' }, exp, erase),
      h('p', { class: 'muted small' }, 'Use these for POPIA requests (see Settings → Privacy & retention).'));
  }
  return h('section', { class: 'panel' }, h('h2', {}, 'Privacy'), items);
}

/** Client form. asModal: opens a dialog and resolves with the saved client (or null). */
export async function clientForm(ctx, client, { asModal = false, onSaved } = {}) {
  const c = client || {};
  const same = h('input', { type: 'checkbox', checked: !client || !c.shipping_address || c.shipping_address === c.billing_address });
  const ship = textarea('shipping_address', c.shipping_address || '', { rows: 3 });
  const bill = textarea('billing_address', c.billing_address || '', { rows: 3 });
  const syncShip = () => { ship.disabled = same.checked; if (same.checked) ship.value = bill.value; };
  bill.addEventListener('input', syncShip); same.addEventListener('change', syncShip); syncShip();
  const err = h('p', { class: 'field-error', role: 'alert' });
  const form = h('form', { class: 'stack', novalidate: true },
    field('Name / company *', textInput('name', c.name || '', { required: true, maxlength: 200, autocomplete: 'organization' })),
    h('div', { class: 'grid-2' },
      field('Contact person', textInput('contact_person', c.contact_person || '', { maxlength: 120 })),
      field('VAT number', textInput('vat_number', c.vat_number || '', { maxlength: 40 })),
      field('Email', h('input', { type: 'email', name: 'email', value: c.email || '', maxlength: 200 })),
      field('Phone', h('input', { type: 'tel', name: 'phone', value: c.phone || '', maxlength: 40 })),
      field('Client type', select('client_type', withBlank(CLIENT_TYPES, 'Choose…'), c.client_type || ''), 'Used by Insights to see which kinds of clients bring the most work.'),
      field('How they found you', select('lead_source', withBlank(LEAD_SOURCES, 'Choose…'), c.lead_source || ''), 'Shows which marketing actually brings in work.')),
    field('Billing address', bill),
    h('label', { class: 'check' }, same, h('span', {}, 'Shipping address is the same')),
    field('Shipping address', ship),
    field('Notes (internal)', textarea('notes', c.notes || '', { rows: 2 })),
    err);
  const values = () => {
    const v = formValues(form);
    if (same.checked) v.shipping_address = v.billing_address;
    v.name = (v.name || '').trim();
    return v;
  };
  const validate = (v) => {
    if (!v.name) return 'Enter the client name.';
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return 'That email address does not look right.';
    return '';
  };
  if (asModal) {
    return modal(client ? 'Edit client' : 'New client', form, [
      { label: 'Cancel', value: null },
      { label: 'Save client', class: 'btn-primary', onClick: async () => {
        const v = values(); const problem = validate(v);
        if (problem) { err.textContent = problem; return false; }
        try { const saved = await ctx.api.rpc('save_client', { ...v, id: c.id }); toast('Client saved'); return saved; }
        catch (e) { err.textContent = e.message; return false; }
      } },
    ]);
  }
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save changes');
  const archive = h('button', { type: 'button', class: 'btn btn-ghost' }, c.archived ? 'Restore client' : 'Archive client');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(save, async () => {
      const v = values(); const problem = validate(v);
      if (problem) { err.textContent = problem; return; }
      err.textContent = '';
      await ctx.api.rpc('save_client', { ...v, id: c.id }); onSaved?.();
    })();
  });
  archive.addEventListener('click', busy(archive, async () => {
    await ctx.api.rpc('save_client', { id: c.id, archived: !c.archived });
    toast(c.archived ? 'Client restored' : 'Client archived (history is kept)'); ctx.navigate('/clients');
  }));
  form.appendChild(h('div', { class: 'row-gap' }, save, client ? archive : null));
  return form;
}
