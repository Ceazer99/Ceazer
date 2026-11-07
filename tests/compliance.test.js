/**
 * Compliance regression tests: keep the public website's privacy notice (POPIA s18),
 * collection notice, terms and third-party loading honest and complete.
 * These check wording that is easy to break in a later edit; they are not legal advice.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const widgets = fs.readFileSync(path.join(ROOT, 'scripts', 'widgets.js'), 'utf8');
const section = (id) => { const i = html.indexOf(`id="${id}"`); return html.slice(i, html.indexOf('</div>\n    </div>\n  </div>', i)); };
const privacy = section('privacyModal');
const terms = section('termsModal');

test('privacy notice covers what POPIA section 18 requires', () => {
  const must = {
    'responsible party identified': /Responsible party: Ceazers 3D Engineering Solutions \(Pty\) Ltd/,
    'information officer + contact': /Information Officer: Siyabonga Masiza/,
    'what is collected': /What we collect/,
    'purpose': /Why we use it/,
    'voluntary vs required': /needed to reply to you; everything else is optional/,
    'operators named': /Web3Forms[\s\S]*Supabase[\s\S]*Vercel[\s\S]*Google/,
    'cross-border transfer (s72)': /outside South Africa[\s\S]*section 72/,
    'retention periods': /24 months[\s\S]*7 years/,
    'security + breach notification': /Information Regulator as soon as reasonably possible/,
    'data subject rights': /access[\s\S]*correct[\s\S]*delete[\s\S]*object/i,
    'right to complain to the Regulator': /POPIAComplaints@inforegulator\.org\.za/,
    'direct marketing rule (s69)': /opt out/,
    'AI estimator sends no personal info': /Gemini[\s\S]*No personal information is sent/,
  };
  for (const [what, re] of Object.entries(must)) assert.match(privacy, re, what);
});

test('no statements that are no longer true', () => {
  assert.doesNotMatch(html, /We do not store your data on third-party servers/);
  assert.doesNotMatch(html, /do not collect any information passively through cookies/);
  assert.doesNotMatch(html, /By continuing you agree/);
  assert.doesNotMatch(html, /POPIA compliant ·/, 'no blanket compliance badge');
  assert.doesNotMatch(html, /id="popiaDecline"/, 'no fake decline button when there is nothing to decline');
});

test('company name is consistent everywhere (matches the bank account holder name)', () => {
  assert.doesNotMatch(html, /Ceazer 3D/);
  assert.match(html, /Ceazers 3D Engineering Solutions \(Pty\) Ltd/);
});

test('company registration number is shown in the footer and the privacy notice', () => {
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.match(footer, /Reg\. no\. 2025\/508857\/07/);
  assert.match(privacy, /registration number 2025\/508857\/07/);
});

test('contact form gives a privacy notice at the point of collection', () => {
  const form = html.slice(html.indexOf('<form id="quoteForm"'), html.indexOf('</form>', html.indexOf('<form id="quoteForm"')));
  assert.match(form, /We use your details only to respond to this enquiry/);
  assert.match(form, /id="privacyLinkForm"/);
  assert.match(widgets, /'privacyLinkForm'/, 'the link opens the privacy policy');
});

test('Google Maps (third-party cookies) loads only when the visitor asks', () => {
  assert.doesNotMatch(html, /<iframe[^>]+maps\.google/, 'no map iframe in the page source');
  assert.match(html, /id="mapEmbed" data-src="https:\/\/maps\.google\.com\//);
  assert.match(widgets, /getElementById\('mapLoad'\)\?\.addEventListener\('click'/);
  assert.match(widgets, /\^https:\\\/\\\/maps\\\.google\\\.com\\\//, 'only a Google Maps URL can be loaded');
});

test('terms: online estimates are clearly not binding quotes (Consumer Protection Act)', () => {
  assert.match(terms, /indicative only and are not a quote or an offer/);
  assert.doesNotMatch(terms, /valid for 14 days/, 'validity comes from each quote, which the admin prints');
  assert.match(html, /Indicative range only/);
});
