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

const DEBUG_DIR  = path.join(__dirname, 'debug');
const OUTPUT_DIR = path.join(__dirname, 'output');

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

/** Write a buffer to debug dir. Returns the file path. */
function saveDebug(filename, buffer) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const fp = path.join(DEBUG_DIR, filename);
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
function renderHebrewTextPng(text) {
  try {
    const { createCanvas } = require('canvas');
    // Full page at 300 DPI: 226.4mm × (300/25.4) ≈ 2673px
    const PX = Math.round(PAGE_MM / 25.4 * 300);  // ~2673
    const MARGIN_PX = Math.round(MARGIN_INNER_MM / 25.4 * 300);

    const canvas = createCanvas(PX, PX);
    const ctx    = canvas.getContext('2d');
    ctx.clearRect(0, 0, PX, PX);   // transparent bg — outpainted img is below

    const FONT_SIZE  = Math.round(PX * 0.042);   // ~112px ≈ 14pt at 300DPI
    const LINE_H     = Math.round(FONT_SIZE * 1.7);
    const MAX_W      = PX - MARGIN_PX * 2;

    ctx.font        = `${FONT_SIZE}px Arial Unicode MS, Arial, sans-serif`;
    ctx.fillStyle   = '#2c1a0e';
    ctx.textAlign   = 'right';
    ctx.direction   = 'rtl';

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
    console.warn(`[print-pdf] canvas renderHebrewTextPng failed: ${e.message} — will embed text via pdfkit`);
    return null;
  }
}

// ─── PDF builder — 28 single pages ───────────────────────────────────────────

/**
 * addFullBleedPage: adds a new page and tiles the image buffer full-bleed.
 * CRITICAL: image must cover the entire PAGE_PT×PAGE_PT area including bleed.
 */
function addFullBleedPage(doc, imgBuffer) {
  if (!imgBuffer) throw new Error('[print-pdf] addFullBleedPage: imgBuffer is null — outpainted image missing. Stopping.');
  doc.addPage();
  doc.image(imgBuffer, 0, 0, { width: PAGE_PT, height: PAGE_PT });
}

function addCreamPage(doc) {
  doc.addPage();
  doc.rect(0, 0, PAGE_PT, PAGE_PT).fill('#fdf8f0');
}

function goldRule(doc, yMm) {
  doc
    .moveTo(MARGIN_OUTER_MM * MM_TO_PT, yMm * MM_TO_PT)
    .lineTo((PAGE_MM - MARGIN_OUTER_MM) * MM_TO_PT, yMm * MM_TO_PT)
    .strokeColor('#c8a84b').lineWidth(1.2).stroke();
}

async function buildPDF(book, spreads, outputPath) {
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

  const title    = book.generatedBook?.title    || `${book.childName}'s Magical Adventure`;
  const subtitle = book.generatedBook?.subtitle || 'A personalized story';
  const pages    = book.generatedBook?.pages    || [];

  // ── Page 1: "הספר הזה שייך ל___" ──────────────────────────────────────────
  addCreamPage(doc);
  goldRule(doc, 18);
  goldRule(doc, PAGE_MM - 18);
  doc.fontSize(28 * MM_TO_PT / 10).fillColor('#2c1a0e').font('Helvetica')
     .text('הספר הזה שייך ל', MARGIN_OUTER_MM * MM_TO_PT, PAGE_MM * 0.38 * MM_TO_PT,
           { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' });
  // blank line for name
  const lineY = PAGE_MM * 0.52 * MM_TO_PT;
  doc.moveTo(50 * MM_TO_PT, lineY).lineTo((PAGE_MM - 50) * MM_TO_PT, lineY)
     .strokeColor('#c8a84b').lineWidth(0.8).stroke();

  // ── Page 2: Dedication / title page ────────────────────────────────────────
  addCreamPage(doc);
  goldRule(doc, 28);
  goldRule(doc, PAGE_MM - 28);
  doc.fontSize(36 * MM_TO_PT / 10).fillColor('#2c1a0e').font('Helvetica-Bold')
     .text(title, MARGIN_OUTER_MM * MM_TO_PT, PAGE_MM * 0.30 * MM_TO_PT,
           { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' })
     .moveDown(1)
     .fontSize(20 * MM_TO_PT / 10).font('Helvetica').fillColor('#7a5c3a')
     .text(subtitle, { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' })
     .moveDown(3)
     .fontSize(15 * MM_TO_PT / 10).fillColor('#c8a84b')
     .text('✦  ✦  ✦', { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' });

  // ── Pages 3–26: 12 spreads × 2 pages each ─────────────────────────────────
  // Per LIFEBOOK_SPEC.md option A:
  //   Illustration page: LEFT side of the 1:1 square (original, uncropped) — full bleed
  //   Text page:         RIGHT side of the 1:1 square (outpainted bg) + Hebrew text overlay

  for (let i = 0; i < spreads.length; i++) {
    const spread = spreads[i];
    const storyText = pages[i]?.text || '';

    // Page A — Illustration: full-bleed with the illustration side of the square
    // We render the full square image but positioned so only the LEFT half fills the page.
    // The outpainted square is 1:1 (e.g. 4096×4096 after upscale).
    // To show only the left half: place image at x=0, width=PAGE_PT*2 (double width),
    // so left half (original illustration) occupies x=0..PAGE_PT.
    if (!spread.squareBuffer) {
      throw new Error(`[print-pdf] spread ${i}: squareBuffer is null — cannot build page. Stopping.`);
    }
    doc.addPage();
    // Show left half of square (illustration) by doubling the render width
    doc.image(spread.squareBuffer, 0, 0, { width: PAGE_PT * 2, height: PAGE_PT });

    // Page B — Text: outpainted right-half background + text overlay
    // Re-render the same square, shifted left by PAGE_PT so the RIGHT half fills the page
    doc.addPage();
    doc.image(spread.squareBuffer, -PAGE_PT, 0, { width: PAGE_PT * 2, height: PAGE_PT });

    // Text overlay — prefer canvas PNG, fallback to pdfkit text
    if (spread.textOverlayPng) {
      // Canvas PNG is full-page, transparent bg — composite on top
      doc.image(spread.textOverlayPng, 0, 0, { width: PAGE_PT, height: PAGE_PT });
    } else if (storyText) {
      // pdfkit text fallback (no Hebrew RTL guarantee, but better than blank)
      console.warn(`[print-pdf] spread ${i}: using pdfkit text fallback (no canvas PNG)`);
      const textX = MARGIN_INNER_MM * MM_TO_PT;
      const textW = (PAGE_MM - MARGIN_INNER_MM - MARGIN_OUTER_MM) * MM_TO_PT;
      doc.fontSize(13 * MM_TO_PT / 10).fillColor('#2c1a0e').font('Helvetica')
         .text(storyText, textX, PAGE_MM * 0.25 * MM_TO_PT, { width: textW, align: 'right', lineGap: 4 });
    }
    // NO page numbers — per spec
  }

  // ── Page 27: End page ──────────────────────────────────────────────────────
  addCreamPage(doc);
  goldRule(doc, 24);
  goldRule(doc, PAGE_MM - 24);
  doc.fontSize(32 * MM_TO_PT / 10).fillColor('#2c1a0e').font('Helvetica-Bold')
     .text('סוף... או התחלה?', MARGIN_OUTER_MM * MM_TO_PT, PAGE_MM * 0.38 * MM_TO_PT,
           { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' })
     .moveDown(2)
     .fontSize(18 * MM_TO_PT / 10).font('Helvetica').fillColor('#c8a84b')
     .text('✦  ✦  ✦', { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' });

  // ── Page 28: Logo page ─────────────────────────────────────────────────────
  addCreamPage(doc);
  goldRule(doc, 20);
  goldRule(doc, PAGE_MM - 20);
  doc.fontSize(26 * MM_TO_PT / 10).fillColor('#c8a84b').font('Helvetica-Bold')
     .text('Lifebook AI', MARGIN_OUTER_MM * MM_TO_PT, PAGE_MM * 0.40 * MM_TO_PT,
           { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' })
     .moveDown(0.8)
     .fontSize(14 * MM_TO_PT / 10).font('Helvetica').fillColor('#7a5c3a')
     .text('ספר ילדים מותאם אישית', { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' })
     .moveDown(1)
     .fontSize(12 * MM_TO_PT / 10).fillColor('#2c1a0e')
     .text('lifebooks.online', { width: (PAGE_MM - MARGIN_OUTER_MM * 2) * MM_TO_PT, align: 'center' });

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

  fs.mkdirSync(DEBUG_DIR,  { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
    else      saveDebug(`page-${i}-original.jpg`, buf);
    pageBuffers.push(buf);
  }
  console.log(`[print-pdf] STEP 2 done — ${pageBuffers.filter(Boolean).length}/${pilotPages} page images loaded ${elapsed(globalStart)}`);

  // ── STEP 3: Outpaint to 1:1 square ─────────────────────────────────────────
  console.log(`[print-pdf] STEP 3: outpainting ${pilotPages} page(s) to square...`);
  const openai = getOpenAI();
  const squareBuffers = [];

  for (let i = 0; i < pilotPages; i++) {
    if (!pageBuffers[i]) {
      squareBuffers.push(null);
      continue;
    }
    const sq = await outpaintToSquare(openai, pageBuffers[i], `page-${i}`, false);
    saveDebug(`page-${i}-outpainted.png`, sq);
    squareBuffers.push(sq);
    costEstimate += 0.04;
    console.log(`[print-pdf] STEP 3: page ${i} outpainted (+$0.04, total ~$${costEstimate.toFixed(2)}) ${elapsed(globalStart)}`);
  }

  // ── STEP 4: Upscale via Replicate Real-ESRGAN ───────────────────────────────
  console.log(`[print-pdf] STEP 4: upscaling ${pilotPages} page(s)...`);
  const upscaledBuffers = [];

  for (let i = 0; i < pilotPages; i++) {
    if (!squareBuffers[i]) {
      upscaledBuffers.push(null);
      continue;
    }
    const up = await upscaleImage(squareBuffers[i], `page-${i}`);
    saveDebug(`page-${i}-upscaled.png`, up);
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

    const storyText     = storyPages[i]?.text || '';
    let textOverlayPng  = null;
    if (storyText) {
      textOverlayPng = renderHebrewTextPng(storyText);
      if (textOverlayPng) saveDebug(`page-${i}-text-overlay.png`, textOverlayPng);
    }
    spreads.push({ squareBuffer, textOverlayPng });
  }
  console.log(`[print-pdf] STEP 5 done ${elapsed(globalStart)}`);

  // ── STEP 6: Build PDF ───────────────────────────────────────────────────────
  // For pilot: only the processed spreads + front matter + end pages
  // Full 28-page structure is maintained; pilot just has fewer story spreads.
  const expectedPages = 2 + (pilotPages * 2) + 2; // front×2 + spreads×2 + end×2
  console.log(`[print-pdf] STEP 6: building PDF — ${expectedPages} pages (${pilotPages} spreads)...`);

  await buildPDF(book, spreads, outputPath);

  const totalSec = ((Date.now() - globalStart) / 1000).toFixed(1);
  console.log(`[print-pdf] ── DONE ── ${totalSec}s — estimated cost: ~$${costEstimate.toFixed(2)}`);
  console.log(`[print-pdf] Output PDF:  ${outputPath}`);
  console.log(`[print-pdf] Debug files: ${DEBUG_DIR}`);

  return { outputPath, debugDir: DEBUG_DIR, costEstimate, totalSeconds: parseFloat(totalSec), pages: expectedPages };
}

module.exports = { generatePrintPDF };
