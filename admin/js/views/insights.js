// Insights (owner only): statistics now, models as the data grows.
import { h, money, icon, setTitle } from '../ui.js';
import { runAll } from '../insights.js';
import { CLIENT_TYPES, LEAD_SOURCES, LOST_REASONS, ENQUIRY_SOURCES, TURNED_AWAY_REASONS, labelOf } from '../lists.js';

const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const kpi = (label, value, note) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', { class: 'num' }, value), note ? h('small', { class: 'muted' }, note) : null);

function barTable(rows, { labelOf: lab = (r) => r.key, value = (r) => r.cents, fmt = money, extra } = {}) {
  if (!rows.length) return h('p', { class: 'muted' }, 'No data yet.');
  const max = Math.max(1, ...rows.map(value));
  return h('div', { class: 'hbars' }, rows.slice(0, 10).map((r) => {
    const bar = h('span', { class: 'hbar-fill' }); bar.style.width = `${Math.max(2, Math.round((value(r) / max) * 100))}%`;
    return h('div', { class: 'hbar' }, h('span', { class: 'hbar-label' }, lab(r)), h('span', { class: 'hbar-track' }, bar),
      h('span', { class: 'hbar-value num' }, fmt(value(r)), extra ? h('small', { class: 'muted' }, ` ${extra(r)}`) : null));
  }));
}

function locked(model) {
  const p = h('span', { class: 'progress-fill' }); p.style.width = `${Math.round((model.progress || 0) * 100)}%`;
  return h('div', { class: 'locked' },
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round((model.progress || 0) * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, p),
    h('ul', {}, (model.requirements || []).map((r) => h('li', {}, r.missing ? `Needs ${r.missing} more ${r.what} (${r.have} of ${r.need})` : `✓ ${r.need}+ ${r.what}`))),
    model.error ? h('p', { class: 'field-error' }, `Model error: ${model.error}`) : null,
    model.note ? h('p', { class: 'muted' }, model.note) : null);
}

function card(title, question, model, render) {
  return h('section', { class: `panel insight ${model.ready ? 'is-ready' : 'is-locked'}` },
    h('div', { class: 'insight-head' }, h('h2', {}, title), h('span', { class: `badge ${model.ready ? 'badge-paid' : 'badge-draft'}` }, model.ready ? 'Active' : 'Learning')),
    h('p', { class: 'muted' }, question),
    model.ready ? render(model) : locked(model));
}

export async function renderInsights(ctx) {
  const [data, clientList] = await Promise.all([ctx.api.rpc('insights_data', {}), ctx.api.rpc('list_clients', { include_archived: true })]);
  const R = runAll(data);
  // POPIA s69: never suggest contacting clients who opted out of marketing
  const optedOut = new Set(clientList.filter((c) => c.marketing_opt_out).map((c) => c.id));
  if (R.retention.ready) {
    R.retention.drifting.forEach((c) => { c.optedOut = optedOut.has(c.id); });
    R.retention.contactable = R.retention.drifting.filter((c) => !c.optedOut);
  }
  const d = R.descriptive;
  const cat = new Map((data.categories || []).map((c) => [c.id, c.label]));

  const quality = d.dataQuality;
  const fixes = [
    quality.missingType ? [`${quality.missingType} client(s) have no client type`, '#/clients'] : null,
    quality.missingSource ? [`${quality.missingSource} client(s) have no "how they found you"`, '#/clients'] : null,
    quality.uncategorised ? [`${quality.uncategorised} of ${quality.lines} quote/invoice lines have no category`, '#/quotes'] : null,
    quality.undecidedOld ? [`${quality.undecidedOld} expired quote(s) not yet marked won or lost`, '#/quotes'] : null,
  ].filter(Boolean);

  return h('div', { class: 'insights' },
    setTitle('Insights'),
    h('p', { class: 'muted' }, 'Everything here is calculated privately in your browser from your own records; nothing is sent to any AI or outside service. Plain statistics work from day one. Each model switches on by itself once there is enough history to trust it.'),
    fixes.length ? h('section', { class: 'panel nudge' }, h('h2', {}, 'Improve your insights'),
      h('ul', {}, fixes.map(([t, href]) => h('li', {}, h('a', { href }, t))))) : null,

    ideas(R, cat),

    h('div', { class: 'kpis kpis-4' },
      kpi('Repeat clients', `${d.repeatRate}%`, `${d.repeaters} of ${d.counts.buyers} paying clients came back`),
      kpi('Quote win rate', `${d.winRate}%`, `${d.counts.decided} quotes won or lost`),
      kpi('Average job (excl. VAT)', money(d.avgJobNet), `${d.counts.invoices} invoices`),
      kpi('Days to get paid', d.medianDaysToPay === null ? '-' : `${Math.round(d.medianDaysToPay)}`, 'median, paid invoices')),

    h('div', { class: 'grid-2' },
      h('section', { class: 'panel' }, h('h2', {}, 'Revenue by client type'), barTable(d.byClientType, { labelOf: (r) => labelOf(CLIENT_TYPES, r.key === 'unknown' ? null : r.key), extra: (r) => `· ${r.jobs} jobs` })),
      h('section', { class: 'panel' }, h('h2', {}, 'Revenue by kind of work'), barTable(d.byCategory, { labelOf: (r) => r.label, extra: (r) => `· ${r.jobs} jobs` })),
      h('section', { class: 'panel' }, h('h2', {}, 'Where paying clients come from'), barTable(d.byLeadSource, { labelOf: (r) => labelOf(LEAD_SOURCES, r.key === 'unknown' ? null : r.key), extra: (r) => `· ${r.jobs} jobs` })),
      h('section', { class: 'panel' }, h('h2', {}, 'Win rate by kind of work'), barTable(d.winByCategory.filter((r) => r.total >= 1), { labelOf: (r) => r.label, value: (r) => r.rate, fmt: (v) => `${v}%`, extra: (r) => `· ${r.won}/${r.total}` })),
      h('section', { class: 'panel' }, h('h2', {}, 'Why quotes are lost'), barTable(d.lostReasons, { labelOf: (r) => labelOf(LOST_REASONS, r.key === 'not recorded' ? null : r.key), value: (r) => r.n, fmt: String })),
      h('section', { class: 'panel' }, h('h2', {}, 'Work you turned away'),
        d.turnedAwayByCategory.length ? barTable(d.turnedAwayByCategory, { value: (r) => r.n, fmt: String }) : h('p', { class: 'muted' }, 'Nothing recorded yet. Log turned-away requests on the Enquiries page.'),
        d.turnedAway.length ? h('p', { class: 'muted' }, 'Reasons: ', d.turnedAway.map((r) => `${labelOf(TURNED_AWAY_REASONS, r.key)} (${r.n})`).join(', ')) : null),
      h('section', { class: 'panel' }, h('h2', {}, 'Enquiries by channel'), barTable(d.enquiriesBySource, { labelOf: (r) => labelOf(ENQUIRY_SOURCES, r.key), value: (r) => r.n, fmt: String }),
        d.counts.enquiries ? h('p', { class: 'muted' }, `${d.enquiryToQuote}% of handled enquiries became quotes.`) : null),
      h('section', { class: 'panel' }, h('h2', {}, 'Invoiced per month (excl. VAT)'), barTable(d.monthly.slice(-12).reverse(), { labelOf: (r) => r.month }))),

    h('h2', { class: 'section-title' }, 'Models'),
    card('Client groups', 'What kinds of clients do you have? (RFM scoring + k-means clustering)', R.segments, (m) => h('div', { class: 'stack' },
      m.reliable ? null : h('p', { class: 'muted' }, `Groups are still blurry (separation ${m.silhouette}); treat them as a rough guide.`),
      m.groups.map((g) => h('div', { class: 'group' },
        h('strong', {}, `${g.size} clients who ${g.description}`),
        h('div', { class: 'muted' }, `${g.revenueShare}% of revenue · typically ${g.medianFrequency} job(s), ${money(g.medianSpend)} in total, last seen ${g.medianRecencyDays} days ago`),
        h('div', { class: 'muted' }, `Mostly ${labelOf(CLIENT_TYPES, g.mainClientType === 'unknown' ? null : g.mainClientType)}${g.mainCategory ? `, buying ${g.mainCategory}` : ''}`),
        h('details', {}, h('summary', {}, 'Clients in this group'), h('p', {}, g.clients.map((c) => `${c.name} (${c.segment})`).join(', '))))))),

    card('Services bought together', 'Which services go together, so you can package them? (association rules)', R.bundles, (m) => (m.rules.length
      ? h('ul', { class: 'stack' }, m.rules.map((r) => h('li', {}, h('strong', {}, `${r.ifLabel.join(' + ')} → ${r.thenLabel}`),
        h('span', { class: 'muted' }, ` in ${Math.round(r.confidence * 100)}% of those jobs (${r.lift.toFixed(1)}× more than usual, ${r.count} jobs)`))))
      : h('p', { class: 'muted' }, `Checked ${m.jobs} jobs; no service pairs stand out yet.`))),

    card('What people ask for', 'Recurring themes in quote lines and enquiries (TF-IDF + clustering)', R.themes, (m) => h('div', { class: 'stack' },
      m.themes.map((t) => h('div', { class: 'group' },
        h('strong', {}, t.terms.join(', ')),
        h('div', { class: 'muted' }, [`${t.size} mentions`, t.quoteLines ? `${t.quoteLines} quote lines` : null, t.enquiries ? `${t.enquiries} enquiries` : null,
          t.turnedAway ? `${t.turnedAway} turned away` : null, t.winRate !== null ? `${t.winRate}% won` : null].filter(Boolean).join(' · ')),
        h('div', { class: 'muted small' }, `e.g. "${t.examples[0]}"`))))),

    card('Who will come back', 'Which clients are still active, and who is drifting away? (BG/NBD + Gamma-Gamma)', R.retention, (m) => h('div', { class: 'stack' },
      h('div', { class: 'kpis' }, kpi(`Expected from existing clients (next ${m.horizonWeeks / 4.33 | 0} months)`, money(m.expectedRevenueCents), 'excl. VAT, rough guide')),
      m.dropoutMeasured ? null : h('p', { class: 'muted' }, 'Few clients have stopped buying so far, so the model can\'t yet measure drop-out. "Drifting" uses each client\'s own usual gap between orders.'),
      h('h3', {}, 'Drifting away: worth a call'),
      m.drifting.length ? h('ul', {}, m.drifting.slice(0, 10).map((c) => h('li', {}, h('a', { href: `#/clients/${c.id}` }, c.name),
        ` · ${c.purchases} jobs · last ${c.weeksSinceLast} weeks ago${c.usualGapWeeks ? ` (usually every ${c.usualGapWeeks})` : ''} · ${Math.round(c.pAlive * 100)}% likely still active`,
        c.optedOut ? h('strong', { class: 'danger' }, ' · opted out of marketing: do not contact for sales') : null)))
        : h('p', { class: 'muted' }, 'Nobody looks overdue.'),
      h('h3', {}, 'Most likely to order again'),
      h('ul', {}, m.likely.slice(0, 8).map((c) => h('li', {}, h('a', { href: `#/clients/${c.id}` }, c.name), ` · about ${c.expectedOrders.toFixed(1)} jobs, ${money(c.expectedValueCents)} expected`))))),

    card('Quote win chances', 'What makes you win quotes, and which open quotes will probably close? (logistic regression)', R.winModel, (m) => h('div', { class: 'stack' },
      h('p', { class: m.reliable ? '' : 'muted' }, m.reliable
        ? `Correctly predicts ${Math.round(m.accuracy * 100)}% of past outcomes, compared with ${Math.round(m.baseline * 100)}% by always guessing the most common result.`
        : `Not yet better than guessing (${Math.round(m.accuracy * 100)}% vs ${Math.round(m.baseline * 100)}%). The effects below are hints only.`),
      h('ul', {}, m.effects.slice(0, 6).map((e) => h('li', {}, h('strong', {}, e.feature), e.feature.startsWith('Quote size')
        ? (e.weight < 0 ? ': larger quotes are won less often' : ': larger quotes are won more often')
        : `: ${e.oddsRatio >= 1 ? `${e.oddsRatio.toFixed(1)}× the odds of winning` : `${(1 / e.oddsRatio).toFixed(1)}× lower odds of winning`}`))),
      m.open.length ? h('div', {}, h('h3', {}, `Open quotes (about ${money(m.expectedOpenValueCents)} expected)`),
        h('ul', {}, m.open.slice(0, 8).map((o) => h('li', {}, h('a', { href: `#/quotes/${o.id}` }, o.client || 'Quote'), ` · ${money(o.totalCents)} · ${Math.round(o.probability * 100)}% chance`)))) : null)),

    card('Busy and quiet months', 'What should you expect over the next six months? (Holt-Winters seasonal forecast)', R.forecast, (m) => h('div', { class: 'stack' },
      barTable(m.next, { labelOf: (r) => r.month }),
      h('p', {}, `Usually busiest: ${m.busiest.map((x) => MONTH[x]).join(' and ')}. Usually quietest: ${m.quietest.map((x) => MONTH[x]).join(' and ')}.`),
      h('p', { class: 'muted' }, `Typical error: ±${money(m.rmseCents)} per month.`))),
  );
}

/** Plain-language suggestions, each only when the evidence clears a minimum. */
function ideas(R, cat) {
  const d = R.descriptive; const out = [];
  const ta = d.turnedAwayByCategory.filter((r) => r.key !== 'Unclassified');
  if (ta[0] && ta[0].n >= 3) out.push([`Consider offering ${ta[0].key}`, `${ta[0].n} requests were turned away. That's demand you're already getting for free.`]);
  if (R.bundles.ready && R.bundles.rules[0]) {
    const r = R.bundles.rules[0];
    out.push([`Package ${r.ifLabel.join(' + ')} with ${r.thenLabel}`, `They go together in ${Math.round(r.confidence * 100)}% of jobs (${r.count} jobs). A fixed-price package could lift job size.`]);
  }
  const lost = d.lostReasons.reduce((s, r) => s + r.n, 0);
  const price = d.lostReasons.find((r) => r.key === 'price');
  if (price && lost >= 10 && price.n / lost >= 0.4) {
    const worst = d.winByCategory.filter((c) => c.total >= 5).sort((a, b) => a.rate - b.rate)[0];
    out.push(['Review pricing', `${Math.round((price.n / lost) * 100)}% of lost quotes were lost on price${worst ? `; ${worst.label} has the lowest win rate (${worst.rate}%)` : ''}.`]);
  }
  const top = d.byClientType.filter((r) => r.key !== 'unknown')[0];
  if (top && d.revenueNet > 0 && d.counts.invoices >= 15) out.push([`Market to more ${labelOf(CLIENT_TYPES, top.key).toLowerCase()} clients`, `They bring ${Math.round((top.cents / d.revenueNet) * 100)}% of your revenue from ${top.jobs} jobs.`]);
  if (d.counts.buyers >= 15 && d.repeatRate < 30) out.push(['Follow up after every job', `Only ${d.repeatRate}% of clients have come back. A check-in 4–6 weeks after delivery is a cheap way to lift that.`]);
  if (R.retention.ready && R.retention.contactable.length) out.push([`Check in with ${R.retention.contactable.length} drifting client(s)`, `${R.retention.contactable.slice(0, 3).map((c) => c.name).join(', ')} used to order regularly and have gone quiet. Clients who opted out of marketing are left off this list.`]);
  if (R.themes.ready) {
    const th = R.themes.themes.find((t) => t.size >= 8 && t.quoteLines >= 5);
    if (th) out.push([`Turn "${th.terms.slice(0, 2).join(' ')}" into a standard product`, `It has come up ${th.size} times. A listed price and lead time makes it easy to buy.`]);
  }
  if (!out.length) return h('section', { class: 'panel ideas' }, h('h2', {}, icon('reports', 18), ' Ideas to explore'),
    h('p', { class: 'muted' }, 'Suggestions appear here once there is enough evidence behind them. Keep logging enquiries (including turned-away work), categories and lost reasons.'));
  return h('section', { class: 'panel ideas' }, h('h2', {}, icon('reports', 18), ' Ideas to explore'),
    h('ul', { class: 'stack' }, out.map(([t, why]) => h('li', {}, h('strong', {}, t), h('div', { class: 'muted' }, why)))),
    h('p', { class: 'muted small' }, 'Generated from your own data with simple rules; check them against what you know about the market.'));
}
