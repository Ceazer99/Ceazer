// Ceazers 3D admin - client-facing PDFs (quotes, invoices).
//
// buildPdfModel() is a pure function that copies ONLY client-facing fields
// from a document into a print model. Costing, margins and internal notes
// are never read, so they cannot reach a PDF even if present on the input.
// renderPdf() draws that model with jsPDF (layout follows the old app:
// logo + company block, title + number/date, billing/shipping, items table,
// totals, payment methods, signature, footer note).
import { formatMoney, formatDate, discountPercentOf } from './calc.js';

const lines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const qtyText = (q) => String(Number(q)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const pct = (n) => `${Number(n).toFixed(2)}%`;

export function buildPdfModel(doc, settings) {
  const co = doc.company_snapshot || settings || {};
  const fmt = settings || co;
  const m = (c) => formatMoney(c ?? 0, fmt);
  const d = (iso) => formatDate(iso, fmt.date_format || 'DD/MMM/YYYY');
  const isQuote = doc.kind === 'quote';
  const vatRegistered = !!co.vat_number && doc.tax_mode !== 'none';
  const title = isQuote ? (doc.title || 'Quote') : (vatRegistered ? 'Tax Invoice' : (doc.title || 'Invoice'));
  const cl = doc.client_snapshot || {};

  const meta = [];
  meta.push([isQuote ? 'Quote No' : 'Invoice No', doc.number || 'DRAFT']);
  if (doc.revision > 1) meta.push(['Revision', String(doc.revision)]);
  meta.push([isQuote ? 'Quote date' : 'Invoice date', d(doc.issue_date)]);
  if (doc.due_date) meta.push([isQuote ? 'Valid until' : 'Due date', d(doc.due_date)]);
  if (doc.reference) meta.push(['Reference', doc.reference]);
  if (!isQuote && doc.source_quote_number) meta.push(['Quote ref', doc.source_quote_number]);

  const company = [co.email, ...lines(co.address), co.phone, co.vat_number ? `VAT: ${co.vat_number}` : '',
    co.registration_number ? `Reg: ${co.registration_number}` : ''].filter(Boolean);
  const party = (addr) => [cl.name, cl.contact_person ? `Attn: ${cl.contact_person}` : '', ...lines(addr), cl.phone, cl.email,
    cl.vat_number ? `VAT: ${cl.vat_number}` : ''].filter(Boolean);

  const rows = (doc.lines || []).map((l) => [l.name || '', l.description || '', m(l.unit_price_cents), qtyText(l.qty), m(l.line_total_cents)]);

  const totals = [['Subtotal', m(doc.subtotal_cents)]];
  if (doc.discount_cents) {
    const p = doc.discount_type === 'percent' ? Number(doc.discount_percent) : discountPercentOf(doc.discount_cents, doc.subtotal_cents);
    totals.push([`Discount (${pct(p)})`, `-${m(doc.discount_cents)}`]);
  }
  if (doc.shipping_cents) totals.push(['Shipping', m(doc.shipping_cents)]);
  if (doc.tax_mode === 'exclusive') totals.push([`VAT (${Number(doc.vat_rate)}%)`, m(doc.vat_cents)]);
  totals.push(['Total', m(doc.total_cents), true]);
  if (doc.tax_mode === 'inclusive' && doc.vat_cents) totals.push([`Includes VAT (${Number(doc.vat_rate)}%)`, m(doc.vat_cents)]);
  if (doc.deposit_cents) {
    const label = doc.deposit_type === 'percent' ? `Deposit required (${pct(doc.deposit_percent)})` : 'Deposit required';
    totals.push([label, m(doc.deposit_cents)]);
  }
  if (!isQuote && doc.paid_cents) {
    totals.push(['Paid to date', `-${m(doc.paid_cents)}`]);
    totals.push(['Balance due', m(doc.balance_cents), true]);
  }

  const bank = [co.bank_name && `Bank: ${co.bank_name}`, co.bank_account && `Account No: ${co.bank_account}`,
    co.bank_branch_code && `Branch code: ${co.bank_branch_code}`, co.bank_holder && `Holder: ${co.bank_holder}`,
    doc.number && `Reference: ${doc.number}`].filter(Boolean);

  return {
    kind: doc.kind,
    title,
    watermark: doc.status === 'void' ? 'VOID' : (!doc.locked ? 'DRAFT' : ''),
    companyName: co.name || '',
    company,
    meta,
    billTo: { heading: isQuote ? 'Billing address' : 'Invoice to', lines: party(cl.billing_address) },
    shipTo: { heading: isQuote ? 'Shipping address' : 'Ship to', lines: party(cl.shipping_address || cl.billing_address) },
    columns: ['Item', 'Description', 'Rate', 'Qty', 'Amount'],
    rows,
    totals,
    paymentMethods: !isQuote && bank.length ? bank : [],
    notes: lines(doc.notes),
    terms: lines(doc.terms),
    signature: !isQuote ? { label: co.signatory_label || 'Signature', date: d(doc.issue_date) } : null,
    footer: co.footer_note || '',
    filename: `${doc.number || 'DRAFT'}${doc.revision > 1 ? `-R${doc.revision}` : ''}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_'),
  };
}

/* ── jsPDF rendering ───────────────────────────────────────────── */
async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('image');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob);
  });
}
function imageSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

/**
 * @param model  buildPdfModel() output
 * @param assets { logoUrl, signatureUrl } (signed or same-origin URLs)
 * @returns Blob (application/pdf)
 */
export async function renderPdf(model, assets = {}) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('PDF library failed to load');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `${model.title} ${model.meta[0][1]}`, creator: 'Ceazers 3D admin' });
  const W = 210; const L = 16; const R = W - 16;
  const ink = [15, 23, 42]; const soft = [71, 85, 105]; const rule = [203, 213, 225]; const band = [241, 245, 249];
  pdf.setTextColor(...ink);

  // logo
  let y = 18;
  try {
    const data = await toDataUrl(assets.logoUrl || '/images/logo.png');
    const { w, h } = await imageSize(data);
    const boxW = 34; const boxH = Math.min(26, (boxW * h) / w);
    pdf.addImage(data, data.startsWith('data:image/png') ? 'PNG' : 'JPEG', L - 2, y - 4, boxH * (w / h), boxH);
  } catch { /* logo optional */ }

  // title + meta (right)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22);
  pdf.text(model.title, R, y + 4, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5);
  let my = y + 13;
  for (const [k, v] of model.meta) {
    pdf.setTextColor(...soft); pdf.text(k, R - 40, my);
    pdf.setTextColor(...ink); pdf.text(String(v), R, my, { align: 'right' });
    my += 5;
  }

  // company block (left)
  y = 48;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13);
  const nameLines = pdf.splitTextToSize(model.companyName, 90);
  pdf.text(nameLines, L, y); y += nameLines.length * 5.6;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5);
  for (const t of model.company) { pdf.text(t, L, y); y += 4.6; }
  y = Math.max(y, my) + 6;

  // billing / shipping
  const colW = (R - L - 10) / 2;
  const block = (x, b) => {
    pdf.setFillColor(...band); pdf.rect(x, y - 4, colW, 6, 'F');
    pdf.setDrawColor(...rule); pdf.line(x, y + 2, x + colW, y + 2);
    pdf.setFont('helvetica', 'bold'); pdf.text(b.heading, x + 2, y);
    pdf.setFont('helvetica', 'normal');
    let yy = y + 7;
    for (const t of b.lines) { const s = pdf.splitTextToSize(t, colW - 2); pdf.text(s, x, yy); yy += 4.6 * s.length; }
    return yy;
  };
  y = Math.max(block(L, model.billTo), block(L + colW + 10, model.shipTo)) + 4;

  // items
  pdf.autoTable({
    startY: y,
    head: [model.columns],
    body: model.rows,
    margin: { left: L, right: W - R },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 }, textColor: ink, overflow: 'linebreak' },
    headStyles: { fillColor: band, fontStyle: 'bold', lineWidth: 0.2, lineColor: [100, 116, 139] },
    columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26, halign: 'right' }, 3: { cellWidth: 14, halign: 'right' }, 4: { cellWidth: 28, halign: 'right' } },
    didDrawPage: () => { if (model.watermark) watermark(pdf, model.watermark); },
  });
  y = pdf.lastAutoTable.finalY + 2;
  pdf.setDrawColor(...soft); pdf.line(L, y, R, y);
  y += 7;

  // payment methods (left) + totals (right)
  const startY = y;
  if (model.paymentMethods.length) {
    const pw = 92;
    pdf.setFillColor(...band); pdf.rect(L, y - 4, pw, 6, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.text('Payment methods', L + 2, y);
    pdf.setFont('helvetica', 'normal');
    let yy = y + 6;
    for (const t of model.paymentMethods) { const s = pdf.splitTextToSize(t, pw - 2); pdf.text(s, L, yy); yy += 4.6 * s.length; }
    pdf.setDrawColor(...rule); pdf.line(L, yy, L + pw, yy);
    y = yy;
  }
  let ty = startY;
  for (const [k, v, strong] of model.totals) {
    pdf.setFont('helvetica', strong ? 'bold' : 'normal'); pdf.setFontSize(strong ? 11.5 : 9.5);
    pdf.text(k, R - 32, ty, { align: 'right' }); pdf.text(v, R, ty, { align: 'right' });
    ty += strong ? 6.5 : 5;
  }
  y = Math.max(y, ty) + 6;

  pdf.setFontSize(9); pdf.setFont('helvetica', 'normal');
  const para = (heading, arr) => {
    if (!arr.length) return;
    if (y > 260) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold'); pdf.text(heading, L, y); y += 4.6; pdf.setFont('helvetica', 'normal');
    for (const t of arr) { const s = pdf.splitTextToSize(t, R - L); pdf.text(s, L, y); y += 4.4 * s.length; }
    y += 3;
  };
  para('Notes', model.notes);
  para('Terms', model.terms);

  // signature (invoices)
  if (model.signature) {
    if (y > 245) { pdf.addPage(); y = 30; }
    y += 14;
    if (assets.signatureUrl) {
      try {
        const sig = await toDataUrl(assets.signatureUrl);
        const { w, h } = await imageSize(sig);
        const sh = 16; pdf.addImage(sig, sig.startsWith('data:image/png') ? 'PNG' : 'JPEG', L, y - sh, Math.min(60, sh * (w / h)), sh);
      } catch { /* optional */ }
    }
    pdf.setDrawColor(...ink); pdf.line(L, y + 1, L + 85, y + 1);
    pdf.setFontSize(9); pdf.text(model.signature.date, L + 85, y, { align: 'right' });
    pdf.setTextColor(...soft); pdf.text(model.signature.label, L, y + 5.5); pdf.text('Date', L + 85, y + 5.5, { align: 'right' });
    pdf.setTextColor(...ink);
  }

  // footer on every page
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFontSize(9); pdf.setTextColor(...soft);
    if (model.footer) pdf.text(model.footer, W / 2, 284, { align: 'center' });
    if (pages > 1) pdf.text(`Page ${i} of ${pages}`, R, 290, { align: 'right' });
  }
  return pdf.output('blob');
}

function watermark(pdf, text) {
  pdf.saveGraphicsState?.();
  if (pdf.GState) pdf.setGState(new pdf.GState({ opacity: 0.08 }));
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(90); pdf.setTextColor(15, 23, 42);
  pdf.text(text, 105, 170, { align: 'center', angle: 30 });
  pdf.restoreGraphicsState?.();
  pdf.setTextColor(15, 23, 42); pdf.setFont('helvetica', 'normal');
}
