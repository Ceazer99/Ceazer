// Ceazers 3D admin - insights engine. Pure functions, no DOM, no network.
// Everything runs in the owner's browser on data from app_insights_data().
//
// Models (each unlocks only once there is enough data to trust it):
//   descriptive()   plain statistics - always on
//   segments()      RFM scoring + k-means clustering of clients
//   bundles()       association rules (Apriori) on service categories per job
//   themes()        TF-IDF + spherical k-means on line items / enquiries
//   retention()     BG/NBD (still active? orders expected) + Gamma-Gamma (value)
//   winModel()      L2 logistic regression for quote win probability (+ CV)
//   forecast()      Holt-Winters additive seasonal forecast (monthly)

export const THRESHOLDS = {
  segments: { clients: 30, invoices: 60 },
  bundles: { jobs: 50 },
  themes: { texts: 100 },
  retention: { repeatClients: 10, weeks: 26 },
  winModel: { decided: 150, minEach: 30 },
  forecast: { months: 24 },
};

/* ════════════════════════ small numeric toolkit ════════════════════════ */
export function rng(seed = 42) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
export const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
const DAY = 86400000;
const toDate = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// log-gamma (Lanczos, g=7)
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lgamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lgamma(1 - z);
  z -= 1; let x = LG[0];
  for (let i = 1; i < 9; i++) x += LG[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);
function logSumExp(a, b) { const m = Math.max(a, b); return m + Math.log(Math.exp(a - m) + Math.exp(b - m)); }
/** Gauss hypergeometric 2F1(a,b;c;z), |z|<1, power series. */
export function hyp2f1(a, b, c, z) {
  let term = 1; let s = 1;
  for (let n = 0; n < 5000; n++) {
    term *= ((a + n) * (b + n)) / ((c + n) * (n + 1)) * z;
    s += term;
    if (Math.abs(term) < 1e-12 * Math.abs(s)) break;
  }
  return s;
}

/** Nelder-Mead minimiser. */
export function nelderMead(f, x0, { maxIter = 2000, tol = 1e-9, step = 0.5 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step; simplex.push(p); }
  let vals = simplex.map(f);
  for (let it = 0; it < maxIter; it++) {
    const order = vals.map((v, i) => i).sort((i, j) => vals[i] - vals[j]);
    simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol * (Math.abs(vals[0]) + 1e-12)) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const at = (t) => c.map((cj, j) => cj + t * (simplex[n][j] - cj));
    const xr = at(-1); const fr = f(xr);
    if (fr < vals[0]) { const xe = at(-2); const fe = f(xe); if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; } }
    else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = fr < vals[n] ? at(-0.5) : at(0.5); const fc = f(xc);
      if (fc < Math.min(fr, vals[n])) { simplex[n] = xc; vals[n] = fc; }
      else { for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = f(simplex[i]); } }
    }
  }
  return { x: simplex[0], fx: vals[0] };
}

/* ════════════════════════ dataset helpers ════════════════════════ */
const INVOICED = new Set(['issued', 'partially_paid', 'paid']);
const WON = new Set(['accepted', 'converted']);

export function prepare(data) {
  const docs = data.documents || [];
  const invoices = docs.filter((d) => d.kind === 'invoice' && INVOICED.has(d.status));
  const quotes = docs.filter((d) => d.kind === 'quote' && d.status !== 'draft');
  const linesByDoc = new Map();
  for (const l of data.lines || []) { if (!linesByDoc.has(l.document_id)) linesByDoc.set(l.document_id, []); linesByDoc.get(l.document_id).push(l); }
  const clients = new Map((data.clients || []).map((c) => [c.id, c]));
  const catLabel = new Map((data.categories || []).map((c) => [c.id, c.label]));
  return { today: data.today || new Date().toISOString().slice(0, 10), invoices, quotes, linesByDoc, clients, catLabel,
    enquiries: data.enquiries || [], net: (d) => (d.total_cents || 0) - (d.vat_cents || 0) };
}
const label = (P, id) => P.catLabel.get(id) || id || 'Uncategorised';

/* ════════════════════════ 1. descriptive (always on) ════════════════════════ */
export function descriptive(data) {
  const P = prepare(data);
  const perClient = new Map();
  for (const inv of P.invoices) { if (!inv.client_id) continue; perClient.set(inv.client_id, (perClient.get(inv.client_id) || 0) + 1); }
  const buyers = perClient.size; const repeaters = [...perClient.values()].filter((n) => n >= 2).length;

  const groupSum = (keyOf) => {
    const m = new Map();
    for (const inv of P.invoices) { const k = keyOf(inv) || 'unknown'; const x = m.get(k) || { cents: 0, jobs: 0 }; x.cents += P.net(inv); x.jobs += 1; m.set(k, x); }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.cents - a.cents);
  };
  const byClientType = groupSum((i) => P.clients.get(i.client_id)?.client_type);
  const byLeadSource = groupSum((i) => P.clients.get(i.client_id)?.lead_source);
  const catMap = new Map();
  for (const inv of P.invoices) for (const l of P.linesByDoc.get(inv.id) || []) {
    const k = l.category || 'unknown'; const x = catMap.get(k) || { cents: 0, jobs: new Set() };
    x.cents += l.amount_cents || 0; x.jobs.add(inv.id); catMap.set(k, x);
  }
  const byCategory = [...catMap.entries()].map(([key, v]) => ({ key, label: key === 'unknown' ? 'Uncategorised' : label(P, key), cents: v.cents, jobs: v.jobs.size }))
    .sort((a, b) => b.cents - a.cents);

  const decided = P.quotes.filter((q) => WON.has(q.status) || q.status === 'declined');
  const won = decided.filter((q) => WON.has(q.status));
  const winBy = (keysOf) => {
    const m = new Map();
    for (const q of decided) for (const k of new Set(keysOf(q))) { const x = m.get(k) || { won: 0, total: 0 }; x.total++; if (WON.has(q.status)) x.won++; m.set(k, x); }
    return [...m.entries()].map(([key, v]) => ({ key, ...v, rate: pct(v.won, v.total) })).sort((a, b) => b.total - a.total);
  };
  const lostReasons = countBy(decided.filter((q) => q.status === 'declined'), (q) => q.lost_reason || 'not recorded');
  const payDays = P.invoices.filter((i) => i.status === 'paid' && i.fully_paid_on).map((i) => Math.max(0, daysBetween(i.issue_date, i.fully_paid_on)));

  const E = P.enquiries;
  const months = new Map();
  for (const inv of P.invoices) { const k = String(inv.issue_date).slice(0, 7); months.set(k, (months.get(k) || 0) + P.net(inv)); }

  const missingType = [...P.clients.values()].filter((c) => !c.client_type).length;
  const missingSource = [...P.clients.values()].filter((c) => !c.lead_source).length;
  const allLines = [...P.linesByDoc.values()].flat();
  const uncategorised = allLines.filter((l) => !l.category).length;

  return {
    counts: { clients: P.clients.size, buyers, invoices: P.invoices.length, quotesIssued: P.quotes.length, decided: decided.length, enquiries: E.length },
    repeatRate: pct(repeaters, buyers), repeaters,
    revenueNet: sum(P.invoices.map(P.net)),
    avgJobNet: P.invoices.length ? Math.round(mean(P.invoices.map(P.net))) : 0,
    medianDaysToPay: median(payDays),
    winRate: pct(won.length, decided.length),
    winByCategory: winBy((q) => (P.linesByDoc.get(q.id) || []).map((l) => l.category || 'unknown')).map((x) => ({ ...x, label: x.key === 'unknown' ? 'Uncategorised' : label(P, x.key) })),
    winByClientType: winBy((q) => [P.clients.get(q.client_id)?.client_type || 'unknown']),
    byClientType, byLeadSource, byCategory, lostReasons,
    enquiriesBySource: countBy(E, (e) => e.source),
    enquiriesByCategory: countBy(E, (e) => (e.category ? label(P, e.category) : 'Unclassified')),
    turnedAway: countBy(E.filter((e) => e.status === 'turned_away'), (e) => e.turned_away_reason || 'not recorded'),
    turnedAwayByCategory: countBy(E.filter((e) => e.status === 'turned_away'), (e) => (e.category ? label(P, e.category) : 'Unclassified')),
    enquiryToQuote: pct(E.filter((e) => e.status === 'quoted').length, E.filter((e) => e.status !== 'new').length),
    monthly: [...months.entries()].sort().map(([month, cents]) => ({ month, cents })),
    dataQuality: { missingType, missingSource, uncategorised, lines: allLines.length,
      undecidedOld: P.quotes.filter((q) => q.status === 'sent' && q.due_date && q.due_date < P.today).length },
  };
}
function countBy(rows, keyOf) {
  const m = new Map(); for (const r of rows) { const k = keyOf(r); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

/* ════════════════════════ 2. segments: RFM + k-means ════════════════════════ */
export function rfmTable(data) {
  const P = prepare(data);
  const m = new Map();
  for (const inv of P.invoices) {
    if (!inv.client_id) continue;
    const x = m.get(inv.client_id) || { client_id: inv.client_id, last: inv.issue_date, first: inv.issue_date, frequency: 0, monetary: 0, cats: new Map() };
    x.frequency++; x.monetary += P.net(inv);
    if (inv.issue_date > x.last) x.last = inv.issue_date;
    if (inv.issue_date < x.first) x.first = inv.issue_date;
    for (const l of P.linesByDoc.get(inv.id) || []) if (l.category) x.cats.set(l.category, (x.cats.get(l.category) || 0) + (l.amount_cents || 0));
    m.set(inv.client_id, x);
  }
  const rows = [...m.values()].map((x) => ({ ...x, recencyDays: daysBetween(x.last, P.today),
    client: P.clients.get(x.client_id), topCategory: [...x.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null }));
  // 1-5 scores by rank (ties share the average rank)
  const score = (vals, higherIsBetter) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(vals.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const r = (i + j) / 2; for (let k = i; k <= j; k++) ranks[idx[k][1]] = r; i = j + 1; }
    return ranks.map((r) => { const q = vals.length > 1 ? r / (vals.length - 1) : 0.5; const s = 1 + Math.min(4, Math.floor(q * 5)); return higherIsBetter ? s : 6 - s; });
  };
  const R = score(rows.map((r) => r.recencyDays), false);
  const F = score(rows.map((r) => r.frequency), true);
  const M = score(rows.map((r) => r.monetary), true);
  rows.forEach((r, i) => { r.R = R[i]; r.F = r.frequency === 1 ? 1 : F[i]; r.M = M[i]; r.segment = rfmSegment(r); });
  return rows;
}
export function rfmSegment({ R, F, M, frequency }) {
  if (frequency >= 2 && F >= 4 && R >= 4) return 'Champions';
  if (frequency >= 2 && F >= 3 && R <= 2) return 'Regulars at risk';
  if (frequency >= 2 && F >= 3) return 'Loyal';
  if (R >= 4 && frequency <= 2) return 'New or recent';
  if (M >= 4) return 'Big one-off spenders';
  return 'One-off / dormant';
}

export function kmeans(points, k, { seed = 7, restarts = 6, iters = 100, cosine = false } = {}) {
  const n = points.length; const dim = points[0].length;
  const dist = cosine ? (a, b) => 1 - dot(a, b) : (a, b) => { let s = 0; for (let i = 0; i < dim; i++) s += (a[i] - b[i]) ** 2; return s; };
  const r = rng(seed); let best = null;
  for (let rs = 0; rs < restarts; rs++) {
    // k-means++ seeding
    const cents = [points[Math.floor(r() * n)].slice()];
    while (cents.length < k) {
      const d = points.map((p) => Math.min(...cents.map((c) => dist(p, c))));
      const tot = sum(d); let t = r() * tot; let i = 0;
      if (tot === 0) { cents.push(points[Math.floor(r() * n)].slice()); continue; }
      while (t > d[i] && i < n - 1) { t -= d[i]; i++; }
      cents.push(points[i].slice());
    }
    let assign = new Array(n).fill(-1);
    for (let it = 0; it < iters; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let bi = 0; let bd = Infinity;
        for (let c = 0; c < k; c++) { const dd = dist(points[i], cents[c]); if (dd < bd) { bd = dd; bi = c; } }
        if (assign[i] !== bi) { assign[i] = bi; moved = true; }
      }
      for (let c = 0; c < k; c++) {
        const members = points.filter((_, i) => assign[i] === c);
        if (!members.length) continue;
        const cen = new Array(dim).fill(0);
        for (const p of members) for (let j = 0; j < dim; j++) cen[j] += p[j] / members.length;
        cents[c] = cosine ? normalise(cen) : cen;
      }
      if (!moved) break;
    }
    const inertia = sum(points.map((p, i) => dist(p, cents[assign[i]])));
    if (!best || inertia < best.inertia) best = { assign, centroids: cents, inertia };
  }
  return best;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const normalise = (v) => { const n = Math.sqrt(dot(v, v)) || 1; return v.map((x) => x / n); };

export function silhouette(points, assign, cosine = false) {
  const dist = cosine ? (a, b) => 1 - dot(a, b) : (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
  const ks = [...new Set(assign)]; if (ks.length < 2) return -1;
  const s = points.map((p, i) => {
    const own = points.filter((_, j) => j !== i && assign[j] === assign[i]);
    if (!own.length) return 0;
    const a = mean(own.map((q) => dist(p, q)));
    const b = Math.min(...ks.filter((c) => c !== assign[i]).map((c) => mean(points.filter((_, j) => assign[j] === c).map((q) => dist(p, q)))));
    return (b - a) / Math.max(a, b);
  });
  return mean(s);
}

export function segments(data, { force = false } = {}) {
  const P = prepare(data);
  const rows = rfmTable(data);
  const need = THRESHOLDS.segments;
  const status = progress([[rows.length, need.clients, 'clients who have paid'], [P.invoices.length, need.invoices, 'invoices']]);
  if (!status.ready && !force) return { ready: false, ...status, rfm: rows };
  const feats = rows.map((r) => [Math.log1p(r.recencyDays), Math.log1p(r.frequency), Math.log1p(r.monetary / 100)]);
  const mu = [0, 1, 2].map((j) => mean(feats.map((f) => f[j]))); const sd = [0, 1, 2].map((j) => std(feats.map((f) => f[j])));
  const Z = feats.map((f) => f.map((v, j) => (v - mu[j]) / sd[j]));
  let best = null;
  for (let k = 2; k <= Math.min(5, rows.length - 1); k++) {
    const km = kmeans(Z, k); const s = silhouette(Z, km.assign);
    if (!best || s > best.silhouette) best = { k, silhouette: s, ...km };
  }
  const groups = [];
  for (let c = 0; c < best.k; c++) {
    const members = rows.filter((_, i) => best.assign[i] === c);
    if (!members.length) continue;
    const z = best.centroids[c];
    const types = countBy(members, (m) => m.client?.client_type || 'unknown');
    const cats = countBy(members.filter((m) => m.topCategory), (m) => label(P, m.topCategory));
    groups.push({
      size: members.length,
      revenueShare: pct(sum(members.map((m) => m.monetary)), sum(rows.map((m) => m.monetary))),
      description: [z[1] > 0.5 ? 'buy often' : z[1] < -0.5 ? 'buy once or rarely' : 'buy occasionally',
        z[2] > 0.5 ? 'spend a lot' : z[2] < -0.5 ? 'small jobs' : 'mid-sized jobs',
        z[0] < -0.5 ? 'bought recently' : z[0] > 0.5 ? 'not seen for a while' : 'moderately recent'].join(', '),
      medianRecencyDays: median(members.map((m) => m.recencyDays)), medianFrequency: median(members.map((m) => m.frequency)),
      medianSpend: median(members.map((m) => m.monetary)),
      mainClientType: types[0]?.key, mainCategory: cats[0]?.key || null,
      clients: members.map((m) => ({ id: m.client_id, name: m.client?.name || '', segment: m.segment })),
    });
  }
  groups.sort((a, b) => b.revenueShare - a.revenueShare);
  return { ready: true, ...status, rfm: rows, k: best.k, silhouette: Math.round(best.silhouette * 100) / 100,
    reliable: best.silhouette >= 0.35, groups };
}

/* ════════════════════════ 3. bundles: Apriori ════════════════════════ */
export function apriori(transactions, { minCount = 3, minConfidence = 0.5, minLift = 1.2, maxSize = 3 } = {}) {
  const N = transactions.length; const sets = transactions.map((t) => [...new Set(t)].sort());
  const count = new Map(); const key = (a) => a.join('|');
  let level = [];
  const c1 = new Map(); for (const t of sets) for (const i of t) c1.set(i, (c1.get(i) || 0) + 1);
  for (const [i, c] of c1) if (c >= minCount) { count.set(i, c); level.push([i]); }
  for (let size = 2; size <= maxSize && level.length; size++) {
    const cands = new Map();
    for (let a = 0; a < level.length; a++) for (let b = a + 1; b < level.length; b++) {
      const u = [...new Set([...level[a], ...level[b]])].sort();
      if (u.length === size) cands.set(key(u), u);
    }
    const next = [];
    for (const [k, items] of cands) {
      const c = sets.filter((t) => items.every((i) => t.includes(i))).length;
      if (c >= minCount) { count.set(k, c); next.push(items); }
    }
    level = next;
  }
  const rules = [];
  for (const [k, c] of count) {
    const items = k.split('|'); if (items.length < 2) continue;
    for (let r = 0; r < items.length; r++) {
      const cons = items[r]; const ante = items.filter((_, i) => i !== r);
      const ca = count.get(key(ante)); const cc = count.get(cons);
      const conf = c / ca; const lift = conf / (cc / N);
      if (conf >= minConfidence && lift >= minLift) rules.push({ if: ante, then: cons, support: c / N, count: c, confidence: conf, lift });
    }
  }
  return rules.sort((a, b) => b.lift * b.confidence - a.lift * a.confidence);
}

export function bundles(data) {
  const P = prepare(data);
  const jobs = [...P.invoices, ...P.quotes.filter((q) => WON.has(q.status) && !P.invoices.some((i) => i.source_quote_id === q.id))]
    .map((d) => (P.linesByDoc.get(d.id) || []).map((l) => l.category).filter((c) => c && c !== 'delivery' && c !== 'other'))
    .filter((t) => t.length);
  // unlock on mixed jobs, but measure support/confidence over ALL jobs: counting only
  // mixed jobs would make every pairing look near-certain (selection bias)
  const mixed = jobs.filter((t) => new Set(t).size >= 2).length;
  const status = progress([[mixed, THRESHOLDS.bundles.jobs, 'jobs with two or more kinds of work']]);
  if (!status.ready) return { ready: false, ...status };
  const rules = apriori(jobs, { minCount: Math.max(3, Math.ceil(jobs.length * 0.03)) }).slice(0, 10)
    .map((r) => ({ ...r, ifLabel: r.if.map((i) => label(P, i)), thenLabel: label(P, r.then) }));
  return { ready: true, ...status, jobs: jobs.length, mixed, rules };
}

/* ════════════════════════ 4. themes: TF-IDF + spherical k-means ════════════════════════ */
const STOP = new Set(('a an and are as at be by for from has have in into is it its of on or our per the this to was were will with your you we us '
  + 'x qty unit units each pcs pc mm cm m kg g hour hours hr hrs day days item items job service services quote invoice please need want '
  + 'can could would also new one two three set sets including incl approx etc rand r vat total amount').split(/\s+/));
export function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}
export function tfidf(texts, { minDf = 2, maxTerms = 400 } = {}) {
  const toks = texts.map(tokenize);
  const df = new Map(); for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const vocab = [...df.entries()].filter(([, d]) => d >= minDf && d < texts.length * 0.8).sort((a, b) => b[1] - a[1]).slice(0, maxTerms).map(([w]) => w);
  const index = new Map(vocab.map((w, i) => [w, i]));
  const idf = vocab.map((w) => Math.log((1 + texts.length) / (1 + df.get(w))) + 1);
  const vectors = toks.map((t) => {
    const v = new Array(vocab.length).fill(0);
    for (const w of t) if (index.has(w)) v[index.get(w)] += 1;
    return normalise(v.map((x, i) => (x ? (1 + Math.log(x)) * idf[i] : 0)));
  });
  return { vocab, vectors };
}

export function themes(data) {
  const P = prepare(data);
  const items = [];
  for (const q of P.quotes) for (const l of P.linesByDoc.get(q.id) || []) {
    if (l.category === 'delivery') continue;
    items.push({ text: `${l.name} ${l.description}`, kind: 'quote', won: WON.has(q.status), decided: WON.has(q.status) || q.status === 'declined', cents: l.amount_cents || 0 });
  }
  for (const e of P.enquiries) if (e.message) items.push({ text: e.message, kind: 'enquiry', turnedAway: e.status === 'turned_away', cents: 0 });
  const status = progress([[items.length, THRESHOLDS.themes.texts, 'quote lines and enquiries']]);
  if (!status.ready) return { ready: false, ...status };
  const { vocab, vectors } = tfidf(items.map((i) => i.text));
  const keep = vectors.map((v, i) => i).filter((i) => vectors[i].some((x) => x));
  if (keep.length < 10 || vocab.length < 5) return { ready: false, ...status, note: 'Not enough repeated wording yet' };
  const X = keep.map((i) => vectors[i]);
  let best = null;
  for (let k = 2; k <= Math.min(8, Math.floor(X.length / 5)); k++) {
    const km = kmeans(X, k, { cosine: true, restarts: 4 }); const s = silhouette(X, km.assign, true);
    if (!best || s > best.s) best = { k, s, ...km };
  }
  const out = [];
  for (let c = 0; c < best.k; c++) {
    const idx = keep.filter((_, j) => best.assign[j] === c); if (idx.length < 3) continue;
    const terms = best.centroids[c].map((w, i) => [vocab[i], w]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
    const rows = idx.map((i) => items[i]);
    const decided = rows.filter((r) => r.kind === 'quote' && r.decided);
    out.push({ terms, size: rows.length, quoteLines: rows.filter((r) => r.kind === 'quote').length,
      enquiries: rows.filter((r) => r.kind === 'enquiry').length, turnedAway: rows.filter((r) => r.turnedAway).length,
      winRate: decided.length >= 3 ? pct(decided.filter((r) => r.won).length, decided.length) : null,
      quotedCents: sum(rows.map((r) => r.cents)), examples: rows.slice(0, 3).map((r) => r.text.slice(0, 90)) });
  }
  out.sort((a, b) => b.size - a.size);
  return { ready: true, ...status, k: best.k, quality: Math.round(best.s * 100) / 100, themes: out };
}

/* ════════════════════════ 5. retention: BG/NBD + Gamma-Gamma ════════════════════════ */
// Fader, Hardie & Lee (2005) "Counting your customers the easy way" - BG/NBD
export function bgnbdLogLik([r, alpha, a, b], rows) {
  let ll = 0;
  for (const { x, tx, T } of rows) {
    const A1 = lgamma(r + x) - lgamma(r) + r * Math.log(alpha);
    const A2 = lgamma(a + b) + lgamma(b + x) - lgamma(b) - lgamma(a + b + x);
    const A3 = -(r + x) * Math.log(alpha + T);
    ll += A1 + A2 + (x > 0 ? logSumExp(A3, Math.log(a) - Math.log(b + x - 1) - (r + x) * Math.log(alpha + tx)) : A3);
  }
  return ll;
}
export function fitBgnbd(rows) {
  const f = (p) => { const q = p.map(Math.exp); const v = -bgnbdLogLik(q, rows); return Number.isFinite(v) ? v : 1e12; };
  let best = null;
  for (const start of [[0, 0, 0, 0], [Math.log(0.25), Math.log(4), Math.log(0.8), Math.log(2.5)], [Math.log(1), Math.log(10), 0, Math.log(5)]]) {
    const res = nelderMead(f, start, { maxIter: 4000, tol: 1e-10 });
    if (!best || res.fx < best.fx) best = res;
  }
  const [r, alpha, a, b] = best.x.map(Math.exp);
  return { r, alpha, a, b, ll: -best.fx };
}
export function pAlive({ r, alpha, a, b }, { x, tx, T }) {
  if (x === 0) return 1;
  return 1 / (1 + (a / (b + x - 1)) * ((alpha + T) / (alpha + tx)) ** (r + x));
}
export function expectedPurchases({ r, alpha, a, b }, { x, tx, T }, t) {
  const z = t / (alpha + T + t);
  const num = ((a + b + x - 1) / (a - 1)) * (1 - ((alpha + T) / (alpha + T + t)) ** (r + x) * hyp2f1(r + x, b + x, a + b + x - 1, z));
  const den = 1 + (x > 0 ? (a / (b + x - 1)) * ((alpha + T) / (alpha + tx)) ** (r + x) : 0);
  return num / den;
}
// Fader, Hardie & Lee (2005) Gamma-Gamma spend model
export function fitGammaGamma(rows) { // rows: { x: repeat count >= 1, m: average value }
  const ll = ([p, q, g]) => sum(rows.map(({ x, m }) => lgamma(p * x + q) - lgamma(p * x) - lgamma(q) + q * Math.log(g)
    + (p * x - 1) * Math.log(m) + p * x * Math.log(x) - (p * x + q) * Math.log(g + m * x)));
  const f = (v) => { const p = v.map(Math.exp); const r = -ll(p); return Number.isFinite(r) ? r : 1e12; };
  let best = null;
  for (const s of [[0, 0, 0], [Math.log(5), Math.log(3), Math.log(Math.max(1, median(rows.map((r) => r.m))))]]) {
    const res = nelderMead(f, s, { maxIter: 4000, tol: 1e-10 }); if (!best || res.fx < best.fx) best = res;
  }
  const [p, q, gamma] = best.x.map(Math.exp);
  return { p, q, gamma };
}
export const expectedValue = ({ p, q, gamma }, { x, m }) => (q > 1 ? (p * (gamma + x * m)) / (p * x + q - 1) : m);

/** Per-client purchase history (weeks) from issued invoices: x = repeat purchases on distinct days. */
export function customerHistories(data) {
  const P = prepare(data);
  const byClient = new Map();
  for (const inv of P.invoices) {
    if (!inv.client_id) continue;
    const e = byClient.get(inv.client_id) || new Map();
    e.set(inv.issue_date, (e.get(inv.issue_date) || 0) + P.net(inv));
    byClient.set(inv.client_id, e);
  }
  return [...byClient.entries()].map(([id, days]) => {
    const dates = [...days.keys()].sort(); const first = dates[0]; const last = dates[dates.length - 1];
    const values = dates.map((d) => days.get(d));
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d) / 7);
    return { client_id: id, client: P.clients.get(id), x: dates.length - 1, tx: daysBetween(first, last) / 7, T: Math.max(daysBetween(first, P.today) / 7, 1e-6),
      m: values.length > 1 ? mean(values.slice(1)) : values[0], firstValue: values[0], medianGapWeeks: gaps.length ? median(gaps) : null };
  });
}

export function retention(data, { horizonWeeks = 26 } = {}) {
  const H = customerHistories(data);
  const repeat = H.filter((h) => h.x >= 1);
  const span = H.length ? Math.max(...H.map((h) => h.T)) : 0;
  const status = progress([[repeat.length, THRESHOLDS.retention.repeatClients, 'clients who came back at least once'],
    [Math.floor(span), THRESHOLDS.retention.weeks, 'weeks of history']]);
  if (!status.ready) return { ready: false, ...status };
  const bg = fitBgnbd(H);
  const gg = repeat.length >= 5 ? fitGammaGamma(repeat.map((h) => ({ x: h.x, m: Math.max(1, h.m) }))) : null;
  const clients = H.map((h) => {
    const alive = pAlive(bg, h);
    const orders = expectedPurchases(bg, h, horizonWeeks);
    const value = gg && h.x >= 1 ? expectedValue(gg, { x: h.x, m: Math.max(1, h.m) }) : h.firstValue;
    const weeksSinceLast = h.T - h.tx;
    // individual check: a regular (3+ orders) now far past their own usual gap between orders
    const overdue = h.x >= 2 && h.medianGapWeeks !== null && weeksSinceLast > Math.max(4 * h.medianGapWeeks, 16);
    return { id: h.client_id, name: h.client?.name || '', clientType: h.client?.client_type || null, purchases: h.x + 1,
      weeksSinceLast: Math.round(weeksSinceLast), usualGapWeeks: h.medianGapWeeks === null ? null : Math.round(h.medianGapWeeks * 10) / 10,
      overdue, pAlive: alive, expectedOrders: orders, expectedValueCents: Math.round(orders * value) };
  });
  const drifting = clients.filter((c) => c.purchases >= 2 && (c.pAlive < 0.5 || c.overdue)).sort((a, b) => b.purchases - a.purchases);
  // BG/NBD needs some observed drop-out to estimate it; say so when it has seen almost none
  const dropoutMeasured = bg.a / (bg.a + bg.b) > 1e-3;
  const likely = clients.filter((c) => c.pAlive >= 0.5).sort((a, b) => b.expectedValueCents - a.expectedValueCents);
  return { ready: true, ...status, horizonWeeks, params: bg, spend: gg, clients, drifting, likely, dropoutMeasured,
    expectedRevenueCents: Math.round(sum(clients.map((c) => c.expectedValueCents))) };
}

/* ════════════════════════ 6. quote win model: logistic regression ════════════════════════ */
function solve(A, b) { // Gaussian elimination with partial pivoting
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
/** L2-regularised logistic regression by Newton/IRLS. X rows without intercept; intercept is not penalised. */
export function logisticFit(X, y, { lambda = 1, iters = 50 } = {}) {
  const d = X[0].length + 1; let w = new Array(d).fill(0);
  const Xi = X.map((r) => [1, ...r]);
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0); const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < Xi.length; i++) {
      const p = sigmoid(dot(w, Xi[i])); const s = p * (1 - p);
      for (let j = 0; j < d; j++) { g[j] += (p - y[i]) * Xi[i][j]; for (let k = 0; k < d; k++) H[j][k] += s * Xi[i][j] * Xi[i][k]; }
    }
    for (let j = 1; j < d; j++) { g[j] += lambda * w[j]; H[j][j] += lambda; }
    const step = solve(H, g); w = w.map((v, j) => v - step[j]);
    if (Math.sqrt(dot(step, step)) < 1e-8) break;
  }
  return w;
}
export const logisticPredict = (w, x) => sigmoid(dot(w, [1, ...x]));

export function winModel(data) {
  const P = prepare(data);
  const decided = P.quotes.filter((q) => WON.has(q.status) || q.status === 'declined');
  const nWon = decided.filter((q) => WON.has(q.status)).length; const nLost = decided.length - nWon;
  const status = progress([[decided.length, THRESHOLDS.winModel.decided, 'won or lost quotes'],
    [Math.min(nWon, nLost), THRESHOLDS.winModel.minEach, 'quotes in the smaller of won / lost']]);
  if (!status.ready) return { ready: false, ...status };

  const priorInvoice = (q) => P.invoices.some((i) => i.client_id === q.client_id && i.issue_date < q.issue_date);
  const catsOf = (q) => new Set((P.linesByDoc.get(q.id) || []).map((l) => l.category).filter(Boolean));
  const common = (vals) => countBy(vals.filter(Boolean).map((v) => ({ v })), (r) => r.v).filter((c) => c.n >= 8).map((c) => c.key);
  const cats = common(decided.flatMap((q) => [...catsOf(q)])).slice(0, 6);
  const types = common(decided.map((q) => P.clients.get(q.client_id)?.client_type)).slice(0, 5);
  const names = ['Quote size (log)', 'Repeat client', 'Deposit asked', 'Discount given', ...cats.map((c) => `Includes ${label(P, c)}`), ...types.map((t) => `Client type: ${t}`)];
  const raw = (q) => [Math.log1p((q.total_cents || 0) / 100), priorInvoice(q) ? 1 : 0, q.deposit_type !== 'none' ? 1 : 0, (q.discount_cents || 0) > 0 ? 1 : 0,
    ...cats.map((c) => (catsOf(q).has(c) ? 1 : 0)), ...types.map((t) => (P.clients.get(q.client_id)?.client_type === t ? 1 : 0))];
  const R = decided.map(raw); const y = decided.map((q) => (WON.has(q.status) ? 1 : 0));
  const mu = names.map((_, j) => mean(R.map((r) => r[j]))); const sd = names.map((_, j) => std(R.map((r) => r[j])));
  const scale = (r) => r.map((v, j) => (v - mu[j]) / sd[j]);
  const X = R.map(scale);

  // 5-fold cross-validation (deterministic shuffle) vs always guessing the majority
  const order = X.map((_, i) => i); const rr = rng(11);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let correct = 0;
  for (let f = 0; f < 5; f++) {
    const test = order.filter((_, i) => i % 5 === f); const train = order.filter((_, i) => i % 5 !== f);
    const w = logisticFit(train.map((i) => X[i]), train.map((i) => y[i]));
    for (const i of test) correct += (logisticPredict(w, X[i]) >= 0.5 ? 1 : 0) === y[i] ? 1 : 0;
  }
  const accuracy = correct / X.length; const baseline = Math.max(nWon, nLost) / X.length;
  const w = logisticFit(X, y);
  const effects = names.map((n, j) => ({ feature: n, oddsRatio: Math.exp(w[j + 1]), weight: w[j + 1] }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const open = P.quotes.filter((q) => q.status === 'sent').map((q) => ({ id: q.id, client: P.clients.get(q.client_id)?.name || '', totalCents: q.total_cents,
    probability: logisticPredict(w, scale(raw(q))) })).sort((a, b) => b.probability * b.totalCents - a.probability * a.totalCents);
  return { ready: true, ...status, n: X.length, accuracy, baseline, reliable: accuracy >= baseline + 0.05, effects, open,
    expectedOpenValueCents: Math.round(sum(open.map((o) => o.probability * o.totalCents))) };
}

/* ════════════════════════ 7. forecast: Holt-Winters ════════════════════════ */
export function holtWinters(series, season = 12, horizon = 6) {
  if (series.length < 2 * season) throw new Error('need two full seasons');
  // classical initialisation: trend from the difference of the first two seasons; the first
  // season's mean sits at its middle, so back the level off to just before t = 0
  const trend0 = (mean(series.slice(season, 2 * season)) - mean(series.slice(0, season))) / season;
  const level0 = mean(series.slice(0, season)) - trend0 * (season + 1) / 2;
  const S0 = series.slice(0, season).map((v, i) => v - (level0 + trend0 * (i + 1)));
  const run = (al, be, ga) => {
    let level = level0; let trend = trend0; const S = S0.slice();
    let sse = 0;
    for (let t = 0; t < series.length; t++) {
      const f = level + trend + S[t % season];
      if (t >= season) sse += (series[t] - f) ** 2;
      const prevLevel = level;
      level = al * (series[t] - S[t % season]) + (1 - al) * (level + trend);
      trend = be * (level - prevLevel) + (1 - be) * trend;
      S[t % season] = ga * (series[t] - level) + (1 - ga) * S[t % season];
    }
    return { sse, level, trend, S };
  };
  let best = null; const grid = [0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9];
  for (const al of grid) for (const be of [0.01, 0.05, 0.1, 0.2, 0.4]) for (const ga of grid) {
    const r = run(al, be, ga); if (!best || r.sse < best.sse) best = { ...r, al, be, ga };
  }
  const n = series.length;
  const forecast = Array.from({ length: horizon }, (_, h) => best.level + (h + 1) * best.trend + best.S[(n + h) % season]);
  return { forecast, seasonal: best.S, params: { alpha: best.al, beta: best.be, gamma: best.ga }, rmse: Math.sqrt(best.sse / (n - season)) };
}

export function forecast(data, { horizon = 6 } = {}) {
  const P = prepare(data);
  if (!P.invoices.length) return { ready: false, ...progress([[0, THRESHOLDS.forecast.months, 'months of invoicing history']]) };
  const firstMonth = P.invoices.map((i) => String(i.issue_date).slice(0, 7)).sort()[0];
  const lastFull = monthAdd(String(P.today).slice(0, 7), -1);
  const months = []; for (let m = firstMonth; m <= lastFull; m = monthAdd(m, 1)) months.push(m);
  const status = progress([[months.length, THRESHOLDS.forecast.months, 'full months of invoicing history']]);
  if (!status.ready) return { ready: false, ...status };
  const totals = new Map(months.map((m) => [m, 0]));
  for (const inv of P.invoices) { const k = String(inv.issue_date).slice(0, 7); if (totals.has(k)) totals.set(k, totals.get(k) + P.net(inv)); }
  const series = months.map((m) => totals.get(m));
  const hw = holtWinters(series, 12, horizon);
  const next = Array.from({ length: horizon }, (_, h) => ({ month: monthAdd(lastFull, h + 1), cents: Math.max(0, Math.round(hw.forecast[h])) }));
  // seasonal slot j applies to every series index i with i % 12 === j, i.e. the calendar month of months[j]
  const sorted = hw.seasonal.map((v, j) => [Number(months[j].slice(5)), v]).sort((a, b) => b[1] - a[1]);
  return { ready: true, ...status, next, busiest: sorted.slice(0, 2).map((x) => x[0]), quietest: sorted.slice(-2).map((x) => x[0]), rmseCents: Math.round(hw.rmse) };
}
function monthAdd(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); }

/* ════════════════════════ shared ════════════════════════ */
function progress(reqs) {
  const items = reqs.map(([have, need, what]) => ({ have, need, what, missing: Math.max(0, need - have) }));
  return { ready: items.every((i) => i.missing === 0), requirements: items,
    progress: Math.min(1, Math.min(...items.map((i) => (i.need ? i.have / i.need : 1)))) };
}

/** Run every model; never throws (a broken model must not break the page). */
export function runAll(data) {
  const safe = (fn) => { try { return fn(data); } catch (e) { return { ready: false, error: e.message, requirements: [] }; } };
  return { descriptive: safe(descriptive), segments: safe(segments), bundles: safe(bundles), themes: safe(themes),
    retention: safe(retention), winModel: safe(winModel), forecast: safe(forecast) };
}
