// Ceazers 3D admin - DOM + UI helpers.
// h() builds elements with textContent only (never innerHTML with data), so
// client names, notes and imported CSV values cannot inject markup.
import { formatMoney, formatDate, parseMoney } from './calc.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') throw new Error('raw HTML is not allowed');
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendAll(el, children);
  return el;
}
function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

/* SVG icons (static strings we control, parsed once) */
const ICONS = {
  quote: 'M9 2h6l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h3zM14 2v6h6M8 13h8M8 17h5',
  invoice: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  items: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  clients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  reports: 'M3 3v18h18M7 15l4-4 3 3 6-7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  home: 'M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z',
  plus: 'M12 5v14M5 12h14',
  menu: 'M3 6h18M3 12h18M3 18h18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  back: 'M15 18l-6-6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  mail: 'M4 4h16v16H4zM4 6l8 7 8-7',
  chat: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.9-.9L3 21l2-5a8.4 8.4 0 1 1 16-4.5z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
};
export function icon(name, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] || ''); svg.appendChild(p);
  return svg;
}

/* ── formatting bound to company settings ─────────────────────── */
let FMT = {};
export const setFormat = (settings) => { FMT = settings || {}; };
export const money = (c) => formatMoney(c ?? 0, FMT);
export const date = (iso) => formatDate(iso, FMT.date_format || 'DD/MMM/YYYY');
export const toCents = (s) => parseMoney(s, FMT);
export const centsToInput = (c) => ((c ?? 0) / 100).toFixed(2);

/* ── toasts, modals, confirm ───────────────────────────────────── */
export function toast(message, kind = 'ok') {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  host.appendChild(t);
  while (host.children.length > 3) host.firstChild.remove(); // never let messages pile up over the page
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3200);
  setTimeout(() => t.remove(), kind === 'error' ? 6600 : 3800);
}

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(null); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('h2', {}, title),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, icon('close'))),
        h('div', { class: 'modal-body' }, body),
        actions.length ? h('div', { class: 'modal-actions' }, actions.map((a) =>
          h('button', { class: `btn ${a.class || ''}`, type: 'button', onclick: async () => {
            if (a.onClick) { const v = await a.onClick(); if (v === false) return; close(v === undefined ? a.value : v); }
            else close(a.value);
          } }, a.label))) : null));
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    (overlay.querySelector('input, select, textarea, .btn-primary') || overlay.querySelector('button'))?.focus();
  });
}

export async function confirmDialog(title, message, okLabel = 'Confirm', danger = false) {
  return modal(title, h('p', {}, message), [
    { label: 'Cancel', value: false },
    { label: okLabel, value: true, class: danger ? 'btn-danger' : 'btn-primary' },
  ]);
}

export async function promptDialog(title, label, { placeholder = '', minLength = 0, okLabel = 'OK', danger = false } = {}) {
  const input = h('input', { type: 'text', placeholder, 'aria-label': label });
  const err = h('p', { class: 'field-error' });
  const res = await modal(title, h('label', { class: 'field' }, h('span', {}, label), input, err), [
    { label: 'Cancel', value: null },
    { label: okLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: () => {
      if (input.value.trim().length < minLength) { err.textContent = `Please enter at least ${minLength} characters.`; return false; }
      return input.value.trim();
    } },
  ]);
  return res;
}

/* ── form helpers ──────────────────────────────────────────────── */
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}
export function textInput(name, value = '', attrs = {}) {
  return h('input', { type: 'text', name, value: value ?? '', ...attrs });
}
export function moneyInput(name, cents, attrs = {}) {
  return h('input', { type: 'text', inputmode: 'decimal', name, value: centsToInput(cents), class: 'num', autocomplete: 'off', ...attrs });
}
export function select(name, options, value, attrs = {}) {
  return h('select', { name, ...attrs }, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) ? 'selected' : null }, label)));
}
export function textarea(name, value = '', attrs = {}) {
  const t = h('textarea', { name, rows: attrs.rows || 3, ...attrs }); t.value = value ?? ''; return t;
}
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

export function statusBadge(doc) {
  const s = doc.overdue ? 'overdue' : doc.expired && doc.status === 'sent' ? 'expired' : doc.status;
  const label = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', converted: 'Invoiced',
    issued: 'Unpaid', partially_paid: 'Part paid', paid: 'Paid', void: 'Void', overdue: 'Overdue', expired: 'Expired' }[s] || s;
  return h('span', { class: `badge badge-${s}` }, label);
}

export function busy(button, fn) {
  return async (...args) => {
    if (button.disabled) return;
    button.disabled = true; button.classList.add('is-busy');
    try { return await fn(...args); }
    catch (e) { toast(e.message || String(e), 'error'); }
    finally { button.disabled = false; button.classList.remove('is-busy'); }
  };
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h3', {}, title), h('p', {}, text), action || null);
}

/** Page heading (also sets the document + mobile top-bar title). */
export function setTitle(text, actions) {
  document.title = `${text} · Ceazers 3D Admin`;
  const t = document.getElementById('topbar-title'); if (t) t.textContent = text;
  return h('div', { class: 'page-head' }, h('h1', {}, text), actions ? h('div', { class: 'page-actions' }, actions) : null);
}
