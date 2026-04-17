/**
 * Ceazers 3D — AI Quote Analysis Serverless Function
 * POST /api/ai-quote
 * Body: { material, size, qty, infill, description }
 *
 * Uses Google Gemini (gemini-2.0-flash) to analyse a 3D printing
 * request and return a structured quote breakdown.
 * GEMINI_API_KEY is server-side only — never sent to the browser.
 */

'use strict';

const { applyCors, rateLimit, clampString } = require('./_lib/guard');

const MODEL   = 'gemini-2.0-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const MATERIAL_INFO = {
  PLA:    { full: 'PLA (Polylactic Acid)',                   costMult: 1.0,  useCase: 'prototypes, models, decorative parts' },
  'PLA+': { full: 'PLA+ (Enhanced PLA)',                     costMult: 1.15, useCase: 'stronger prototypes, display models' },
  PETG:   { full: 'PETG (Polyethylene Terephthalate Glycol)', costMult: 1.25, useCase: 'functional parts, food-safe applications' },
  ABS:    { full: 'ABS (Acrylonitrile Butadiene Styrene)',    costMult: 1.35, useCase: 'heat-resistant parts, automotive, enclosures' },
  ASA:    { full: 'ASA (Acrylonitrile Styrene Acrylate)',     costMult: 1.5,  useCase: 'outdoor/UV-exposed parts, automotive' },
  TPU:    { full: 'TPU (Thermoplastic Polyurethane)',         costMult: 1.7,  useCase: 'flexible parts, gaskets, grips, wearables' },
  Nylon:  { full: 'Nylon (PA12)',                             costMult: 2.0,  useCase: 'high-strength structural parts, gears, bearings' },
};

const SIZE_INFO = {
  Small:  { dim: 'up to 5×5×5 cm',      basePrice: 80  },
  Medium: { dim: '5–15 cm in any axis',  basePrice: 220 },
  Large:  { dim: '15 cm+ in any axis',   basePrice: 500 },
};

function buildPrompt({ material, size, qty, infill, description }) {
  const mat  = MATERIAL_INFO[material] || MATERIAL_INFO.PLA;
  const sz   = SIZE_INFO[size]         || SIZE_INFO.Medium;
  const infillPct = parseInt(infill, 10) || 20;
  const quantity  = parseInt(qty, 10)   || 1;

  return `You are a professional FDM 3D printing estimator at Ceazers 3D Engineering Solutions, a Durban-based engineering studio in South Africa. Analyse the following print request and return a JSON object (no markdown, no code block — pure JSON only).

REQUEST:
- Material: ${mat.full}
- Part size: ${size} (${sz.dim})
- Quantity: ${quantity} unit(s)
- Infill density: ${infillPct}%
- Base price per unit: R${sz.basePrice} × material multiplier ${mat.costMult}
- Client description: "${description || 'No description provided'}"

Return ONLY this JSON structure with real values filled in:
{
  "priceRange": {
    "low": <integer ZAR>,
    "high": <integer ZAR>,
    "perUnit": <integer ZAR average per unit>
  },
  "printTime": {
    "estimate": "<human readable, e.g. '4–6 hours per unit'>",
    "totalHours": <integer total for all units>
  },
  "materialAdvice": "<1–2 sentences on whether the chosen material is ideal for the stated use-case, and if not, a better suggestion>",
  "designTips": ["<tip 1>", "<tip 2>", "<tip 3>"],
  "confidence": "<High|Medium|Low>",
  "confidenceNote": "<1 sentence explaining confidence level>",
  "leadTime": "<e.g. '2–3 business days'>",
  "alternativeMaterial": "<material name or null if current is ideal>"
}

Pricing context for South Africa: FDM printing typically R80–R600 per unit depending on size and material. Labour + electricity included. Apply bulk discount of 10% for 6–10 units and 20% for 11+ units. Infill below 20% is hollow-light, above 60% is structural-dense.`;
}

async function callGemini(prompt, apiKey) {
  const url = `${BASE_URL}/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new Error('Empty response from Gemini');

  // Parse JSON — strip any accidental markdown fences
  const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

module.exports = async function handler(req, res) {
  // CORS (origin-restricted) — handles OPTIONS preflight
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: 8 AI-quote requests per minute per IP (protects Gemini quota)
  if (!rateLimit(req, res, { max: 8, windowMs: 60_000, key: 'ai-quote' })) return;

  const body = req.body ?? {};
  const { material, size, qty, infill } = body;
  const description = clampString(body.description, 500); // cap prompt input

  // Basic validation
  if (!material || !MATERIAL_INFO[material]) {
    return res.status(400).json({ error: `Invalid material. Options: ${Object.keys(MATERIAL_INFO).join(', ')}` });
  }
  if (!size || !SIZE_INFO[size]) {
    return res.status(400).json({ error: `Invalid size. Options: ${Object.keys(SIZE_INFO).join(', ')}` });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on the server.' });
  }

  try {
    const prompt = buildPrompt({ material, size, qty, infill, description });
    const result = await callGemini(prompt, apiKey);
    console.log(`[ai-quote] ${material}/${size}/qty${qty} → R${result.priceRange?.low}–R${result.priceRange?.high}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[ai-quote] Error:', err.message);
    const status = err.status ?? 502;
    return res.status(status).json({ error: err.message ?? 'Quote analysis failed' });
  }
};
