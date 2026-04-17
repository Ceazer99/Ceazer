/**
 * Ceazers 3D — Image Generation Serverless Function
 * POST /api/generate-image  { key: "<slot>" }
 *
 * Uses Google's nano-banana-pro-preview (Gemini image generation model)
 * via the generateContent endpoint. Falls back to gemini-2.5-flash-image
 * if the primary model is unavailable.
 *
 * The GEMINI_API_KEY is server-side only — never exposed to the browser.
 */

'use strict';

const { applyCors, rateLimit } = require('./_lib/guard');

/* ── Allowed slot keys ──────────────────────────────────────────────────── */
const PROMPTS = {
  bracket: `Photorealistic 3D render of a precision-machined stainless steel
    industrial bracket assembly with bolt holes and mounting gussets.
    Isometric engineering view, dark studio background, cool blue rim
    lighting, sharp detail, 4K quality, professional product photography.`,

  prototype: `Professional product photography of a white 3D-printed consumer
    electronics enclosure prototype. Dark matte surface, engineering
    prototype aesthetic, soft overhead studio lighting, clean and minimal,
    highly detailed surface finish visible.`,

  startup: `Modern smart-home IoT device on a matte black surface. Sleek
    injection-moulded housing with subtle LED indicator glow, minimalist
    industrial design, dark background, cool blue accent lighting,
    photorealistic product render, 4K quality.`,

  hero: `Dark cinematic engineering workspace: dual monitors showing 3D CAD
    models of mechanical parts, FDM 3D printer with glowing nozzle in
    background, blue accent lighting, wide angle, shallow depth of field,
    commercial photography.`,

  'service-cad': `Wireframe CAD drawing of a complex mechanical assembly on a
    dark blue technical grid background, bright clean construction lines,
    3D modelling software aesthetic, professional engineering visualisation.`,

  'service-print': `Macro close-up of an FDM 3D printer extruder depositing
    molten filament onto a technical part, orange glow from heated nozzle,
    very dark background, sharp detail, professional macro photography.`,

  'service-proto': `Flat-lay top-down photograph of five rapid prototype
    iterations of the same mechanical component in different colours of
    3D-printed plastic on a clean white surface, professional studio
    lighting, product photography.`,

  'service-product': `Engineering product development progression: hand sketch,
    CAD model screenshot, and 3D-printed prototype side by side on a dark
    surface, professional studio photography, blue accent lighting.`,
};

const ALLOWED_KEYS = new Set(Object.keys(PROMPTS));

/* ── Model priority list ────────────────────────────────────────────────── */
// nano-banana-pro-preview is the model the user requested.
// We fall back in order if one returns a non-retryable error.
const MODELS = [
  'gemini-2.0-flash-exp-image-generation',
];

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/* ── Call one model, return { imageData, mimeType } or throw ────────────── */
async function callModel(modelId, prompt, apiKey) {
  const url = `${BASE_URL}/${modelId}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt.replace(/\s+/g, ' ').trim() }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  const body = await res.json();

  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  // Extract the first inline image part from the response
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find(p => p.inlineData?.data);

  if (!imgPart) {
    throw new Error(`No image in response from ${modelId}`);
  }

  return {
    imageData: imgPart.inlineData.data,
    mimeType:  imgPart.inlineData.mimeType || 'image/png',
  };
}

/* ── Main handler ───────────────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  // CORS (origin-restricted) — handles OPTIONS preflight
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: 4 image generations per minute per IP (expensive endpoint)
  if (!rateLimit(req, res, { max: 4, windowMs: 60_000, key: 'generate-image' })) return;

  // Validate key
  const { key } = req.body ?? {};
  if (!key || !ALLOWED_KEYS.has(key)) {
    return res.status(400).json({
      error: `Invalid key. Allowed: ${[...ALLOWED_KEYS].join(', ')}`,
    });
  }

  // Guard API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not configured on the server.',
    });
  }

  const prompt = PROMPTS[key];
  let lastError;

  // Try each model in order
  for (const modelId of MODELS) {
    try {
      const result = await callModel(modelId, prompt, apiKey);
      console.log(`[img] ${key} generated via ${modelId}`);
      return res.status(200).json(result);
    } catch (err) {
      console.warn(`[img] ${modelId} failed for "${key}": ${err.message}`);
      lastError = err;
      // Don't retry on client errors other than rate-limit
      if (err.status && err.status !== 429 && err.status !== 503) break;
    }
  }

  const status = lastError?.status ?? 502;
  return res.status(status).json({ error: lastError?.message ?? 'Image generation failed' });
};
