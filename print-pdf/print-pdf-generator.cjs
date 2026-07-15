/**
 * print-pdf-generator.js
 * Generates a print-ready PDF per Bookpod spec (bookpod.co.il).
 *
 * Page size: 22×22 cm + 3.2mm bleed each side = 226.4×226.4 mm
 * Resolution: 300 DPI
 * Structure: 28 single pages (not spreads) — see LIFEBOOK_SPEC.md section 3
 *
 * Pipeline:
 *   1. Fetch book from Supabase
 *   2. Load images → Buffer
 *   3. Outpaint each image to 1:1 square (left=illustration, right=bg for text)
 *      → save each outpainted image to print-pdf/debug/ immediately
 *   4. Upscale via Replicate Real-ESRGAN
 *      → save each upscaled image to print-pdf/debug/ immediately
 *   5. Render Hebrew text overlays (node-canvas)
 *   6. Build 28-page PDF — single pages, no page numbers, full bleed
 *
 * PILOT MODE: set pilotPages=2 to process only first 2 spreads (4 pages).
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, REPLICATE_API_TOKEN
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const OpenAI           = require('openai');
const PDFDocument      = require('pdfkit');
const fs               = require('fs');
const path             = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────

// 22cm + 3.2mm bleed × 2 sides = 226.4mm
const BLEED_MM  = 3.2;
const PAGE_MM   = 220 + BLEED_MM * 2;        // 226.4mm
const MM_TO_PT  = 2.83465;                    // 1mm = 2.83465pt
const PAGE_PT   = PAGE_MM * MM_TO_PT;         // ~641.5pt

// Text margins (inside bleed zone, from bleed edge)
const MARGIN_INNER_MM = BLEED_MM + 10;        // 13.2mm from edge → 10mm safe margin
const MARGIN_OUTER_MM = BLEED_MM + 6;         // 9.2mm from edge → 6mm safe margin

const OUTPUT_DIR = path.join(__dirname, 'output');
// DEBUG_DIR is now per-book: path.join(__dirname, 'debug', bookId) — set in generatePrintPDF

// ─── Clients ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('[print-pdf] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[print-pdf] Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[print-pdf] HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function toBuffer(imageValue) {
  if (!imageValue) return null;
  if (typeof imageValue === 'string' && imageValue.startsWith('http')) {
    return fetchBuffer(imageValue);
  }
  if (typeof imageValue === 'string') {
    const match = imageValue.match(/^data:[^;]+;base64,(.+)$/);
    if (match) return Buffer.from(match[1], 'base64');
    return Buffer.from(imageValue, 'base64');
  }
  return null;
}

function elapsed(start) {
  return `+${((Date.now() - start) / 1000).toFixed(1)}s`;
}

/** Write a buffer to the per-book debug dir. Returns the file path. */
function saveDebug(debugDir, filename, buffer) {
  fs.mkdirSync(debugDir, { recursive: true });
  const fp = path.join(debugDir, filename);
  fs.writeFileSync(fp, buffer);
  console.log(`[print-pdf] debug saved: ${fp} (${(buffer.length / 1024).toFixed(0)}KB)`);
  return fp;
}

// ─── Supabase: fetch book ─────────────────────────────────────────────────────

async function fetchBook(bookId) {
  const supabase = getSupabase();
  // Column names are snake_case — matches server.js getBookLight() / dbRowToBook()
  const { data, error } = await supabase
    .from('books')
    .select('book_id, child_name, child_age, child_gender, generated_book, cover_image, full_images, language')
    .eq('book_id', bookId)
    .maybeSingle();

  if (error) throw new Error(`[print-pdf] Supabase fetch failed: ${error.message}`);
  if (!data)  throw new Error(`[print-pdf] Book not found: ${bookId}`);

  return {
    bookId:        data.book_id,
    childName:     data.child_name      || '',
    childAge:      data.child_age       || '',
    childGender:   data.child_gender    || '',
    language:      data.language        || 'he',
    generatedBook: data.generated_book  || null,
    coverImage:    data.cover_image     || null,
    fullImages:    data.full_images     || [],
  };
}

// ─── OpenAI outpainting ───────────────────────────────────────────────────────

const OUTPAINT_PAGE_PROMPT =
  'Extend this children\'s storybook illustration to the right to create a square 1:1 composition. ' +
  'The right half should be a natural, bright, quiet continuation of the background — ' +
  'soft colors matching the left side, absolutely no characters, no faces, no text, no objects in the foreground. ' +
  'The left half (the original illustration) must remain completely unchanged — same colors, same characters, same details. ' +
  'The right half should be suitable as a clean backdrop for printed Hebrew text.';

const OUTPAINT_COVER_PROMPT =
  'Extend this children\'s storybook cover illustration to the right to create a square 1:1 composition. ' +
  'The right half should be a harmonious continuation of the background atmosphere and color palette — ' +
  'soft, warm, no characters, no faces, no text. The left half must remain completely unchanged.';

/**
 * Outpaint image to 1:1 square.
 * Returns Buffer of resulting PNG.
 */
async function outpaintToSquare(openai, imageBuffer, label, isCover = false) {
  console.log(`[print-pdf] outpainting ${label}...`);
  const prompt = isCover ? OUTPAINT_COVER_PROMPT : OUTPAINT_PAGE_PROMPT;

  // OpenAI images.edit needs a File-like with name
  const { toFile } = require('openai');
  const imageFile = await toFile(imageBuffer, 'image.png', { type: 'image/png' });

  const response = await openai.images.edit({
    model:  'gpt-image-1',
    image:  imageFile,
    prompt,
    size:   '1024x1024',
    n:      1,
  });

  const result = response.data[0];
  if (result.b64_json) return Buffer.from(result.b64_json, 'base64');
  if (result.url)      return fetchBuffer(result.url);
  throw new Error(`[print-pdf] outpaintToSquare: no b64_json or url in response for ${label}`);
}

// ─── Replicate Real-ESRGAN upscaling ─────────────────────────────────────────

async function upscaleImage(imageBuffer, label) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('[print-pdf] Missing REPLICATE_API_TOKEN');

  console.log(`[print-pdf] upscaling ${label} via Real-ESRGAN...`);
  const b64     = imageBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;

  // Use model endpoint (latest version)
  const createRes = await fetch('https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions', {
    method:  'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { image: dataUrl, scale: 4, face_enhance: false } }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`[print-pdf] Replicate create failed for ${label}: ${createRes.status} — ${body}`);
  }

  const prediction   = await createRes.json();
  const predictionId = prediction.id;
  const deadline     = Date.now() + 6 * 60 * 1000; // 6 min max

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!pollRes.ok) throw new Error(`[print-pdf] Replicate poll failed: ${pollRes.status}`);

    const status = await pollRes.json();
    if (status.status === 'succeeded') {
      const outputUrl = Array.isArray(status.output) ? status.output[0] : status.output;
      return fetchBuffer(outputUrl);
    }
    if (status.status === 'failed' || status.status === 'canceled') {
      throw new Error(`[print-pdf] Replicate upscale failed for ${label}: ${status.error || status.status}`);
    }
  }
  throw new Error(`[print-pdf] Replicate upscale timed out for ${label}`);
}

// ─── Hebrew text rendering via node-canvas ────────────────────────────────────

/**
 * Render Hebrew story text to a PNG buffer sized for a full print page.
 * The outpainted image is used as background — this PNG is composited on top.
 * Returns a PNG buffer, or null if canvas is unavailable.
 */
/**
 * Sample the average luminance of the right half of squareBuffer (the outpainted bg area).
 * Returns a value 0–255; < 128 = dark background.
 */
function sampleBgLuminance(squareBuffer) {
  try {
    const { createCanvas, loadImage } = require('canvas');
    // Work at a small size for speed — 100×100 samples the right half
    const SAMP = 100;
    const canvas = createCanvas(SAMP, SAMP);
    const ctx    = canvas.getContext('2d');
    const img    = new (require('canvas').Image)();
    img.src = squareBuffer;
    // Draw only the right half of the square into our sample canvas
    ctx.drawImage(img, img.width / 2, 0, img.width / 2, img.height, 0, 0, SAMP, SAMP);
    const data = ctx.getImageData(0, 0, SAMP, SAMP).data;
    let total = 0;
    const pixels = SAMP * SAMP;
    for (let i = 0; i < data.length; i += 4) {
      // Relative luminance per ITU-R BT.601
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return total / pixels;
  } catch (e) {
    // Default to "light background" if sampling fails
    return 200;
  }
}

/**
 * Render Hebrew story text to a PNG buffer sized for a full print page.
 * Adapts text color to background brightness and adds a shadow for legibility.
 * @param {string} text
 * @param {Buffer} squareBuffer — the outpainted square image used to detect bg brightness
 */
/**
 * Convert any image buffer (PNG/JPEG) to JPEG at q85 via canvas.
 * This is applied to all story images before PDF embedding to keep file < 80MB.
 */
function toJpegBuffer(imgBuffer, quality = 0.85) {
  try {
    const { createCanvas, Image } = require('canvas');
    const img = new Image();
    img.src = imgBuffer;
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toBuffer('image/jpeg', { quality });
  } catch (e) {
    console.warn(`[print-pdf] toJpegBuffer failed: ${e.message} — using original buffer`);
    return imgBuffer;
  }
}

function renderHebrewTextPng(text, squareBuffer) {
  try {
    const { createCanvas } = require('canvas');
    const PX = Math.round(PAGE_MM / 25.4 * 300);  // ~2673px at 300 DPI
    const MARGIN_PX = Math.round(MARGIN_INNER_MM / 25.4 * 300);

    // Detect background brightness → pick text color + shadow
    const lum = squareBuffer ? sampleBgLuminance(squareBuffer) : 200;
    const isDark       = lum < 128;
    const textColor    = isDark ? '#f5f0e0' : '#2c1a0e';   // warm cream on dark, dark brown on light
    const shadowColor  = isDark ? 'rgba(0,0,0,0.75)'       : 'rgba(255,255,255,0.6)';
    const shadowBlur   = Math.round(PX * 0.006);           // ~16px at 300DPI
    const shadowOff    = Math.round(PX * 0.003);           // ~8px
    console.log(`[print-pdf] text overlay: bg lum=${lum.toFixed(0)} → ${isDark ? 'light text on dark bg' : 'dark text on light bg'}`);

    const canvas = createCanvas(PX, PX);
    const ctx    = canvas.getContext('2d');
    ctx.clearRect(0, 0, PX, PX);   // transparent bg — outpainted img is below

    const FONT_SIZE  = Math.round(PX * 0.042);   // ~112px ≈ 14pt at 300DPI
    const LINE_H     = Math.round(FONT_SIZE * 1.7);
    const MAX_W      = PX - MARGIN_PX * 2;

    ctx.font           = `${FONT_SIZE}px Arial Unicode MS, Arial, sans-serif`;
    ctx.fillStyle      = textColor;
    ctx.textAlign      = 'right';
    ctx.direction      = 'rtl';
    ctx.shadowColor    = shadowColor;
    ctx.shadowBlur     = shadowBlur;
    ctx.shadowOffsetX  = isDark ?  shadowOff : -shadowOff;
    ctx.shadowOffsetY  = isDark ?  shadowOff : -shadowOff;

    // Word-wrap
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > MAX_W && cur) {
        lines.push(cur); cur = w;
      } else { cur = test; }
    }
    if (cur) lines.push(cur);

    const blockH = lines.length * LINE_H;
    let y = Math.max(MARGIN_PX, (PX - blockH) / 2) + FONT_SIZE;
    for (const line of lines) {
      ctx.fillText(line, PX - MARGIN_PX, y);
      y += LINE_H;
    }

    return canvas.toBuffer('image/png');
  } catch (e) {
    console.warn(`[print-pdf] canvas renderHebrewTextPng failed: ${e.message}`);
    return null;
  }
}

// ─── Logo loader ──────────────────────────────────────────────────────────────

const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'branding', 'lifebook-logo-print-cream.png');

/**
 * Load the Lifebook logo WebP and return it as a PNG Buffer via canvas.
 * Returns null if the file is not found (non-fatal).
 */
async function loadLogoPng() {
  try {
    const { createCanvas, loadImage } = require('canvas');
    const img    = await loadImage(LOGO_PATH);
    // Preserve aspect ratio; render at 600px wide
    const W      = 600;
    const H      = Math.round(img.height * (W / img.width));
    const canvas = createCanvas(W, H);
    canvas.getContext('2d').drawImage(img, 0, 0, W, H);
    return { buffer: canvas.toBuffer('image/png'), w: W, h: H };
  } catch (e) {
    console.warn(`[print-pdf] logo not found at ${LOGO_PATH}: ${e.message}`);
    return null;
  }
}

// ─── Frame page renderer via canvas (Hebrew-safe) ────────────────────────────

/**
 * Render a cream frame page entirely via node-canvas so Hebrew text is never
 * passed to pdfkit directly (which produces broken glyphs).
 *
 * @param {Array<{text,fontSize,color,bold,yFrac}>} textLines
 *   - yFrac: Y position as fraction of page height (0..1)
 *   - fontSize: in mm
 * @param {number[]} ruleYMms   Y positions (mm) for gold horizontal rules
 * @param {object|null} nameLine  If set: {yFrac} draws a gold underline (name field)
 * @param {object|null} logo      If set: {buffer, w, h} — logo image, centered at logoYFrac
 * @param {number} logoYFrac      Y center of logo as fraction (default 0.36)
 * @param {boolean} doubleBorder  If true: draws outer + inner gold rect border (like digital dedication page)
 * @returns Buffer  PNG buffer at 300 DPI
 */
function renderFramePagePng(textLines, ruleYMms = [], nameLine = null, logo = null, logoYFrac = 0.36, doubleBorder = false) {
  const { createCanvas, Image } = require('canvas');
  const PX    = Math.round(PAGE_MM / 25.4 * 300); // ~2673px at 300 DPI
  const mm2px = PX / PAGE_MM;

  const canvas = createCanvas(PX, PX);
  const ctx    = canvas.getContext('2d');

  // Cream background
  ctx.fillStyle = '#fdf8f0';
  ctx.fillRect(0, 0, PX, PX);

  // Double gold border frame (like digital dedication page)
  if (doubleBorder) {
    const PAD_OUT = 10 * mm2px;
    const PAD_IN  = 14 * mm2px;
    ctx.strokeStyle = '#c8a84b';
    ctx.lineWidth   = 1.2 * mm2px;
    ctx.strokeRect(PAD_OUT, PAD_OUT, PX - PAD_OUT * 2, PX - PAD_OUT * 2);
    ctx.lineWidth   = 0.5 * mm2px;
    ctx.strokeRect(PAD_IN, PAD_IN, PX - PAD_IN * 2, PX - PAD_IN * 2);
  }

  // Gold rules
  const ruleW = 1.4 * mm2px;
  for (const yMm of ruleYMms) {
    ctx.strokeStyle = '#c8a84b';
    ctx.lineWidth   = ruleW;
    ctx.beginPath();
    ctx.moveTo(MARGIN_OUTER_MM * mm2px, yMm * mm2px);
    ctx.lineTo((PAGE_MM - MARGIN_OUTER_MM) * mm2px, yMm * mm2px);
    ctx.stroke();
  }

  // Logo image centered
  if (logo) {
    // Logo rendered at ~1/4 of page width
    const logoW  = Math.round(PX * 0.26);
    const logoH  = Math.round(logo.h * (logoW / logo.w));
    const logoX  = (PX - logoW) / 2;
    const logoY  = logoYFrac * PX - logoH / 2;
    const img    = new Image();
    img.src      = logo.buffer;
    ctx.drawImage(img, logoX, logoY, logoW, logoH);

    // Thin gold rule below logo
    const ruleY = logoY + logoH + 18 * mm2px;
    ctx.strokeStyle = '#c8a84b';
    ctx.lineWidth   = 0.7 * mm2px;
    ctx.beginPath();
    ctx.moveTo(PX * 0.32, ruleY);
    ctx.lineTo(PX * 0.68, ruleY);
    ctx.stroke();
  }

  // Name underline (gold line where child writes their name)
  if (nameLine) {
    const y = nameLine.yFrac * PX;
    ctx.strokeStyle = '#c8a84b';
    ctx.lineWidth   = 0.9 * mm2px;
    ctx.beginPath();
    ctx.moveTo(50 * mm2px, y);
    ctx.lineTo((PAGE_MM - 50) * mm2px, y);
    ctx.stroke();
  }

  // Text — all via canvas so Hebrew renders correctly
  ctx.textAlign = 'center';
  ctx.direction = 'rtl';
  for (const line of textLines) {
    if (!line.text) continue;
    const fsPx = line.fontSize * mm2px;
    ctx.font      = `${line.bold ? '700 ' : '400 '}${fsPx}px Arial Unicode MS, Arial, sans-serif`;
    ctx.fillStyle = line.color || '#2c1a0e';
    ctx.fillText(line.text, PX / 2, line.yFrac * PX);
  }

  return canvas.toBuffer('image/png');
}

// ─── PDF builder — 28 single pages ───────────────────────────────────────────

async function buildPDF(book, spreads, outputPath, logo) {
  const doc = new PDFDocument({
    size:          [PAGE_PT, PAGE_PT],
    margin:        0,
    autoFirstPage: false,
    info: {
      Title:   book.generatedBook?.title || 'Lifebook — Print Edition',
      Author:  'Lifebook AI',
      Creator: 'Lifebook print-pdf-generator v2',
    },
  });

  const writeStream = fs.createWriteStream(outputPath);
  doc.pipe(writeStream);

  const title    = book.generatedBook?.title    || `הרפתקת ${book.childName}`;
  const subtitle = book.generatedBook?.subtitle || 'ספר ילדים מותאם אישית';
  const pages    = book.generatedBook?.pages    || [];

  // Helper: add a frame page from a canvas PNG buffer
  function addFramePage(pngBuffer) {
    doc.addPage();
    doc.image(pngBuffer, 0, 0, { width: PAGE_PT, height: PAGE_PT });
  }

  // ── PARITY NOTE ─────────────────────────────────────────────────────────────
  // Hebrew binding: odd pages = RIGHT side. Story spreads must start on an odd page
  // so that text pages (emitted first per spread) remain odd (right-hand).
  // Structure: 2 front pages → spreads start at page 3 (odd ✓) → 24 story pages
  // → 2 end pages = 28 total (divisible by 4 ✓).
  //
  // Page 1: הקדשה (odd = right)
  // Page 2: מעבר מעוצב — parity spacer (even = left, decorative only)
  // Pages 3–26: 12 spreads (text=odd=right ✓, illustration=even=left ✓)
  // Page 27: "ספר זה נוצר..." + logo (odd = right)
  // Page 28: back cover logo (even = left)

  // ── Page 1: הקדשה — double gold border + logo at bottom ───────────────────
  addFramePage(renderFramePagePng(
    [
      { text: title,       fontSize: 12, yFrac: 0.36, bold: true,  color: '#2c1a0e' },
      { text: subtitle,    fontSize:  7, yFrac: 0.46, bold: false, color: '#7a5c3a' },
      { text: '✦  ✦  ✦',  fontSize:  5, yFrac: 0.56, bold: false, color: '#c8a84b' },
      { text: 'lifebooksil.com', fontSize: 3.5, yFrac: 0.92, bold: false, color: '#b0905a' },
    ],
    [],          // no horizontal rules — border replaces them
    null,        // no name underline
    logo,        // logo centered near bottom
    0.80,        // logoYFrac — below text block
    true         // doubleBorder
  ));

  // ── Page 2: עמוד מעבר — scattered gold stars, no text ──────────────────────
  // Drawn procedurally; no text at all. Keeps spreads starting on page 3 (odd = right ✓).
  addFramePage((() => {
    const { createCanvas } = require('canvas');
    const PX    = Math.round(PAGE_MM / 25.4 * 300);
    const canvas = createCanvas(PX, PX);
    const ctx    = canvas.getContext('2d');
    ctx.fillStyle = '#fdf8f0';
    ctx.fillRect(0, 0, PX, PX);

    // Thin double border
    const mm2px = PX / PAGE_MM;
    ctx.strokeStyle = '#c8a84b';
    ctx.lineWidth   = 1.0 * mm2px;
    ctx.strokeRect(10 * mm2px, 10 * mm2px, PX - 20 * mm2px, PX - 20 * mm2px);
    ctx.lineWidth   = 0.4 * mm2px;
    ctx.strokeRect(14 * mm2px, 14 * mm2px, PX - 28 * mm2px, PX - 28 * mm2px);

    // Scattered gold stars — deterministic positions (seeded pattern, not random)
    const stars = [
      [0.15, 0.18, 28], [0.82, 0.14, 20], [0.50, 0.10, 34],
      [0.25, 0.50, 16], [0.75, 0.46, 22], [0.50, 0.50, 40],
      [0.12, 0.82, 18], [0.88, 0.80, 24], [0.50, 0.88, 28],
      [0.35, 0.28, 14], [0.65, 0.32, 12], [0.40, 0.72, 16],
      [0.60, 0.68, 18], [0.20, 0.65, 10], [0.80, 0.62, 10],
    ];
    for (const [xF, yF, sizeMm] of stars) {
      const fsPx = sizeMm * mm2px;
      const alpha = sizeMm > 25 ? 0.85 : sizeMm > 15 ? 0.55 : 0.35;
      ctx.font      = `${fsPx}px Arial Unicode MS, Arial, sans-serif`;
      ctx.fillStyle = `rgba(200, 168, 75, ${alpha})`;
      ctx.textAlign = 'center';
      ctx.fillText('✦', xF * PX, yF * PX);
    }
    return canvas.toBuffer('image/png');
  })());

  // ── Pages 3–26: 12 spreads × 2 pages each ─────────────────────────────────
  // Hebrew RTL book (per LIFEBOOK_SPEC.md §3):
  //   Odd pages  = RIGHT side (in Hebrew binding) → TEXT page
  //   Even pages = LEFT side                      → ILLUSTRATION page
  // Per spread: TEXT page first (→ odd), then ILLUSTRATION page (→ even).

  for (let i = 0; i < spreads.length; i++) {
    const spread    = spreads[i];

    if (!spread.squareBuffer) {
      throw new Error(`[print-pdf] spread ${i}: squareBuffer is null — cannot build page. Stopping.`);
    }

    // Page B — TEXT page (RIGHT / odd in Hebrew book): right half of the square image
    doc.addPage();
    doc.image(spread.squareBuffer, -PAGE_PT, 0, { width: PAGE_PT * 2, height: PAGE_PT });

    // Text overlay — canvas PNG (transparent bg composited on top of the bg image)
    if (spread.textOverlayPng) {
      doc.image(spread.textOverlayPng, 0, 0, { width: PAGE_PT, height: PAGE_PT });
    }

    // Page A — ILLUSTRATION page (LEFT / even in Hebrew book): left half of the square image
    doc.addPage();
    doc.image(spread.squareBuffer, 0, 0, { width: PAGE_PT * 2, height: PAGE_PT });

    // NO page numbers — per spec
  }

  // ── Page 27: "ספר זה נוצר במיוחד עבור [שם]" + לוגו ────────────────────────
  // Mirrors delivery.html back cover: cream/gold, logo, personal closing line, domain.
  // "סוף" is conveyed through this page (no separate end page — math requires 2 end pages).
  addFramePage(renderFramePagePng(
    [
      { text: `ספר זה נכתב במיוחד עבור ${book.childName}`, fontSize: 8,   yFrac: 0.60, bold: false, color: '#2c1a0e' },
      { text: 'שכל הרפתקה מתחילה ממך',                      fontSize: 6.5, yFrac: 0.68, bold: false, color: '#7a5c3a' },
      { text: 'lifebooksil.com',                              fontSize: 4.5, yFrac: 0.78, bold: false, color: '#a08060' },
    ],
    [18, PAGE_MM - 18],
    null,
    logo,
    0.34
  ));

  // ── Page 28: עמוד אחורי — לוגו + lifebooksil.com בלבד ─────────────────────
  addFramePage(renderFramePagePng(
    [
      { text: 'lifebooksil.com', fontSize: 5, yFrac: 0.62, bold: false, color: '#a08060' },
    ],
    [20, PAGE_MM - 20],
    null,
    logo,
    0.40
  ));

  doc.end();
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error',  reject);
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * generatePrintPDF(bookId, options)
 *   options.pilotPages — number of spreads to process (default: 12, pilot: 2)
 */
async function generatePrintPDF(bookId, options = {}) {
  const pilotPages  = options.pilotPages || 12;
  const globalStart = Date.now();
  let costEstimate  = 0;

  console.log(`[print-pdf] ── START ── bookId: ${bookId} pilotPages: ${pilotPages}`);
  console.log(`[print-pdf] Page size: ${PAGE_MM}×${PAGE_MM}mm (22cm + ${BLEED_MM}mm bleed each side)`);

  // Per-book debug dir — isolates files per book, prevents cross-contamination
  const debugDir   = path.join(__dirname, 'debug', bookId);
  fs.mkdirSync(debugDir,   { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`[print-pdf] Debug dir: ${debugDir}`);

  const suffix     = pilotPages < 12 ? `-pilot${pilotPages}` : '';
  const outputPath = path.join(OUTPUT_DIR, `book-${bookId}${suffix}-print.pdf`);

  // ── STEP 1: Fetch book ──────────────────────────────────────────────────────
  console.log(`[print-pdf] STEP 1: fetching book...`);
  const book = await fetchBook(bookId);
  console.log(`[print-pdf] STEP 1 done — child: ${book.childName}, pages: ${book.generatedBook?.pages?.length || 0} ${elapsed(globalStart)}`);

  // ── STEP 2: Load images as Buffers ─────────────────────────────────────────
  console.log(`[print-pdf] STEP 2: loading images...`);
  const pageBuffers = [];
  for (let i = 0; i < pilotPages; i++) {
    const buf = await toBuffer(book.fullImages[i] || null);
    if (!buf) console.warn(`[print-pdf] STEP 2: page ${i} image missing`);
    else      saveDebug(debugDir, `page-${i}-original.jpg`, buf);
    pageBuffers.push(buf);
  }
  console.log(`[print-pdf] STEP 2 done — ${pageBuffers.filter(Boolean).length}/${pilotPages} page images loaded ${elapsed(globalStart)}`);

  // ── STEP 3: Outpaint to 1:1 square ─────────────────────────────────────────
  // Reuse cached debug files if they exist — avoids paying for outpainting/upscaling again.
  console.log(`[print-pdf] STEP 3: outpainting ${pilotPages} page(s) to square...`);
  const openai = getOpenAI();
  const squareBuffers = [];

  for (let i = 0; i < pilotPages; i++) {
    const cachedUpscaled   = path.join(debugDir, `page-${i}-upscaled.png`);
    const cachedOutpainted = path.join(debugDir, `page-${i}-outpainted.png`);

    if (fs.existsSync(cachedUpscaled)) {
      console.log(`[print-pdf] STEP 3: page ${i} → using cached upscaled (no API call)`);
      squareBuffers.push(fs.readFileSync(cachedUpscaled));
      continue;
    }
    if (fs.existsSync(cachedOutpainted)) {
      console.log(`[print-pdf] STEP 3: page ${i} → using cached outpainted (no outpaint API call)`);
      squareBuffers.push(fs.readFileSync(cachedOutpainted));
      continue;
    }

    if (!pageBuffers[i]) {
      squareBuffers.push(null);
      continue;
    }
    const sq = await outpaintToSquare(openai, pageBuffers[i], `page-${i}`, false);
    saveDebug(debugDir, `page-${i}-outpainted.png`, sq);
    squareBuffers.push(sq);
    costEstimate += 0.04;
    console.log(`[print-pdf] STEP 3: page ${i} outpainted (+$0.04, total ~$${costEstimate.toFixed(2)}) ${elapsed(globalStart)}`);
  }

  // ── STEP 4: Upscale via Replicate Real-ESRGAN ───────────────────────────────
  console.log(`[print-pdf] STEP 4: upscaling ${pilotPages} page(s)...`);
  const upscaledBuffers = [];

  for (let i = 0; i < pilotPages; i++) {
    const cachedUpscaled = path.join(debugDir, `page-${i}-upscaled.png`);
    if (fs.existsSync(cachedUpscaled)) {
      console.log(`[print-pdf] STEP 4: page ${i} → using cached upscaled (no API call)`);
      upscaledBuffers.push(fs.readFileSync(cachedUpscaled));
      continue;
    }

    if (!squareBuffers[i]) {
      upscaledBuffers.push(null);
      continue;
    }
    const up = await upscaleImage(squareBuffers[i], `page-${i}`);
    saveDebug(debugDir, `page-${i}-upscaled.png`, up);
    upscaledBuffers.push(up);
    costEstimate += 0.01;
    console.log(`[print-pdf] STEP 4: page ${i} upscaled (+$0.01, total ~$${costEstimate.toFixed(2)}) ${elapsed(globalStart)}`);
  }

  // ── STEP 5: Render Hebrew text overlays ─────────────────────────────────────
  console.log(`[print-pdf] STEP 5: rendering Hebrew text overlays...`);
  const storyPages = book.generatedBook?.pages || [];
  const spreads    = [];

  for (let i = 0; i < pilotPages; i++) {
    const squareBuffer = upscaledBuffers[i] || squareBuffers[i];
    if (!squareBuffer) {
      throw new Error(`[print-pdf] STEP 5: spread ${i} has no square image. Cannot continue — outpainting must have failed. Check debug files.`);
    }

    // Convert to JPEG q85 before PDF embedding — keeps file well under 80MB
    const squareJpeg    = toJpegBuffer(squareBuffer, 0.875);

    const storyText     = storyPages[i]?.text || '';
    let textOverlayPng  = null;
    if (storyText) {
      textOverlayPng = renderHebrewTextPng(storyText, squareBuffer);
      if (textOverlayPng) saveDebug(debugDir, `page-${i}-text-overlay.png`, textOverlayPng);
    }
    spreads.push({ squareBuffer: squareJpeg, textOverlayPng });
  }
  console.log(`[print-pdf] STEP 5 done ${elapsed(globalStart)}`);

  // ── STEP 6: Build PDF ───────────────────────────────────────────────────────
  const expectedPages = 2 + (pilotPages * 2) + 2; // front×2 + spreads×2 + end×2
  console.log(`[print-pdf] STEP 6: building PDF — ${expectedPages} pages (${pilotPages} spreads)...`);

  const logo = await loadLogoPng();
  await buildPDF(book, spreads, outputPath, logo);

  const totalSec = ((Date.now() - globalStart) / 1000).toFixed(1);
  console.log(`[print-pdf] ── DONE ── ${totalSec}s — estimated cost: ~$${costEstimate.toFixed(2)}`);
  console.log(`[print-pdf] Output PDF:  ${outputPath}`);
  console.log(`[print-pdf] Debug files: ${debugDir}`);

  return { outputPath, debugDir, costEstimate, totalSeconds: parseFloat(totalSec), pages: expectedPages };
}

// ─── Cover file stub — NOT YET IMPLEMENTED ───────────────────────────────────
//
// TODO: generateCoverPDF(bookId, options)
//
// Requirements (per LIFEBOOK_SPEC.md §3 and pending Bookpod confirmation):
//
//   File format : Single flat page — back + spine + front (left-to-right).
//   Cover stock : Soft cover, Chromo 300g.
//   Dimensions  : Width = back(220mm) + spine(TBD) + front(220mm) + bleed(3.2mm × 2 sides)
//                 Height = 220mm + bleed(3.2mm × 2 sides) = 226.4mm
//   Spine width : Calculated from page count × paper thickness.
//                 ⚠️ BLOCKED: awaiting Bookpod confirmation of paper type/weight for
//                 illustrated children's books before spine width can be computed.
//
//   Front cover (rightmost panel):
//     - Full-bleed illustration from book.coverImage (cover_image from Supabase).
//     - Dynamic title overlay (book.generatedBook.title) — same Hebrew canvas rendering.
//     - Child's name (book.childName) — dynamic, never hardcoded.
//     - Lifebook logo bottom-right.
//
//   Back cover (leftmost panel):
//     - Cream background matching interior (#fdf8f0).
//     - Gold rules top/bottom.
//     - Logo centered + "סיפור קסום שנוצר במיוחד עבור [childName]" + lifebooksil.com.
//
//   Spine: cream background, vertical title text (Hebrew, top-to-bottom), logo at bottom.
//
//   Hebrew binding: front cover is on the RIGHT side of the flat file.
//   Validate layout against Bookpod preview system before first print run.

module.exports = { generatePrintPDF };
