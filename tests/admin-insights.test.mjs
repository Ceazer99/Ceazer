// Insights models: correctness on synthetic data with known answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rng, lgamma, hyp2f1, nelderMead, kmeans, silhouette, apriori, tokenize, tfidf, fitBgnbd, bgnbdLogLik, pAlive,
  expectedPurchases, fitGammaGamma, expectedValue, logisticFit, logisticPredict, holtWinters, rfmSegment,
  descriptive, segments, bundles, themes, retention, winModel, forecast, runAll, THRESHOLDS,
} from '../admin/js/insights.js';
import { makeBusiness } from './helpers/insights-fixture.mjs';

/* random variates */
function gamma(r, shape, rate) { // Marsaglia-Tsang
  if (shape < 1) return gamma(r, shape + 1, rate) * r() ** (1 / shape);
  const d = shape - 1 / 3; const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x; let v;
    do { const u1 = r(); const u2 = r(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v ** 3; const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return (d * v) / rate;
  }
}
const beta = (r, a, b) => { const x = gamma(r, a, 1); return x / (x + gamma(r, b, 1)); };

test('numeric helpers: lgamma, 2F1, Nelder-Mead', () => {
  assert.ok(Math.abs(lgamma(5) - Math.log(24)) < 1e-10);
  assert.ok(Math.abs(lgamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-10);
  assert.ok(Math.abs(hyp2f1(1, 1, 2, 0.5) - (-Math.log(0.5) / 0.5)) < 1e-9); // 2F1(1,1;2;z) = -ln(1-z)/z
  const { x } = nelderMead(([a, b]) => (a - 3) ** 2 + (b + 1) ** 2 + 1, [0, 0]);
  assert.ok(Math.abs(x[0] - 3) < 1e-3 && Math.abs(x[1] + 1) < 1e-3);
});

test('k-means + silhouette find three well-separated groups', () => {
  const r = rng(3); const pts = [];
  for (const [cx, cy] of [[0, 0], [6, 6], [0, 8]]) for (let i = 0; i < 30; i++) pts.push([cx + r() - 0.5, cy + r() - 0.5]);
  const scores = [2, 3, 4, 5].map((k) => silhouette(pts, kmeans(pts, k).assign));
  assert.equal(scores.indexOf(Math.max(...scores)) + 2, 3);
  const { assign } = kmeans(pts, 3);
  for (let g = 0; g < 3; g++) assert.equal(new Set(assign.slice(g * 30, g * 30 + 30)).size, 1, 'each blob is one cluster');
});

test('Apriori finds the real "bought together" rule and ignores coincidences', () => {
  const r = rng(5); const tx = [];
  for (let i = 0; i < 200; i++) {
    const t = [];
    if (r() < 0.5) { t.push('cad'); if (r() < 0.85) t.push('fdm_printing'); }
    if (r() < 0.3) t.push('finishing');
    if (r() < 0.2) t.push('drawings');
    tx.push(t);
  }
  const rules = apriori(tx, { minCount: 5 });
  const top = rules.find((x) => x.if.join() === 'cad' && x.then === 'fdm_printing');
  assert.ok(top, 'cad -> fdm_printing found');
  assert.ok(top.confidence > 0.75 && top.lift > 1.3);
  assert.ok(!rules.some((x) => x.then === 'drawings' && x.if.join() === 'finishing'), 'independent items produce no rule');
});

test('TF-IDF themes: tokenizer and clustering separate distinct kinds of work', () => {
  assert.deepEqual(tokenize('3D printing 12x Safety-Boots, 200mm parts!'), ['printing', '12x', 'safety', 'boot', '200mm', 'part']);
  const topics = [['gear', 'replacement', 'tractor', 'bushing'], ['enclosure', 'prototype', 'electronic', 'housing'], ['jig', 'fixture', 'drill', 'guide']];
  const r = rng(9); const texts = [];
  for (let i = 0; i < 120; i++) { const t = topics[i % 3]; texts.push(`${t[Math.floor(r() * 4)]} ${t[Math.floor(r() * 4)]} ${t[Math.floor(r() * 4)]} part`); }
  const { vectors } = tfidf(texts);
  const km = kmeans(vectors, 3, { cosine: true });
  for (let g = 0; g < 3; g++) {
    const members = km.assign.filter((_, i) => i % 3 === g);
    const majority = Math.max(...[0, 1, 2].map((c) => members.filter((x) => x === c).length));
    assert.ok(majority / members.length > 0.9, `topic ${g} kept together`);
  }
});

test('BG/NBD recovers known parameters from simulated customers; P(alive) behaves sensibly', () => {
  const truth = { r: 0.6, alpha: 6, a: 0.9, b: 3 }; const r = rng(21); const rows = [];
  for (let i = 0; i < 3000; i++) {
    const lam = gamma(r, truth.r, truth.alpha); const p = beta(r, truth.a, truth.b); const T = 52;
    let t = 0; let x = 0; let tx = 0;
    for (;;) {
      t += -Math.log(r()) / lam; if (t > T) break;
      x++; tx = t; if (r() < p) break;
    }
    rows.push({ x, tx, T });
  }
  const fit = fitBgnbd(rows);
  assert.ok(bgnbdLogLik([fit.r, fit.alpha, fit.a, fit.b], rows) >= bgnbdLogLik([truth.r, truth.alpha, truth.a, truth.b], rows) - 1e-6, 'MLE beats the truth on its own sample');
  assert.ok(Math.abs(fit.r / fit.alpha - truth.r / truth.alpha) / (truth.r / truth.alpha) < 0.2, `purchase rate r/alpha ${fit.r / fit.alpha}`);
  assert.ok(Math.abs(fit.a / (fit.a + fit.b) - truth.a / (truth.a + truth.b)) < 0.08, `dropout ${fit.a / (fit.a + fit.b)}`);
  // someone who bought often but not for a long time is less likely alive than someone who just bought
  assert.ok(pAlive(fit, { x: 6, tx: 10, T: 52 }) < pAlive(fit, { x: 6, tx: 50, T: 52 }));
  assert.ok(expectedPurchases(fit, { x: 6, tx: 50, T: 52 }, 26) > expectedPurchases(fit, { x: 1, tx: 5, T: 52 }, 26));
});

test('Gamma-Gamma recovers average spend', () => {
  const truth = { p: 6, q: 4, gamma: 20 }; const r = rng(4); const rows = [];
  for (let i = 0; i < 1500; i++) {
    const nu = gamma(r, truth.q, truth.gamma); const x = 1 + Math.floor(r() * 6);
    let s = 0; for (let j = 0; j < x; j++) s += gamma(r, truth.p, nu);
    rows.push({ x, m: s / x });
  }
  const fit = fitGammaGamma(rows);
  const popMean = (k) => (k.p * k.gamma) / (k.q - 1);
  assert.ok(Math.abs(popMean(fit) - popMean(truth)) / popMean(truth) < 0.12, `mean spend ${popMean(fit)} vs ${popMean(truth)}`);
  assert.ok(expectedValue(fit, { x: 5, m: 200 }) > expectedValue(fit, { x: 5, m: 20 }));
});

test('logistic regression learns a known price effect and beats guessing', () => {
  const r = rng(8); const X = []; const y = [];
  for (let i = 0; i < 400; i++) { const size = r() * 4 - 2; const repeat = r() < 0.4 ? 1 : 0; X.push([size, repeat]); y.push(r() < 1 / (1 + Math.exp(-(-1.5 * size + 1.2 * repeat))) ? 1 : 0); }
  const w = logisticFit(X, y);
  assert.ok(w[1] < -0.8 && w[2] > 0.5, `weights ${w}`);
  assert.ok(logisticPredict(w, [-1, 1]) > logisticPredict(w, [1, 0]));
});

test('Holt-Winters forecasts a seasonal series and finds the busy month', () => {
  const r = rng(2); const series = [];
  for (let t = 0; t < 36; t++) series.push(10000 + 100 * t + 3000 * Math.sin((2 * Math.PI * t) / 12) + (r() - 0.5) * 200);
  const hw = holtWinters(series, 12, 6);
  for (let h = 0; h < 6; h++) {
    const t = 36 + h; const truth = 10000 + 100 * t + 3000 * Math.sin((2 * Math.PI * t) / 12);
    assert.ok(Math.abs(hw.forecast[h] - truth) / truth < 0.05, `h=${h} ${hw.forecast[h]} vs ${truth}`);
  }
  assert.throws(() => holtWinters(series.slice(0, 20)), /two full seasons/);
});

test('RFM segment names follow the scores', () => {
  assert.equal(rfmSegment({ R: 5, F: 5, M: 5, frequency: 8 }), 'Champions');
  assert.equal(rfmSegment({ R: 1, F: 4, M: 3, frequency: 5 }), 'Regulars at risk');
  assert.equal(rfmSegment({ R: 5, F: 1, M: 2, frequency: 1 }), 'New or recent');
  assert.equal(rfmSegment({ R: 2, F: 1, M: 5, frequency: 1 }), 'Big one-off spenders');
  assert.equal(rfmSegment({ R: 1, F: 1, M: 1, frequency: 1 }), 'One-off / dormant');
});

/* ── end-to-end on a realistic simulated business ── */
test('new business: only plain statistics; every model reports how much data it still needs', () => {
  const data = makeBusiness({ months: 2, clients: 6, seed: 1 });
  const all = runAll(data);
  assert.ok(all.descriptive.counts.invoices > 0);
  for (const m of ['segments', 'bundles', 'themes', 'retention', 'winModel', 'forecast']) {
    assert.equal(all[m].ready, false, m);
    assert.ok(all[m].requirements.length > 0 && all[m].requirements.some((r) => r.missing > 0), `${m} says what is missing`);
  }
});

test('established business (30 months): every model unlocks and finds the planted patterns', () => {
  const data = makeBusiness({ months: 30, clients: 70, seed: 7 });
  const d = descriptive(data);
  assert.ok(d.repeatRate > 20 && d.repeatRate < 90, `repeat rate ${d.repeatRate}`);
  assert.equal(d.byClientType[0].key, 'manufacturing', 'manufacturers planted as top revenue');
  assert.ok(d.lostReasons.find((x) => x.key === 'price').n >= d.lostReasons.find((x) => x.key === 'turnaround').n);

  const s = segments(data);
  assert.equal(s.ready, true);
  assert.ok(s.groups.length >= 2);
  assert.ok(s.groups.some((g) => /buy often/.test(g.description)), JSON.stringify(s.groups.map((g) => g.description)));

  const b = bundles(data);
  assert.equal(b.ready, true);
  assert.ok(b.rules.some((r) => r.if.includes('cad') && r.then === 'fdm_printing'), 'planted CAD -> print bundle');

  const t = themes(data);
  assert.equal(t.ready, true);
  assert.ok(t.themes.some((th) => th.terms.some((w) => /replacement|tractor|gear/.test(w))), JSON.stringify(t.themes.map((x) => x.terms)));
  assert.ok(t.themes.some((th) => th.turnedAway > 0), 'turned-away enquiry theme surfaces');

  const ret = retention(data);
  assert.equal(ret.ready, true);
  assert.ok(ret.clients.every((c) => c.pAlive >= 0 && c.pAlive <= 1));
  assert.ok(ret.drifting.length >= 1, 'planted lapsed regular detected');
  assert.ok(ret.drifting.some((c) => c.name.startsWith('Lapsed')), JSON.stringify(ret.drifting.slice(0, 3)));

  const w = winModel(data);
  assert.equal(w.ready, true);
  const size = w.effects.find((e) => e.feature === 'Quote size (log)');
  assert.ok(size.weight < 0, 'bigger quotes win less often (planted)');
  assert.ok(w.accuracy >= w.baseline, `cv ${w.accuracy} vs baseline ${w.baseline}`);

  const f = forecast(data);
  assert.equal(f.ready, true);
  assert.equal(f.next.length, 6);
  assert.ok(f.quietest.includes(12) || f.quietest.includes(1) || f.quietest.includes(6), `quiet months ${f.quietest}`);
});

test('thresholds are what the page promises', () => {
  assert.deepEqual(THRESHOLDS.winModel, { decided: 150, minEach: 30 });
  assert.equal(THRESHOLDS.forecast.months, 24);
});
