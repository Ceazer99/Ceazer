// Simulated Ceazers-3D-like business in the app_insights_data() shape, with
// known patterns planted so tests can check the models find them:
//   * manufacturers are the biggest revenue group and reorder regularly
//   * "Lapsed ..." clients were regulars and then stopped ordering
//   * CAD work is usually followed by FDM printing (bundle)
//   * bigger quotes are won less often; repeat clients win more often
//   * December/January and June are quiet
//   * turned-away enquiries ask for resin miniatures / metal printing
import { rng } from '../../admin/js/insights.js';

const TYPES = [
  ['manufacturing', 0.25, 3.0, 0.8], // type, share, size multiplier, monthly order prob (regulars)
  ['startup', 0.2, 1.2, 0.25],
  ['individual', 0.3, 0.4, 0.05],
  ['education', 0.15, 0.8, 0.15],
  ['government', 0.1, 2.0, 0.1],
];
const SOURCES = ['website', 'referral', 'whatsapp', 'google', 'repeat'];
const TOPICS = [
  { cat: 'repairs', words: ['replacement gear', 'tractor bushing', 'pump impeller', 'gear housing'] },
  { cat: 'prototyping', words: ['electronics enclosure prototype', 'sensor housing prototype', 'handheld enclosure'] },
  { cat: 'fdm_printing', words: ['drill jig fixture', 'assembly fixture', 'alignment jig'] },
];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export function makeBusiness({ months = 30, clients = 70, seed = 1 } = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const start = new Date(Date.UTC(2024, 4, 1));
  const end = new Date(Date.UTC(2024, 4 + months, 1));
  const today = iso(addDays(end, 3));
  const out = { today, clients: [], documents: [], lines: [], enquiries: [],
    categories: ['cad', 'drawings', 'fdm_printing', 'resin_printing', 'prototyping', 'repairs', 'finishing', 'delivery', 'other'].map((id) => ({ id, label: id })) };
  let docN = 0; const id = (p) => `${p}-${++docN}`;

  for (let c = 0; c < clients; c++) {
    let roll = r(); let t = TYPES[0];
    for (const x of TYPES) { if (roll < x[1]) { t = x; break; } roll -= x[1]; }
    const lapsed = c < 3; // the first three are lapsed regulars
    const type = lapsed ? 'manufacturing' : t[0];
    const regular = lapsed || (type === 'manufacturing' && r() < 0.8) || r() < 0.15;
    const client = { id: `c${c}`, name: `${lapsed ? 'Lapsed' : 'Client'} ${c}`, client_type: type, lead_source: pick(SOURCES),
      created_at: iso(addDays(start, Math.floor(r() * (months * 30) * 0.4))) };
    out.clients.push(client);

    const sizeMult = TYPES.find((x) => x[0] === type)[2];
    const firstDay = new Date(`${client.created_at}T00:00:00Z`);
    let hadInvoice = false;
    for (let day = firstDay; day < end; day = addDays(day, 30)) {
      const month = day.getUTCMonth() + 1;
      const seasonal = month === 12 || month === 1 || month === 6 ? 0.25 : 1;
      if (lapsed && day > addDays(end, -240)) break; // stopped ordering 8 months ago
      const p = regular ? (lapsed ? 0.9 : TYPES.find((x) => x[0] === type)[3]) : (day.getTime() === firstDay.getTime() ? 1 : 0.02);
      if (r() > p * seasonal) continue;

      const qDate = addDays(day, Math.floor(r() * 25));
      if (qDate >= end) break;
      const topic = TOPICS[Math.floor(r() * TOPICS.length)];
      const withCad = r() < 0.45;
      const qid = id('q');
      const lines = [];
      if (withCad) {
        lines.push({ category: 'cad', name: 'CAD design', description: `${pick(topic.words)} modelling`, amount_cents: Math.round(40000 * sizeMult * (0.5 + r())) });
        if (r() < 0.88) lines.push({ category: 'fdm_printing', name: '3D printing', description: pick(topic.words), amount_cents: Math.round(90000 * sizeMult * (0.5 + r())) });
      } else {
        lines.push({ category: topic.cat, name: pick(topic.words), description: pick(topic.words), amount_cents: Math.round(70000 * sizeMult * (0.5 + r())) });
      }
      if (r() < 0.3) lines.push({ category: 'finishing', name: 'Sanding and painting', description: 'post-processing', amount_cents: Math.round(15000 * (0.5 + r())) });
      if (r() < 0.25) lines.push({ category: 'delivery', name: 'Delivery', description: '', amount_cents: 20000 });
      const net = lines.reduce((s, l) => s + l.amount_cents, 0);
      const total = Math.round(net * 1.15);

      const z = 1.4 - 1.1 * (Math.log(net / 100) - Math.log(1500)) + (hadInvoice ? 1.2 : 0);
      const won = r() < 1 / (1 + Math.exp(-z));
      const lostReason = won ? null : (r() < 0.55 ? 'price' : r() < 0.6 ? 'no_response' : 'turnaround');
      out.documents.push({ id: qid, kind: 'quote', status: won ? 'converted' : 'declined', client_id: client.id, issue_date: iso(qDate),
        due_date: iso(addDays(qDate, 30)), total_cents: total, vat_cents: total - net, paid_cents: 0, deposit_type: r() < 0.5 ? 'percent' : 'none',
        discount_cents: r() < 0.2 ? Math.round(net * 0.05) : 0, lost_reason: lostReason, source_quote_id: null, imported: false, cost_cents: Math.round(net * 0.45) });
      lines.forEach((l) => out.lines.push({ document_id: qid, ...l }));
      if (!won) continue;

      const iDate = addDays(qDate, 3 + Math.floor(r() * 10));
      if (iDate >= end) continue;
      const iid = id('i');
      const paid = iDate < addDays(end, -60) || r() < 0.6;
      out.documents.push({ id: iid, kind: 'invoice', status: paid ? 'paid' : 'issued', client_id: client.id, issue_date: iso(iDate),
        due_date: iso(addDays(iDate, 7)), total_cents: total, vat_cents: total - net, paid_cents: paid ? total : 0, deposit_type: 'none',
        discount_cents: 0, lost_reason: null, source_quote_id: qid, imported: false, cost_cents: Math.round(net * 0.45),
        fully_paid_on: paid ? iso(addDays(iDate, 5 + Math.floor(r() * 30))) : null });
      lines.forEach((l) => out.lines.push({ document_id: iid, ...l }));
      hadInvoice = true;
    }
  }

  // enquiries, including work that was turned away
  const enquiryMonths = Math.max(1, months);
  for (let i = 0; i < enquiryMonths * 2; i++) {
    const d = iso(addDays(start, Math.floor(r() * months * 30)));
    if (r() < 0.35) {
      out.enquiries.push({ received_at: d, source: pick(['website', 'whatsapp', 'phone']), client_type: pick(['individual', 'startup']),
        category: r() < 0.5 ? 'resin_printing' : 'other', status: 'turned_away', turned_away_reason: 'not_offered',
        message: r() < 0.5 ? 'Resin printing of tabletop miniatures, fine detail figures' : 'Metal 3D printing of stainless steel brackets' });
    } else {
      const topic = TOPICS[Math.floor(r() * TOPICS.length)];
      out.enquiries.push({ received_at: d, source: pick(['website', 'whatsapp', 'referral']), client_type: pick(['manufacturing', 'startup', 'individual']),
        category: topic.cat, status: r() < 0.7 ? 'quoted' : 'no_response', turned_away_reason: null, message: `Need a quote for ${pick(topic.words)}` });
    }
  }
  return out;
}
