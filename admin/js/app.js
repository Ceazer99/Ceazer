// Ceazers 3D admin - application shell: boot, sign-in, layout, routing.
import { loadConfig, createSupabaseBackend, createDemoBackend, isLocalHost } from './backend.js';
import { h, clear, $, icon, toast, setFormat, busy, field, setTitle } from './ui.js';
import { renderHome } from './views/home.js';
import { renderDocumentList, renderDocument } from './views/documents.js';
import { renderClients, renderClient } from './views/clients.js';
import { renderServices, renderService } from './views/services.js';
import { renderReports } from './views/reports.js';
import { renderEnquiries } from './views/enquiries.js';
import { renderInsights } from './views/insights.js';
import { renderSettings } from './views/settings.js';

const root = document.getElementById('app');
const ctx = { api: null, me: null, settings: null, owner: false };
window.__adminCtx = ctx; // handy for debugging in the console; holds no secrets beyond the session

const NAV = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/enquiries', label: 'Enquiries', icon: 'mail' },
  { path: '/quotes', label: 'Quotes', icon: 'quote' },
  { path: '/invoices', label: 'Invoices', icon: 'invoice' },
  { path: '/items', label: 'Items', icon: 'items' },
  { path: '/clients', label: 'Clients', icon: 'clients' },
  { path: '/reports', label: 'Reports', icon: 'reports', owner: true },
  { path: '/insights', label: 'Insights', icon: 'insights', owner: true },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

ctx.navigate = (path) => { if (location.hash !== `#${path}`) location.hash = `#${path}`; else route(); };
ctx.refreshSettings = async () => { ctx.settings = await ctx.api.rpc('get_settings'); setFormat(ctx.settings); return ctx.settings; };

/* ── boot ──────────────────────────────────────────────────────── */
async function boot() {
  const params = new URLSearchParams(location.search);
  try {
    if (params.has('demo') && isLocalHost()) {
      renderLoading('Starting local demo database…');
      ctx.api = await createDemoBackend();
    } else {
      const cfg = await loadConfig();
      if (!cfg.configured) return renderNotConfigured();
      ctx.api = createSupabaseBackend(cfg);
    }
  } catch (e) {
    return renderFatal(e.message);
  }
  ctx.api.auth.onChange((event) => {
    if (event === 'PASSWORD_RECOVERY') renderResetPassword();
    if (event === 'SIGNED_OUT') {
      ctx.me = null;
      clearTimeout(idleTimer);
      // the next person to sign in on this device starts at Home, not on the previous user's page
      history.replaceState(null, '', location.pathname + location.search);
      renderLogin();
    }
  });
  window.addEventListener('hashchange', () => { if (ctx.me?.member) route(); });
  await afterAuth();
}

async function afterAuth() {
  const session = await ctx.api.auth.session();
  if (session && new URLSearchParams(location.search).has('setpw')) return renderResetPassword();
  if (!session) return renderLogin();
  try {
    ctx.me = await ctx.api.rpc('me');
  } catch (e) {
    return renderLogin(e.message);
  }
  if (ctx.me.needs_mfa) return renderMfaChallenge();
  if (!ctx.me.member) {
    await ctx.api.auth.signOut();
    return renderLogin('This account does not have access to the admin area.');
  }
  ctx.owner = ctx.me.role === 'owner';
  await ctx.refreshSettings();
  startIdleTimer();
  renderShell();
  route();
}

/* ── auth screens ──────────────────────────────────────────────── */
function authCard(...children) {
  clear(root).appendChild(h('main', { class: 'auth' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, h('img', { src: '/images/logo.png', alt: 'Ceazers 3D', width: 72, height: 72 }),
        h('div', {}, h('strong', {}, 'Ceazers 3D'), h('span', {}, 'Admin'))),
      ...children,
      ctx.api?.mode === 'demo' ? h('p', { class: 'demo-note' }, 'Local demo: owner@demo.local / demo-owner-pass, staff@demo.local / demo-staff-pass. Data lives in this tab only.') : null)));
}

function renderLoading(text) { clear(root).appendChild(h('main', { class: 'auth' }, h('p', { class: 'loading' }, text))); }
function renderFatal(text) { authCard(h('h1', {}, 'Something went wrong'), h('p', { class: 'field-error' }, text)); }

function renderNotConfigured() {
  authCard(h('h1', {}, 'Admin not configured yet'),
    h('p', {}, 'The database connection has not been set up. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel (see ADMIN_SETUP.md), then redeploy.'),
    isLocalHost() ? h('p', {}, h('a', { href: '/admin/?demo=1' }, 'Open the local demo instead')) : null);
}

function renderLogin(message) {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, minlength: 8 });
  const err = h('p', { class: 'field-error', role: 'alert' }, message || '');
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
  let failures = 0;
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    busy(btn, async () => {
      err.textContent = '';
      if (failures >= 5) { err.textContent = 'Too many attempts. Wait a minute and try again.'; return; }
      try {
        await ctx.api.auth.signIn(email.value.trim(), pw.value);
        failures = 0;
        await afterAuth();
      } catch (ex) {
        failures++;
        if (failures >= 5) setTimeout(() => { failures = 0; }, 60000);
        err.textContent = /invalid/i.test(ex.message) ? 'Email or password is incorrect.' : ex.message;
        pw.value = '';
      }
    })();
  } }, h('h1', {}, 'Sign in'), field('Email', email), field('Password', pw), err, btn,
  h('button', { type: 'button', class: 'link-btn', onclick: () => renderForgot(email.value) }, 'Forgot password?'));
  authCard(form);
  email.focus();
}

function renderForgot(prefill = '') {
  const email = h('input', { type: 'email', value: prefill, autocomplete: 'username', required: true });
  const msg = h('p', { role: 'status' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Send reset link');
  authCard(h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    busy(btn, async () => {
      await ctx.api.auth.resetPassword(email.value.trim());
      // same message whether or not the account exists (no account enumeration)
      msg.textContent = 'If that email belongs to an admin account, a reset link is on its way.';
    })();
  } }, h('h1', {}, 'Reset password'), field('Email', email), msg, btn,
  h('button', { type: 'button', class: 'link-btn', onclick: () => renderLogin() }, 'Back to sign in')));
}

function renderResetPassword() {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 12, required: true });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 12, required: true });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save new password');
  authCard(h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    busy(btn, async () => {
      err.textContent = '';
      if (pw.value.length < 12) { err.textContent = 'Use at least 12 characters.'; return; }
      if (pw.value !== pw2.value) { err.textContent = 'The passwords do not match.'; return; }
      await ctx.api.auth.updatePassword(pw.value);
      toast('Password updated');
      history.replaceState(null, '', ctx.api.mode === 'demo' ? '/admin/?demo=1#/' : '/admin/#/');
      await afterAuth();
    })();
  } }, h('h1', {}, 'Choose a new password'), field('New password', pw, 'At least 12 characters. A passphrase works well.'),
  field('Repeat new password', pw2), err, btn));
}

function renderMfaChallenge() {
  const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, required: true });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Verify');
  authCard(h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    busy(btn, async () => {
      try { await ctx.api.auth.mfa.challenge(code.value.trim()); await afterAuth(); }
      catch (ex) { err.textContent = ex.message; code.value = ''; }
    })();
  } }, h('h1', {}, 'Two-step verification'), h('p', {}, 'Enter the 6-digit code from your authenticator app.'),
  field('Code', code), err, btn,
  h('button', { type: 'button', class: 'link-btn', onclick: () => ctx.api.auth.signOut() }, 'Sign out')));
  code.focus();
}

/* ── idle sign-out ─────────────────────────────────────────────── */
let idleTimer = null;
function startIdleTimer() {
  const minutes = Number(ctx.settings?.idle_timeout_minutes || 30);
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      await ctx.api.auth.signOut();
      toast(`Signed out after ${minutes} minutes of inactivity`);
    }, minutes * 60000);
  };
  ['pointerdown', 'keydown', 'scroll', 'visibilitychange'].forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
  reset();
}

/* ── layout ────────────────────────────────────────────────────── */
function renderShell() {
  const links = NAV.filter((n) => !n.owner || ctx.owner).map((n) =>
    h('a', { href: `#${n.path}`, class: 'nav-link', dataset: { path: n.path } }, icon(n.icon), h('span', {}, n.label)));
  const nav = h('nav', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Main' },
    h('div', { class: 'brand' }, h('img', { src: '/images/logo.png', alt: '', width: 40, height: 40 }),
      h('div', {}, h('strong', {}, 'Ceazers 3D'), h('span', {}, ctx.api.mode === 'demo' ? 'Admin · local demo' : 'Admin'))),
    h('div', { class: 'nav-links' }, links),
    h('div', { class: 'nav-foot' },
      h('div', { class: 'whoami' }, h('strong', {}, ctx.me.full_name || ctx.me.email), h('span', {}, ctx.owner ? 'Owner' : 'Staff')),
      h('button', { class: 'nav-link', type: 'button', onclick: () => ctx.api.auth.signOut() }, icon('logout'), h('span', {}, 'Sign out'))));
  const scrim = h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') });
  const main = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Open menu', 'aria-controls': 'sidebar',
      onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
    h('span', { class: 'topbar-title', id: 'topbar-title' }, 'Ceazers 3D Admin'));
  clear(root).append(nav, scrim, h('div', { class: 'main-col' }, topbar, main));
}

/* ── router ────────────────────────────────────────────────────── */
async function route() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  document.body.classList.remove('nav-open');
  document.querySelectorAll('.nav-link[data-path]').forEach((a) => {
    const p = a.dataset.path;
    a.classList.toggle('active', p === '/' ? path === '/' : path.startsWith(p));
    if (a.classList.contains('active')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const main = $('#content');
  if (!main) return;
  clear(main).appendChild(h('p', { class: 'loading' }, 'Loading…'));
  const seg = path.split('/').filter(Boolean);
  try {
    let view;
    if (!seg.length) view = await renderHome(ctx);
    else if (seg[0] === 'quotes' || seg[0] === 'invoices') {
      const kind = seg[0] === 'quotes' ? 'quote' : 'invoice';
      view = seg[1] ? await renderDocument(ctx, kind, seg[1]) : await renderDocumentList(ctx, kind);
    } else if (seg[0] === 'clients') view = seg[1] ? await renderClient(ctx, seg[1]) : await renderClients(ctx);
    else if (seg[0] === 'items') view = seg[1] ? await renderService(ctx, seg[1]) : await renderServices(ctx);
    else if (seg[0] === 'reports' && ctx.owner) view = await renderReports(ctx);
    else if (seg[0] === 'insights' && ctx.owner) view = await renderInsights(ctx);
    else if (seg[0] === 'enquiries') view = await renderEnquiries(ctx);
    else if (seg[0] === 'settings') view = await renderSettings(ctx, seg[1]);
    else view = h('div', {}, setTitle('Not found'), h('p', {}, 'That page does not exist.'));
    clear(main).appendChild(view);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    clear(main).appendChild(h('div', { class: 'panel' }, h('h2', {}, 'Could not load this page'), h('p', { class: 'field-error' }, e.message)));
    if (/Not authorised|JWT|expired/i.test(e.message)) setTimeout(() => ctx.api.auth.signOut(), 1500);
  }
}

boot();
