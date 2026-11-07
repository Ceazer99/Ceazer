// Settings: company, branding, numbering, tax & format, documents, email,
// costing, team, security, import/export, audit log.
import {
  h, clear, icon, toast, money, field, textInput, textarea, moneyInput, select, busy, modal, confirmDialog,
  formValues, toCents, setTitle,
} from '../ui.js';
import { formatNumber, formatMoney, formatDate, todayISO } from '../calc.js';
import { parseCSVObjects, guessMapping, buildImportRows, IMPORT_FIELDS, toCSV, downloadCSV } from '../csv.js';
import { centsColumnsToRand } from './reports.js';

const SECTIONS = [
  { id: 'company', label: 'Company profile', owner: true },
  { id: 'branding', label: 'Logo & signature', owner: true },
  { id: 'numbering', label: 'Numbering', owner: true },
  { id: 'tax', label: 'Tax, currency & dates', owner: true },
  { id: 'documents', label: 'Document defaults', owner: true },
  { id: 'email', label: 'Email', owner: true },
  { id: 'costing', label: 'Costing & materials', owner: true },
  { id: 'categories', label: 'Service categories', owner: true },
  { id: 'team', label: 'Team', owner: true },
  { id: 'security', label: 'Security', owner: false },
  { id: 'data', label: 'Import & export', owner: false },
  { id: 'privacy', label: 'Privacy & retention (POPIA)', owner: true },
  { id: 'audit', label: 'Audit log', owner: true },
];

export async function renderSettings(ctx, section) {
  const allowed = SECTIONS.filter((s) => !s.owner || ctx.owner);
  const current = allowed.find((s) => s.id === section) || null;
  const menu = h('nav', { class: 'settings-menu', 'aria-label': 'Settings sections' },
    allowed.map((s) => h('a', { href: `#/settings/${s.id}`, class: `settings-link ${current && current.id === s.id ? 'active' : ''}` }, s.label, h('span', { 'aria-hidden': 'true' }, '›'))));
  if (!current) return h('div', {}, setTitle('Settings'), h('div', { class: 'settings-grid' }, menu, h('div', { class: 'panel muted desktop-only' }, 'Choose a section.')));
  const body = await ({
    company: companySection, branding: brandingSection, numbering: numberingSection, tax: taxSection,
    documents: documentsSection, email: emailSection, costing: costingSection, categories: categoriesSection, team: teamSection,
    security: securitySection, data: dataSection, audit: auditSection, privacy: privacySection,
  }[current.id])(ctx);
  return h('div', {}, setTitle('Settings'),
    h('div', { class: 'settings-grid has-section' }, menu,
      h('div', {}, h('a', { class: 'back mobile-only', href: '#/settings' }, icon('back', 16), 'Settings'), h('section', { class: 'panel stack' }, h('h2', {}, current.label), body))));
}

/* generic save of company_settings fields */
function settingsForm(ctx, fields, extra = []) {
  const err = h('p', { class: 'field-error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save');
  const form = h('form', { class: 'stack', novalidate: true }, fields, extra, err, h('div', {}, save));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(save, async () => {
      err.textContent = '';
      const v = formValues(form);
      for (const [k, val] of Object.entries(v)) if (k.endsWith('_rand')) { v[k.replace(/_rand$/, '_cents')] = toCents(val) ?? 0; delete v[k]; }
      try { await ctx.api.rpc('save_settings', v); await ctx.refreshSettings(); toast('Settings saved'); }
      catch (ex) { err.textContent = ex.message; }
    })();
  });
  return form;
}
const s = (ctx) => ctx.settings;

function companySection(ctx) {
  const c = s(ctx);
  return settingsForm(ctx, [
    field('Trading name (shown on documents)', textInput('name', c.name, { maxlength: 120 })),
    field('Registered name', textInput('legal_name', c.legal_name, { maxlength: 160 })),
    h('div', { class: 'grid-2' },
      field('Email', h('input', { type: 'email', name: 'email', value: c.email })),
      field('Phone', textInput('phone', c.phone)),
      field('VAT number', textInput('vat_number', c.vat_number), 'Shown on documents. When set and VAT applies, invoices are titled "Tax Invoice".'),
      field('Company registration number', textInput('registration_number', c.registration_number))),
    field('Address', textarea('address', c.address, { rows: 3 })),
    h('h3', {}, 'Bank details (printed on invoices)'),
    h('div', { class: 'grid-2' },
      field('Bank', textInput('bank_name', c.bank_name)), field('Account number', textInput('bank_account', c.bank_account)),
      field('Branch code', textInput('bank_branch_code', c.bank_branch_code)), field('Account holder', textInput('bank_holder', c.bank_holder))),
  ]);
}

function brandingSection(ctx) {
  const c = s(ctx);
  const preview = (path) => {
    const img = h('img', { alt: '', class: 'brand-preview' });
    if (path) ctx.api.storage.signedUrl('branding', path, 120).then((u) => { img.src = u; }).catch(() => {});
    else img.src = '/images/logo.png';
    return img;
  };
  const uploader = (kind, current, label) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': label });
    const img = preview(current);
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { toast('Use a PNG, JPG or WebP image', 'error'); return; }
      if (f.size > 2 * 1024 * 1024) { toast('Image must be under 2 MB', 'error'); return; }
      try {
        const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${kind}-${Date.now()}.${ext}`;
        await ctx.api.storage.upload('branding', path, f);
        await ctx.api.rpc('save_settings', { [`${kind}_path`]: path });
        await ctx.refreshSettings();
        img.src = URL.createObjectURL(f);
        toast(`${label} updated`);
      } catch (e) { toast(e.message, 'error'); }
    });
    return h('div', { class: 'stack' }, h('h3', {}, label), img, input);
  };
  return h('div', { class: 'grid-2' },
    uploader('logo', c.logo_path, 'Logo'),
    h('div', { class: 'stack' }, uploader('signature', c.signature_path, 'Signature (printed on invoices)'),
      settingsForm(ctx, [field('Signature caption', textInput('signatory_label', c.signatory_label))])));
}

function numberingSection(ctx) {
  const c = s(ctx);
  const block = (kind, label) => {
    const prefix = textInput(`${kind}_prefix`, c[`${kind}_prefix`], { maxlength: 10, pattern: '[A-Za-z0-9-]*' });
    const pad = select(`${kind}_padding`, [3, 4, 5, 6, 7, 8].map((n) => [n, `${n} digits`]), c[`${kind}_padding`]);
    const next = h('input', { type: 'number', min: 1, step: 1, value: c[`${kind}_next`], class: 'num' });
    const prev = h('strong', {});
    const upd = () => { prev.textContent = formatNumber(prefix.value, Number(next.value) || 1, Number(pad.value)); };
    [prefix, pad, next].forEach((x) => x.addEventListener('input', upd)); upd();
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, `Save ${label.toLowerCase()} numbering`);
    save.addEventListener('click', busy(save, async () => {
      await ctx.api.rpc('save_settings', { [`${kind}_prefix`]: prefix.value.trim(), [`${kind}_padding`]: Number(pad.value) });
      if (Number(next.value) !== Number(c[`${kind}_next`])) await ctx.api.rpc('set_next_number', { kind, next: Number(next.value) });
      await ctx.refreshSettings(); toast('Numbering saved');
    }));
    return h('div', { class: 'stack' }, h('h3', {}, label),
      h('div', { class: 'grid-3' }, field('Prefix', prefix), field('Digits', pad), field('Next number', next)),
      h('p', {}, 'Next ', label.toLowerCase(), ': ', prev), save);
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Numbers are allocated by the database, never reused and never duplicated. Quotes get a number when first saved; invoices when issued, so deleted drafts leave no gaps. To continue from your old app, set the next numbers here (or import your history - the counters move past imported numbers automatically).'),
    block('quote', 'Quote'), block('invoice', 'Invoice'));
}

function taxSection(ctx) {
  const c = s(ctx);
  const ex = h('p', { class: 'muted' });
  const form = settingsForm(ctx, [
    h('div', { class: 'grid-2' },
      field('Default VAT handling', select('tax_mode', [['exclusive', 'Add VAT to prices'], ['inclusive', 'Prices include VAT'], ['none', 'No VAT (not registered)']], c.tax_mode)),
      field('VAT rate %', h('input', { type: 'number', name: 'vat_rate', min: 0, max: 100, step: '0.001', value: c.vat_rate })),
      field('Currency symbol', textInput('currency_symbol', c.currency_symbol, { maxlength: 5 })),
      field('Symbol placement', select('currency_position', [['front', 'Front (R100.00)'], ['back', 'Back (100.00 R)']], c.currency_position)),
      field('Thousands separator', select('thousand_separator', [[',', 'Comma (1,000)'], [' ', 'Space (1 000)'], ['.', 'Dot (1.000)'], ['', 'None']], c.thousand_separator)),
      field('Decimal separator', select('decimal_separator', [['.', 'Dot (0.50)'], [',', 'Comma (0,50)']], c.decimal_separator)),
      field('Decimal places', select('decimal_places', [[2, 'Two'], [1, 'One'], [0, 'None']], c.decimal_places)),
      field('Date format', select('date_format', [['DD/MMM/YYYY', '06/Nov/2026'], ['DD/MM/YYYY', '06/11/2026'], ['YYYY-MM-DD', '2026-11-06'], ['DD MMM YYYY', '06 Nov 2026']], c.date_format))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'shipping_taxable', checked: c.shipping_taxable }), h('span', {}, 'Charge VAT on shipping by default')),
    ex,
  ]);
  const upd = () => { const v = formValues(form); ex.textContent = `Example: ${formatMoney(1587050, v)} on ${formatDate(todayISO(), v.date_format)}`; };
  form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
  return h('div', { class: 'stack' }, form, h('p', { class: 'muted' }, 'Changes apply to new documents. Issued documents keep the VAT settings they were issued with.'));
}

function documentsSection(ctx) {
  const c = s(ctx);
  return settingsForm(ctx, [
    h('div', { class: 'grid-3' },
      field('Invoice terms (days)', h('input', { type: 'number', name: 'terms_days', min: 0, max: 365, value: c.terms_days })),
      field('Quotes valid for (days)', h('input', { type: 'number', name: 'quote_validity_days', min: 0, max: 365, value: c.quote_validity_days })),
      field('Default deposit on quotes %', h('input', { type: 'number', name: 'default_deposit_percent', min: 0, max: 100, step: '0.01', value: c.default_deposit_percent }))),
    field('Default quote terms', textarea('quote_terms', c.quote_terms, { rows: 3 })),
    field('Default invoice terms', textarea('invoice_terms', c.invoice_terms, { rows: 3 })),
    field('Footer note', textInput('footer_note', c.footer_note, { maxlength: 200 })),
  ]);
}

function emailSection(ctx) {
  const c = s(ctx);
  return settingsForm(ctx, [
    h('p', { class: 'muted' }, 'Email opens your own mail app with the message filled in and a private download link to the PDF (valid 7 days). Placeholders: {type} {number} {company} {client} {total} {balance} {due_date} {link}'),
    h('div', { class: 'grid-2' }, field('Cc', textInput('email_cc', c.email_cc)), field('Bcc', textInput('email_bcc', c.email_bcc))),
    field('Subject', textInput('email_subject', c.email_subject, { maxlength: 200 })),
    field('Message (leave empty for the standard message)', textarea('email_body', c.email_body, { rows: 6 })),
  ]);
}

async function costingSection(ctx) {
  const k = s(ctx).costing || {};
  const r = (name, cents) => moneyInput(`${name}_rand`, cents);
  // costing fields are saved under p.costing
  const fields = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'grid-2' },
      field('Machine rate per print hour', r('machine_rate', k.machine_rate_cents)),
      field('Electricity per print hour', r('electricity_rate', k.electricity_rate_cents)),
      field('Labour rate per hour', r('labour_rate', k.labour_rate_cents)),
      field('Design / CAD rate per hour', r('design_rate', k.design_rate_cents)),
      field('Failure allowance %', h('input', { type: 'number', name: 'failure_allowance_percent', step: '0.1', min: 0, value: k.failure_allowance_percent })),
      field('Overhead %', h('input', { type: 'number', name: 'overhead_percent', step: '0.1', min: 0, value: k.overhead_percent })),
      field('Default markup %', h('input', { type: 'number', name: 'default_markup_percent', step: '0.1', min: 0, value: k.default_markup_percent }))));
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save rates');
  fields.appendChild(h('div', {}, save));
  fields.addEventListener('submit', (e) => { e.preventDefault(); saveRates(); });
  const saveRates = busy(save, async () => {
    const v = formValues(fields); const costing = {};
    for (const [key, val] of Object.entries(v)) {
      if (key.endsWith('_rand')) costing[key.replace(/_rand$/, '_cents')] = toCents(val) ?? 0; else costing[key] = Number(val);
    }
    await ctx.api.rpc('save_settings', { costing }); await ctx.refreshSettings(); toast('Costing rates saved');
  });

  const mats = await ctx.api.rpc('list_materials', { include_archived: true });
  const matList = h('div', { class: 'card-list compact' }, mats.map((m) => {
    const price = moneyInput('price', m.cost_per_kg_cents, { 'aria-label': `${m.name} cost per kg` });
    const saveM = h('button', { type: 'button', class: 'btn btn-small' }, 'Save');
    saveM.addEventListener('click', busy(saveM, async () => { await ctx.api.rpc('save_material', { id: m.id, cost_per_kg_cents: toCents(price.value) ?? 0 }); toast(`${m.name} updated`); }));
    const arch = h('button', { type: 'button', class: 'btn btn-small btn-ghost' }, m.archived ? 'Restore' : 'Archive');
    arch.addEventListener('click', busy(arch, async () => { await ctx.api.rpc('save_material', { id: m.id, archived: !m.archived }); ctx.navigate('/settings/costing'); }));
    return h('div', { class: 'mat-row' }, h('strong', {}, m.name, m.archived ? ' (archived)' : ''), h('span', { class: 'muted' }, 'per kg'), price, saveM, arch);
  }));
  const newName = textInput('name', '', { placeholder: 'e.g. PLA+ Silk', maxlength: 80 });
  const newPrice = moneyInput('price', 0);
  const addM = h('button', { type: 'button', class: 'btn btn-small btn-primary' }, 'Add material');
  addM.addEventListener('click', busy(addM, async () => {
    if (!newName.value.trim()) throw new Error('Enter a material name');
    await ctx.api.rpc('save_material', { name: newName.value.trim(), cost_per_kg_cents: toCents(newPrice.value) ?? 0 });
    ctx.navigate('/settings/costing');
  }));
  return h('div', { class: 'stack' },
    h('p', { class: 'internal-tag' }, icon('lock', 14), 'Owner only. Staff never see these rates or any costs.'),
    h('p', { class: 'muted' }, 'Unit cost = (material + print hours × (machine + electricity) + labour + design + other) × (1 + failure %) × (1 + overhead %). Suggested price = unit cost × (1 + markup %).'),
    fields, h('h3', {}, 'Materials'), matList,
    h('div', { class: 'mat-row' }, newName, h('span', { class: 'muted' }, 'per kg'), newPrice, addM));
}

async function categoriesSection(ctx) {
  const cats = await ctx.api.rpc('list_categories', { include_archived: true });
  const rows = cats.map((c) => {
    const name = textInput('label', c.label, { maxlength: 60, 'aria-label': `Name for ${c.id}` });
    const save = h('button', { type: 'button', class: 'btn btn-small' }, 'Save');
    save.addEventListener('click', busy(save, async () => { await ctx.api.rpc('save_category', { id: c.id, label: name.value }); toast('Category saved'); }));
    const arch = h('button', { type: 'button', class: 'btn btn-small btn-ghost' }, c.archived ? 'Restore' : 'Archive');
    arch.addEventListener('click', busy(arch, async () => { await ctx.api.rpc('save_category', { id: c.id, archived: !c.archived }); ctx.navigate('/settings/categories'); }));
    return h('div', { class: 'mat-row cat-row' }, name, h('span', { class: 'muted' }, c.archived ? 'archived' : c.id), save, arch);
  });
  const newName = textInput('label', '', { placeholder: 'e.g. Laser cutting', maxlength: 60, 'aria-label': 'New category' });
  const add = h('button', { type: 'button', class: 'btn btn-small btn-primary' }, 'Add category');
  add.addEventListener('click', busy(add, async () => {
    if (!newName.value.trim()) throw new Error('Enter a category name');
    await ctx.api.rpc('save_category', { label: newName.value.trim() }); ctx.navigate('/settings/categories');
  }));
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Every saved item and quote line gets one of these. Keeping a short, fixed list (rather than free text) is what lets Insights compare kinds of work. Archive instead of deleting so history stays intact.'),
    h('div', { class: 'card-list compact' }, rows), h('div', { class: 'mat-row cat-row' }, newName, h('span'), add));
}

async function teamSection(ctx) {
  const { users } = await ctx.api.team('list');
  const rows = users.map((u) => {
    const role = select('role', [['staff', 'Staff'], ['owner', 'Owner']], u.role, { 'aria-label': `Role for ${u.email}` });
    const me = u.id === ctx.me.id;
    role.disabled = me;
    role.addEventListener('change', async () => {
      try { await ctx.api.team('update', { id: u.id, role: role.value }); toast('Role updated'); }
      catch (e) { toast(e.message, 'error'); role.value = u.role; }
    });
    const toggle = h('button', { type: 'button', class: `btn btn-small ${u.active ? 'btn-ghost danger' : ''}` }, u.active ? 'Deactivate' : 'Reactivate');
    toggle.disabled = me;
    toggle.addEventListener('click', busy(toggle, async () => {
      if (u.active && !(await confirmDialog(`Deactivate ${u.email}?`, 'They are signed out and can no longer open the admin. Their past work stays in the history.', 'Deactivate', true))) return;
      await ctx.api.team('update', { id: u.id, active: !u.active }); ctx.navigate('/settings/team');
    }));
    return h('div', { class: 'mat-row' }, h('div', {}, h('strong', {}, u.full_name || u.email), h('div', { class: 'muted' }, u.email, me ? ' (you)' : '', u.active ? '' : ' · deactivated')), role, toggle);
  });
  const email = h('input', { type: 'email', placeholder: 'name@example.com', 'aria-label': 'Email' });
  const name = textInput('full_name', '', { placeholder: 'Full name', 'aria-label': 'Full name' });
  const role = select('role', [['staff', 'Staff'], ['owner', 'Owner']], 'staff', { 'aria-label': 'Role' });
  const invite = h('button', { type: 'button', class: 'btn btn-primary' }, 'Send invite');
  invite.addEventListener('click', busy(invite, async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) throw new Error('Enter a valid email');
    await ctx.api.team('invite', { email: email.value.trim(), full_name: name.value.trim(), role: role.value });
    toast('Invite sent - they will get an email to set their password'); ctx.navigate('/settings/team');
  }));
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Staff can manage clients, items, quotes, invoices and payments. Only owners see costing, profit, reports, settings, the team and the audit log.'),
    h('div', { class: 'card-list compact' }, rows),
    h('h3', {}, 'Invite someone'), h('div', { class: 'grid-3' }, email, name, role), h('div', {}, invite));
}

async function securitySection(ctx) {
  const factors = await ctx.api.auth.mfa.factors().catch(() => []);
  const verified = factors.filter((f) => f.status === 'verified');
  const mfaBox = h('div', { class: 'stack' });
  const drawMfa = () => {
    clear(mfaBox);
    if (verified.length) {
      mfaBox.append(h('p', {}, '✓ Two-step verification is on.'),
        ...verified.map((f) => {
          const b = h('button', { type: 'button', class: 'btn btn-small btn-ghost danger' }, 'Remove authenticator');
          b.addEventListener('click', busy(b, async () => {
            if (!(await confirmDialog('Remove two-step verification?', 'Your account will be protected by your password only.', 'Remove', true))) return;
            await ctx.api.auth.mfa.unenroll(f.id); toast('Authenticator removed'); ctx.navigate('/settings/security');
          }));
          return b;
        }));
      return;
    }
    const start = h('button', { type: 'button', class: 'btn btn-primary' }, 'Turn on two-step verification');
    start.addEventListener('click', busy(start, async () => {
      const e = await ctx.api.auth.mfa.enroll();
      const code = h('input', { inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', 'aria-label': '6-digit code' });
      const err = h('p', { class: 'field-error' });
      await modal('Set up authenticator', h('div', { class: 'stack' },
        h('p', {}, 'Scan this with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.'),
        e.qr ? h('img', { src: e.qr, alt: 'QR code for your authenticator app', class: 'qr' }) : null,
        h('p', { class: 'muted' }, 'Or enter this key manually: ', h('code', {}, e.secret)),
        field('Code', code), err), [
        { label: 'Cancel', value: null },
        { label: 'Verify', class: 'btn-primary', onClick: async () => {
          try { await ctx.api.auth.mfa.verifyEnrollment(e.id, code.value.trim()); toast('Two-step verification is on'); return true; }
          catch (ex) { err.textContent = ex.message; return false; }
        } },
      ]);
      ctx.navigate('/settings/security');
    }));
    mfaBox.append(h('p', {}, 'Strongly recommended, especially for owners: after your password you also enter a code from your phone.'), start);
  };
  drawMfa();

  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 12, 'aria-label': 'New password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 12, 'aria-label': 'Repeat new password' });
  const pwBtn = h('button', { type: 'button', class: 'btn' }, 'Change password');
  pwBtn.addEventListener('click', busy(pwBtn, async () => {
    if (pw.value.length < 12) throw new Error('Use at least 12 characters');
    if (pw.value !== pw2.value) throw new Error('The passwords do not match');
    await ctx.api.auth.updatePassword(pw.value); pw.value = ''; pw2.value = ''; toast('Password changed');
  }));
  return h('div', { class: 'stack' },
    h('h3', {}, 'Two-step verification'), mfaBox,
    h('h3', {}, 'Password'), h('div', { class: 'grid-2' }, field('New password', pw), field('Repeat', pw2)), h('div', {}, pwBtn),
    ctx.owner ? h('div', { class: 'stack' }, h('h3', {}, 'Automatic sign-out'),
      settingsForm(ctx, [field('Sign out after this many idle minutes', h('input', { type: 'number', name: 'idle_timeout_minutes', min: 5, max: 480, value: s(ctx).idle_timeout_minutes }))])) : null,
    h('p', { class: 'muted' }, 'Your session is kept only in this browser tab: closing the tab signs you out.'));
}

async function dataSection(ctx) {
  const exportBtn = (label, type) => {
    const b = h('button', { type: 'button', class: 'btn btn-small' }, label);
    b.addEventListener('click', busy(b, async () => {
      const rows = await ctx.api.rpc('export', { type });
      if (!rows.length) { toast('Nothing to export yet'); return; }
      downloadCSV(`${type}-${todayISO()}.csv`, toCSV(rows.map(centsColumnsToRand)));
    }));
    return b;
  };
  return h('div', { class: 'stack' },
    h('h3', {}, 'Export to CSV'),
    h('div', { class: 'row-gap wrap' }, exportBtn('Clients', 'clients'), exportBtn('Items', 'services'), exportBtn('Quotes', 'quotes'),
      exportBtn('Invoices', 'invoices'), exportBtn('Payments', 'payments'), ctx.owner ? exportBtn('Costing (internal)', 'costing') : null),
    h('p', { class: 'muted' }, 'Exports are safe to open in Excel: cells that look like formulas are neutralised.'),
    ctx.owner ? importWizard(ctx) : h('p', { class: 'muted' }, 'Importing is limited to owners.'));
}

function importWizard(ctx) {
  const type = select('type', [['clients', 'Clients / contacts'], ['services', 'Items / services'], ['quotes', 'Quotes (with line items)'], ['invoices', 'Invoices (with line items)']], 'clients');
  const order = select('order', [['DMY', 'Day first (04/11/2026)'], ['MDY', 'Month first (11/04/2026)']], 'DMY');
  const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'CSV file' });
  const stage = h('div', { class: 'stack' });
  let parsed = null;
  const run = async () => {
    clear(stage);
    const f = file.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { stage.append(h('p', { class: 'field-error' }, 'File is larger than 10 MB. Split it into smaller files.')); return; }
    try { parsed = parseCSVObjects(await f.text()); } catch (e) { stage.append(h('p', { class: 'field-error' }, e.message)); return; }
    if (!parsed.records.length) { stage.append(h('p', { class: 'field-error' }, 'No rows found.')); return; }
    const kind = type.value;
    const fields = IMPORT_FIELDS[kind === 'quotes' || kind === 'invoices' ? 'documents' : kind];
    const guess = guessMapping(parsed.headers, kind);
    const selects = {};
    const mapGrid = h('div', { class: 'grid-3' }, Object.keys(fields).map((fname) => {
      selects[fname] = select(fname, [['', '— not in file —'], ...parsed.headers.map((x) => [x, x])], guess[fname] || '');
      return field(fname.replace(/_/g, ' '), selects[fname]);
    }));
    const previewHost = h('div', { class: 'stack' });
    const preview = () => {
      const mapping = Object.fromEntries(Object.entries(selects).map(([k, v]) => [k, v.value]).filter(([, v]) => v));
      const out = buildImportRows(parsed.records, mapping, kind, { dateOrder: order.value, format: ctx.settings });
      clear(previewHost).append(
        h('p', {}, h('strong', {}, `${out.rows.length} ${kind === 'quotes' || kind === 'invoices' ? 'documents' : 'rows'} ready`), ` from ${parsed.records.length} CSV rows`, out.errors.length ? ` · ${out.errors.length} problem(s)` : ''),
        out.errors.length ? h('details', { open: true }, h('summary', {}, 'Problems (these rows are skipped)'),
          h('ul', {}, out.errors.slice(0, 50).map((e) => h('li', {}, `Row ${e.row}: ${e.message}`)))) : null,
        h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('tbody', {}, out.rows.slice(0, 5).map((r) =>
          h('tr', {}, h('td', {}, r.number || r.name), h('td', {}, r.client_name || r.email || r.description || ''),
            h('td', {}, r.issue_date || ''), h('td', { class: 'num' }, r.lines ? `${r.lines.length} line(s)` : r.unit_price_cents != null ? money(r.unit_price_cents) : '')))))));
      const go = h('button', { type: 'button', class: 'btn btn-primary' }, `Import ${out.rows.length}`);
      go.disabled = !out.rows.length;
      go.addEventListener('click', busy(go, async () => {
        if (!(await confirmDialog('Import now?', 'Imported quotes and invoices are stored as issued, locked history with their original numbers. Existing numbers and clients are skipped, not overwritten.', 'Import'))) return;
        let created = 0; const skipped = []; const warnings = [];
        for (let i = 0; i < out.rows.length; i += 500) {
          const res = await ctx.api.rpc('import', { type: kind, rows: out.rows.slice(i, i + 500) });
          created += res.created; skipped.push(...res.skipped.map((x) => ({ ...x, row: x.row + i }))); warnings.push(...res.warnings);
        }
        await ctx.refreshSettings();
        clear(previewHost).append(h('p', {}, h('strong', {}, `Imported ${created}.`), skipped.length ? ` Skipped ${skipped.length}.` : '', warnings.length ? ` ${warnings.length} warning(s).` : ''),
          skipped.length ? h('details', {}, h('summary', {}, 'Skipped'), h('ul', {}, skipped.slice(0, 100).map((x) => h('li', {}, `Item ${x.row}: ${x.reason}`)))) : null,
          warnings.length ? h('details', { open: true }, h('summary', {}, 'Warnings'), h('ul', {}, warnings.slice(0, 100).map((x) => h('li', {}, `${x.number}: ${x.warning}`)))) : null);
        toast(`Imported ${created}`);
      }));
      previewHost.append(go);
    };
    Object.values(selects).forEach((x) => x.addEventListener('change', preview));
    order.addEventListener('change', preview);
    stage.append(h('h3', {}, 'Match the columns'), h('p', { class: 'muted' }, 'We guessed from the headings. Quote/invoice files can have one row per line item; rows with the same number are combined. Historical VAT lines are kept exactly as they were.'), mapGrid, previewHost);
    preview();
  };
  file.addEventListener('change', run); type.addEventListener('change', run);
  return h('div', { class: 'stack' }, h('h3', {}, 'Import from CSV (migration)'),
    h('p', { class: 'muted' }, 'Export your data as CSV from your previous app (Settings → Export data in CSV), then import in this order: clients, items, quotes, invoices.'),
    h('div', { class: 'grid-3' }, field('What are you importing?', type), field('Dates in the file', order), field('CSV file', file)), stage);
}

async function privacySection(ctx) {
  const months = h('input', { type: 'number', min: 6, max: 120, value: 24, class: 'num', 'aria-label': 'Retention period in months' });
  const out = h('div', { class: 'stack' });
  const preview = h('button', { type: 'button', class: 'btn' }, 'Check what is due for deletion');
  preview.addEventListener('click', busy(preview, async () => {
    const r = await ctx.api.rpc('retention_preview', { months: Number(months.value) });
    const del = h('button', { type: 'button', class: 'btn btn-danger' }, `Delete ${r.enquiries + r.clients} record(s) now`);
    del.disabled = !(r.enquiries + r.clients);
    del.addEventListener('click', busy(del, async () => {
      const ok = await modal('Delete old records?', h('p', {}, `Permanently delete ${r.enquiries} enquiries and ${r.clients} prospect records older than ${r.months} months that never led to a quote or invoice. This cannot be undone.`),
        [{ label: 'Cancel', value: false }, { label: 'Delete permanently', class: 'btn-danger', value: true }]);
      if (!ok) return;
      const d = await ctx.api.rpc('apply_retention', { months: r.months, confirm: true });
      toast(`Deleted ${d.enquiries_deleted} enquiries and ${d.clients_deleted} prospects`);
      ctx.navigate('/settings/privacy');
    }));
    clear(out).append(h('p', {}, `Older than ${r.months} months and never led to work: ${r.enquiries} enquiries, ${r.clients} prospect records.`),
      r.financial_records_older_than_7_years ? h('p', {}, `${r.financial_records_older_than_7_years} quotes/invoices are older than 7 years and may now be anonymised; ask for help when this happens.`) : null,
      h('div', {}, del));
  }));
  const todo = [
    ['Register your Information Officer with the Information Regulator on its eServices portal (free). The owner/CEO is the Information Officer by default, and the same portal login is needed to report a breach, so do it before you ever need it.', 'https://eservices.inforegulator.org.za/'],
    ['Accept the Supabase Data Processing Addendum (Supabase dashboard → Organization → Legal documents). It is your written contract with the operator that stores your data (POPIA s21).', 'https://supabase.com/legal/dpa'],
    ['Have staff sign a short confidentiality undertaking before giving them an admin login (POPIA s20 and s19).', null],
    ['Run "Check what is due for deletion" below every few months, so enquiries are not kept longer than the 24 months promised in the privacy policy.', null],
    ['Answer access, correction or deletion requests within 30 days. Confirm the person\'s identity first, then use the Privacy panel on the client\'s page.', null],
  ];
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Tools and reminders for the Protection of Personal Information Act (POPIA). This is practical guidance, not legal advice.'),
    h('h3', {}, 'Your to-do list'),
    h('ol', { class: 'stack' }, todo.map(([t, href]) => h('li', {}, t, href ? h('span', {}, ' ', h('a', { href, target: '_blank', rel: 'noopener' }, 'Open')) : null))),
    h('h3', {}, 'Retention'),
    h('p', { class: 'muted' }, 'Quotes, invoices, payments and the clients on them are kept for 7 years (Companies Act s24, Tax Administration Act s29) and are never touched by this tool.'),
    h('div', { class: 'row-gap' }, field('Keep enquiries that led nowhere for (months)', months), preview), out,
    h('h3', {}, 'If personal information is ever leaked or accessed without permission'),
    h('ol', {}, [
      'Contain it: change passwords, deactivate the affected login (Settings → Team), and rotate the Supabase keys if they may be exposed.',
      'Work out what was affected, using Settings → Audit log.',
      'Notify the Information Regulator through its eServices portal (eservices.inforegulator.org.za → security compromise notification; email is no longer accepted), and tell the affected people, as soon as reasonably possible (POPIA s22). You can report on what you know and update it later.',
      'Write down what happened and what you changed.',
    ].map((t) => h('li', {}, t))));
}

async function auditSection(ctx) {
  const rows = await ctx.api.rpc('list_audit', { limit: 300 });
  return h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Every change to clients, items, documents, payments, settings and the team is recorded and cannot be edited or deleted.'),
    h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What'), h('th', {}, 'Record'))),
      h('tbody', {}, rows.map((a) => h('tr', {}, h('td', {}, new Date(a.at).toLocaleString('en-ZA')), h('td', {}, a.actor_email),
        h('td', {}, `${a.action} ${a.table_name.replace(/_/g, ' ')}`), h('td', {}, a.label || a.row_id || '')))))));
}
