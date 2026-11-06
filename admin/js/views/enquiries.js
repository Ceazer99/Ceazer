// Enquiries: every request for work, including the ones you don't quote.
// Website form enquiries arrive automatically (api/enquiry.js); others are
// logged here by hand. Turned-away work is the clearest sign of unmet demand.
import { h, clear, icon, toast, field, textInput, textarea, select, modal, busy, emptyState, setTitle } from '../ui.js';
import { CLIENT_TYPES, ENQUIRY_SOURCES, TURNED_AWAY_REASONS, ENQUIRY_STATUS, labelOf, withBlank } from '../lists.js';

export async function renderEnquiries(ctx) {
  const categories = await ctx.api.rpc('list_categories', {});
  const catLabel = (id) => categories.find((c) => c.id === id)?.label || 'Unclassified';
  const state = { status: 'new', q: '' };
  const host = h('div', { class: 'card-list' });
  const search = h('input', { type: 'search', placeholder: 'Search enquiries', 'aria-label': 'Search enquiries' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' },
    [['', 'All'], ...ENQUIRY_STATUS].map(([v, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(v === state.status),
      onclick: (e) => { state.status = v; chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget))); load(); } }, l)));
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value.trim(); load(); }, 250); });

  async function load() {
    const rows = await ctx.api.rpc('list_enquiries', { status: state.status, q: state.q });
    clear(host);
    if (!rows.length) {
      host.appendChild(emptyState(state.status === 'new' ? 'No new enquiries' : 'Nothing here',
        'Website form enquiries appear here automatically. Log WhatsApp, phone and walk-in requests with "Log enquiry", including work you turn away.'));
      return;
    }
    rows.forEach((e) => host.appendChild(enquiryRow(ctx, e, catLabel, load, categories)));
  }
  await load();
  const add = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus', 18), 'Log enquiry');
  add.addEventListener('click', async () => { if (await enquiryForm(ctx, categories)) load(); });
  return h('div', {}, setTitle('Enquiries', add),
    h('p', { class: 'muted' }, 'Record every request, even ones you can\'t take on. Turned-away work is the clearest sign of a possible new service.'),
    h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), search), chips), host);
}

function enquiryRow(ctx, e, catLabel, reload, categories) {
  const when = new Date(e.received_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  const actions = h('div', { class: 'row-gap wrap' });
  const act = (label, fn, cls = 'btn btn-small') => { const b = h('button', { type: 'button', class: cls }, label); b.addEventListener('click', busy(b, fn)); actions.appendChild(b); };
  if (e.status === 'new' || e.status === 'no_response') {
    act('Create quote', async () => {
      const r = await ctx.api.rpc('enquiry_to_client', { id: e.id });
      await ctx.api.rpc('save_enquiry', { id: e.id, status: 'quoted' });
      sessionStorage.setItem('admin.newDocClient', r.client_id);
      toast('Client ready - fill in the quote');
      ctx.navigate('/quotes/new');
    }, 'btn btn-small btn-primary');
    act("Can't take it", async () => {
      const reason = select('turned_away_reason', [['', 'Choose a reason…'], ...TURNED_AWAY_REASONS], '');
      const cat = select('category', [['', 'What kind of work?'], ...categories.map((c) => [c.id, c.label])], e.category || '');
      const notes = textarea('notes', e.notes || '', { rows: 2, placeholder: 'e.g. wanted metal printing, resin miniatures…' });
      const err = h('p', { class: 'field-error' });
      const ok = await modal('Turned away', h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'Recording what you turn away shows which new services people are already asking for.'),
        field('Why', reason), field('Kind of work', cat), field('What exactly did they want?', notes), err), [
        { label: 'Cancel', value: false },
        { label: 'Save', class: 'btn-primary', onClick: async () => {
          if (!reason.value) { err.textContent = 'Choose a reason.'; return false; }
          try { await ctx.api.rpc('save_enquiry', { id: e.id, status: 'turned_away', turned_away_reason: reason.value, category: cat.value, notes: notes.value }); return true; }
          catch (ex) { err.textContent = ex.message; return false; }
        } }]);
      if (ok) reload();
    });
    if (e.status === 'new') act('No response', async () => { await ctx.api.rpc('save_enquiry', { id: e.id, status: 'no_response' }); reload(); }, 'btn btn-small btn-ghost');
    act('Spam', async () => { await ctx.api.rpc('save_enquiry', { id: e.id, status: 'spam' }); reload(); }, 'btn btn-small btn-ghost danger');
  } else if (e.status !== 'new') {
    act('Reopen', async () => { await ctx.api.rpc('save_enquiry', { id: e.id, status: 'new' }); reload(); }, 'btn btn-small btn-ghost');
  }
  return h('div', { class: 'enquiry' },
    h('div', { class: 'enquiry-head' },
      h('div', {}, h('strong', {}, e.company || e.name || 'Unknown'), h('div', { class: 'muted' },
        [e.company ? e.name : null, e.email, e.phone].filter(Boolean).join(' · '))),
      h('div', { class: 'doc-row-side' }, h('span', { class: `badge badge-enq-${e.status}` }, labelOf(ENQUIRY_STATUS, e.status)),
        h('small', { class: 'muted' }, `${when} · ${labelOf(ENQUIRY_SOURCES, e.source)}`))),
    h('div', { class: 'muted' }, [catLabel(e.category), e.client_type ? labelOf(CLIENT_TYPES, e.client_type) : null,
      e.status === 'turned_away' ? `Turned away: ${labelOf(TURNED_AWAY_REASONS, e.turned_away_reason)}` : null,
      e.quote_number ? `Quote ${e.quote_number}` : null].filter(Boolean).join(' · ')),
    e.message ? h('p', { class: 'enquiry-msg' }, e.message) : null,
    e.notes ? h('p', { class: 'muted' }, `Notes: ${e.notes}`) : null,
    actions);
}

async function enquiryForm(ctx, categories) {
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'grid-2' },
      field('Came in via', select('source', ENQUIRY_SOURCES, 'whatsapp')),
      field('Date', h('input', { type: 'date', name: 'received_at', value: new Date().toISOString().slice(0, 10) })),
      field('Name', textInput('name', '', { maxlength: 200 })),
      field('Company', textInput('company', '', { maxlength: 200 })),
      field('Email', h('input', { type: 'email', name: 'email', maxlength: 254 })),
      field('Phone', h('input', { type: 'tel', name: 'phone', maxlength: 40 })),
      field('Client type', select('client_type', withBlank(CLIENT_TYPES, 'Choose…'), '')),
      field('Kind of work', select('category', [['', 'Choose…'], ...categories.map((c) => [c.id, c.label])], ''))),
    field('What do they want?', textarea('message', '', { rows: 4, maxlength: 5000 })));
  const err = h('p', { class: 'field-error' }); form.appendChild(err);
  return modal('Log an enquiry', form, [
    { label: 'Cancel', value: null },
    { label: 'Save enquiry', class: 'btn-primary', onClick: async () => {
      const v = Object.fromEntries(new FormData(form).entries());
      if (!v.name && !v.company) { err.textContent = 'Enter a name or company.'; return false; }
      try { await ctx.api.rpc('save_enquiry', v); toast('Enquiry logged'); return true; } catch (e) { err.textContent = e.message; return false; }
    } }]);
}
