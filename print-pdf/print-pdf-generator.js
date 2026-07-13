/**
 * print-pdf-generator.js
 * Generates a print-ready 22×22cm PDF (228×228mm with 3mm bleed each side).
 *
 * Pipeline per book:
 *   1. Fetch book data from Supabase
 *   2. Load all images (URL → Buffer, or base64 data-URL → Buffer)
 *   3. Outpaint each of 12 page images + cover to 1:1 square via OpenAI images.edit
 *   4. Upscale each image to 2670×2670px via Replicate Real-ESRGAN
 *   5. Build PDF with pdfkit (cover, dedication, 12 spreads, end page, back cover)
 *   6. Save to print-pdf/output/book-{bookId}-print.pdf
 *
 * Required npm packages (not yet installed — owner must approve):
 *   npm install pdfkit canvas
 *   npm install --save-dev @types/pdfkit   (optional, for IDE types)
 *
 * Required env vars (already set on Railway):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * New env var needed:
 *   REPLICATE_API_TOKEN  — get from replicate.com/account/api-tokens
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { createCanvas, registerFont } from "canvas";   // npm install canvas
import PDFDocument from "pdfkit";                       // npm install pdfkit
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Clients ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch a URL and return its body as a Buffer. */
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchBuffer: HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Normalise an image value (Supabase Storage URL or base64 data-URL) to a Buffer.
 * Returns null if the value is falsy.
 */
async function toBuffer(imageValue) {
  if (!imageValue) return null;
  if (imageValue.startsWith("http")) {
    return fetchBuffer(imageValue);
  }
  // base64 data URL: data:image/jpeg;base64,<data>
  const match = imageValue.match(/^data:[^;]+;base64,(.+)$/);
  if (match) return Buffer.from(match[1], "base64");
  // Raw base64 with no prefix
  return Buffer.from(imageValue, "base64");
}

/** ms since a start time, formatted as a string. */
function elapsed(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

// ─── Supabase: fetch book ─────────────────────────────────────────────────────

async function fetchBook(bookId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("book_id", bookId)
    .single();
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  if (!data) throw new Error(`Book not found: ${bookId}`);

  return {
    bookId:         data.book_id,
    childName:      data.child_name      || "",
    childAge:       data.child_age       || "",
    childGender:    data.child_gender    || "",
    generatedBook:  data.generated_book  || null,
    coverImage:     data.cover_image     || null,
    fullImages:     data.full_images     || [],
  };
}

// ─── OpenAI outpainting ───────────────────────────────────────────────────────

const OUTPAINT_PROMPT =
  "Extend this children's storybook illustration to the right to create a square composition. " +
  "The right half should be a natural, quiet continuation of the background — soft colors matching " +
  "the left side, no characters, no faces, no text, no objects in the foreground. " +
  "The left half must remain completely unchanged. " +
  "The result should be suitable as a backdrop for printed text.";

const COVER_OUTPAINT_PROMPT =
  "Extend this children's storybook cover illustration to the right to create a square composition. " +
  "The right half should be a harmonious continuation of the background atmosphere and color palette — " +
  "soft, warm, no characters, no text. The left half must remain completely unchanged.";

/**
 * Outpaint an image buffer to a 1:1 square using OpenAI images.edit.
 * Returns a Buffer of the resulting PNG.
 */
async function outpaintImage(openai, imageBuffer, isCover = false) {
  const prompt = isCover ? COVER_OUTPAINT_PROMPT : OUTPAINT_PROMPT;

  // OpenAI images.edit expects a File-like object with a name property.
  const imageFile = new File([imageBuffer], "image.png", { type: "image/png" });

  const response = await openai.images.edit({
    model:  "gpt-image-1",
    image:  imageFile,
    prompt,
    size:   "1024x1024",
    n:      1,
  });

  const result = response.data[0];

  // API may return b64_json or a URL
  if (result.b64_json) {
    return Buffer.from(result.b64_json, "base64");
  }
  if (result.url) {
    return fetchBuffer(result.url);
  }
  throw new Error("outpaintImage: no b64_json or url in OpenAI response");
}

// ─── Replicate Real-ESRGAN upscaling ─────────────────────────────────────────

const REPLICATE_MODEL =
  "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fdc3d1f7125b4da7f8e1a2f6b";

/**
 * Upscale an image buffer using Replicate Real-ESRGAN.
 * Returns a Buffer of the upscaled image.
 * Estimated cost: ~$0.01 per image.
 */
async function upscaleImage(imageBuffer) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("Missing REPLICATE_API_TOKEN");

  const b64 = imageBuffer.toString("base64");
  const dataUrl = `data:image/png;base64,${b64}`;

  // Create prediction
  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL.split(":")[1],
      input: {
        image:  dataUrl,
        scale:  4,        // 4× upscale: 1024 → 4096; we crop/resize to 2670
        face_enhance: false,
      },
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Replicate create prediction failed: ${createRes.status} — ${body}`);
  }

  const prediction = await createRes.json();
  const predictionId = prediction.id;

  // Poll until complete (max 5 minutes)
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));

    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!pollRes.ok) throw new Error(`Replicate poll failed: ${pollRes.status}`);

    const status = await pollRes.json();
    if (status.status === "succeeded") {
      const outputUrl = Array.isArray(status.output) ? status.output[0] : status.output;
      return fetchBuffer(outputUrl);
    }
    if (status.status === "failed" || status.status === "canceled") {
      throw new Error(`Replicate upscale failed: ${status.error || status.status}`);
    }
    // still processing — continue polling
  }

  throw new Error("Replicate upscale timed out after 5 minutes");
}

// ─── Hebrew text → canvas PNG ─────────────────────────────────────────────────

/**
 * Render Hebrew text to a PNG buffer using node-canvas.
 * Width/height in pixels at 300 DPI for the right-half text page (114mm wide × 228mm tall).
 *   114mm × (300/25.4) = ~1346px wide
 *   228mm × (300/25.4) = ~2693px tall
 */
function renderHebrewTextToPng(text, pageNumber, totalPages) {
  const W = 1346;
  const H = 2693;
  const MARGIN = 80;         // px
  const FONT_SIZE = 48;      // ~12pt at 300 DPI (1pt = 4px at 300 DPI)
  const LINE_HEIGHT = 72;
  const TEXT_COLOR = "#2c1a0e";
  const BG_COLOR   = "rgba(0,0,0,0)"; // transparent — blends over outpainted bg

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // Transparent background (will be composited over outpainted right half)
  ctx.clearRect(0, 0, W, H);

  // Text styling
  ctx.fillStyle   = TEXT_COLOR;
  ctx.font        = `${FONT_SIZE}px Arial, sans-serif`;
  ctx.textAlign   = "right";    // RTL
  ctx.direction   = "rtl";

  // Word-wrap
  const words = text.split(" ");
  const maxWidth = W - MARGIN * 2;
  const lines = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  // Center text block vertically
  const blockHeight = lines.length * LINE_HEIGHT;
  let y = Math.max(MARGIN, (H - blockHeight) / 2);

  for (const line of lines) {
    ctx.fillText(line, W - MARGIN, y);
    y += LINE_HEIGHT;
  }

  // Page number (bottom center, small)
  ctx.font      = `32px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#7a5c3a";
  ctx.fillText(`${pageNumber} / ${totalPages}`, W / 2, H - MARGIN);

  return canvas.toBuffer("image/png");
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

const MM_TO_PT = 2.8346; // 1mm = 2.8346pt (pdfkit uses points)
const PAGE_MM  = 228;    // 22cm + 3mm bleed each side
const PAGE_PT  = PAGE_MM * MM_TO_PT;

function addFullBleedImage(doc, imgBuffer, mimeType = "image/jpeg") {
  doc.image(imgBuffer, 0, 0, { width: PAGE_PT, height: PAGE_PT, cover: [PAGE_PT, PAGE_PT] });
}

function addCreamPage(doc) {
  doc.rect(0, 0, PAGE_PT, PAGE_PT).fill("#fdf8f0");
}

function addGoldRule(doc, yMm) {
  const yPt = yMm * MM_TO_PT;
  doc
    .moveTo(20 * MM_TO_PT, yPt)
    .lineTo((PAGE_MM - 20) * MM_TO_PT, yPt)
    .strokeColor("#c8a84b")
    .lineWidth(1.5)
    .stroke();
}

async function buildPDF(book, processedImages, outputPath) {
  const doc = new PDFDocument({
    size:    [PAGE_PT, PAGE_PT],
    margin:  0,
    autoFirstPage: false,
    info: {
      Title:   book.generatedBook?.title || "Lifebook — Print Edition",
      Author:  "Lifebook AI",
      Creator: "Lifebook print-pdf-generator",
    },
  });

  const writeStream = fs.createWriteStream(outputPath);
  doc.pipe(writeStream);

  const title    = book.generatedBook?.title    || `${book.childName}'s Magical Adventure`;
  const subtitle = book.generatedBook?.subtitle || "A personalized story";
  const pages    = book.generatedBook?.pages    || [];

  // ── Page 1: Front cover ────────────────────────────────────────────────────
  doc.addPage();
  if (processedImages.cover) {
    addFullBleedImage(doc, processedImages.cover);
  } else {
    addCreamPage(doc);
    doc.fontSize(36).fillColor("#2c1a0e").text(title, 40 * MM_TO_PT, 90 * MM_TO_PT, {
      width: (PAGE_MM - 80) * MM_TO_PT,
      align: "center",
    });
  }

  // ── Page 2: "הספר הזה שייך ל___" (This book belongs to) ──────────────────
  doc.addPage();
  addCreamPage(doc);
  addGoldRule(doc, 20);
  addGoldRule(doc, PAGE_MM - 20);

  const belongsText = "הספר הזה שייך ל";
  doc
    .fontSize(32 * MM_TO_PT / 10)
    .fillColor("#2c1a0e")
    .font("Helvetica")
    .text(belongsText, 20 * MM_TO_PT, 90 * MM_TO_PT, {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    });

  // Blank line for name
  const lineY = 115 * MM_TO_PT;
  doc
    .moveTo(60 * MM_TO_PT, lineY)
    .lineTo((PAGE_MM - 60) * MM_TO_PT, lineY)
    .strokeColor("#c8a84b")
    .lineWidth(1)
    .stroke();

  // ── Page 3: Dedication / title page ───────────────────────────────────────
  doc.addPage();
  addCreamPage(doc);
  addGoldRule(doc, 30);
  addGoldRule(doc, PAGE_MM - 30);

  doc
    .fontSize(40 * MM_TO_PT / 10)
    .fillColor("#2c1a0e")
    .font("Helvetica-Bold")
    .text(title, 20 * MM_TO_PT, 70 * MM_TO_PT, {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    })
    .moveDown(1)
    .fontSize(22 * MM_TO_PT / 10)
    .font("Helvetica")
    .text(subtitle, {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    })
    .moveDown(3)
    .fontSize(18 * MM_TO_PT / 10)
    .fillColor("#7a5c3a")
    .text(`✦ Lifebook AI ✦`, {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    });

  // ── Pages 4–15: 12 spreads ─────────────────────────────────────────────────
  // Each spread: left half = original illustration, right half = outpainted bg + text overlay
  const halfPT = PAGE_PT / 2;

  for (let i = 0; i < 12; i++) {
    doc.addPage();

    const pageData  = pages[i]   || {};
    const imgData   = processedImages.pages[i]; // { square: Buffer, textOverlay: Buffer }

    if (imgData?.square) {
      // Left half: first 512px columns of the 1024px square image = original illustration
      // Right half: second 512px columns = outpainted background
      // We position the full square image at x=0, width=full, then clip-crop for each half.
      // Since pdfkit doesn't have native clip-region per image, we use a trick:
      //   draw the full square at x=0, y=0, width=PAGE_PT (which auto-scales 1:1)
      //   then draw it again shifted left by halfPT so right half aligns to x=0
      //   (i.e., the right portion occupies x=0..halfPT on page)
      // Simpler approach: embed the full image twice at different x-offsets with clipping.

      // Left half (illustration side): show left portion of square
      doc.save();
      doc.rect(0, 0, halfPT, PAGE_PT).clip();
      doc.image(imgData.square, 0, 0, { width: PAGE_PT, height: PAGE_PT });
      doc.restore();

      // Right half (text side): show right portion of square image as background
      doc.save();
      doc.rect(halfPT, 0, halfPT, PAGE_PT).clip();
      doc.image(imgData.square, -halfPT, 0, { width: PAGE_PT, height: PAGE_PT });
      doc.restore();
    } else {
      // Fallback: cream background both halves
      addCreamPage(doc);
    }

    // Dividing gold rule between halves
    doc
      .moveTo(halfPT, 15 * MM_TO_PT)
      .lineTo(halfPT, (PAGE_MM - 15) * MM_TO_PT)
      .strokeColor("#c8a84b")
      .lineWidth(0.5)
      .stroke();

    // Text overlay on right half — render via canvas PNG if available, else plain text
    const storyText = pageData.text || pageData.body || "";

    if (imgData?.textOverlay && storyText) {
      // Embed canvas-rendered text PNG on right half
      doc.image(imgData.textOverlay, halfPT, 0, { width: halfPT, height: PAGE_PT });
    } else if (storyText) {
      // Fallback: embed text directly with pdfkit (Hebrew may not render RTL correctly)
      doc
        .fontSize(13 * MM_TO_PT / 10)
        .fillColor("#2c1a0e")
        .font("Helvetica")
        .text(storyText, halfPT + 8 * MM_TO_PT, 30 * MM_TO_PT, {
          width:  halfPT - 16 * MM_TO_PT,
          align:  "right",
          lineGap: 4,
        });
    }

    // Page number (center-bottom of right half)
    doc
      .fontSize(10 * MM_TO_PT / 10)
      .fillColor("#7a5c3a")
      .text(`${i + 1}`, halfPT + halfPT / 2 - 10, (PAGE_MM - 10) * MM_TO_PT, {
        width: 20,
        align: "center",
      });
  }

  // ── Page 16: End page ─────────────────────────────────────────────────────
  doc.addPage();
  addCreamPage(doc);
  addGoldRule(doc, 25);
  addGoldRule(doc, PAGE_MM - 25);

  doc
    .fontSize(36 * MM_TO_PT / 10)
    .fillColor("#2c1a0e")
    .font("Helvetica-Bold")
    .text("סוף... או התחלה?", 20 * MM_TO_PT, 85 * MM_TO_PT, {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    })
    .moveDown(1.5)
    .fontSize(20 * MM_TO_PT / 10)
    .font("Helvetica")
    .fillColor("#7a5c3a")
    .text("✦  ✦  ✦", {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    });

  // ── Page 17: Back cover ───────────────────────────────────────────────────
  doc.addPage();
  addCreamPage(doc);
  addGoldRule(doc, 20);
  addGoldRule(doc, PAGE_MM - 20);

  doc
    .fontSize(28 * MM_TO_PT / 10)
    .fillColor("#c8a84b")
    .font("Helvetica-Bold")
    .text("Lifebook AI", 20 * MM_TO_PT, 100 * MM_TO_PT, {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    })
    .moveDown(0.8)
    .fontSize(16 * MM_TO_PT / 10)
    .font("Helvetica")
    .fillColor("#7a5c3a")
    .text("ספר ילדים מותאם אישית", {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    })
    .moveDown(1)
    .fontSize(13 * MM_TO_PT / 10)
    .fillColor("#2c1a0e")
    .text("lifebooks.online", {
      width: (PAGE_MM - 40) * MM_TO_PT,
      align: "center",
    });

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generatePrintPDF(bookId) {
  const globalStart = Date.now();
  let costEstimate  = 0;

  console.log(`[print-pdf] ── START ── bookId: ${bookId}`);

  // Ensure output directory exists
  const outputDir = path.join(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `book-${bookId}-print.pdf`);

  // ── STEP 1: Fetch book ────────────────────────────────────────────────────
  console.log(`[print-pdf] STEP 1: Fetching book from Supabase...`);
  const book = await fetchBook(bookId);
  console.log(`[print-pdf] STEP 1 done — child: ${book.childName}, pages: ${book.generatedBook?.pages?.length || 0} ${elapsed(globalStart)}`);

  // ── STEP 2: Load all images as Buffers ────────────────────────────────────
  console.log(`[print-pdf] STEP 2: Loading images...`);
  const coverBuffer = await toBuffer(book.coverImage);
  const pageBuffers = [];
  for (let i = 0; i < 12; i++) {
    const buf = await toBuffer(book.fullImages[i] || null);
    pageBuffers.push(buf);
    if (!buf) console.warn(`[print-pdf] STEP 2: page ${i} image missing — will use blank`);
  }
  console.log(`[print-pdf] STEP 2 done — cover: ${coverBuffer ? "OK" : "MISSING"}, pages loaded: ${pageBuffers.filter(Boolean).length}/12 ${elapsed(globalStart)}`);

  // ── STEP 3: Outpaint to 1:1 square ───────────────────────────────────────
  console.log(`[print-pdf] STEP 3: Outpainting images to square...`);
  const openai = getOpenAI();

  let squareCover = null;
  if (coverBuffer) {
    console.log(`[print-pdf] STEP 3: outpainting cover...`);
    squareCover = await outpaintImage(openai, coverBuffer, true);
    costEstimate += 0.04;
    console.log(`[print-pdf] STEP 3: cover outpainted (+$0.04, total ~$${costEstimate.toFixed(2)}) ${elapsed(globalStart)}`);
  }

  const squarePages = [];
  for (let i = 0; i < 12; i++) {
    if (pageBuffers[i]) {
      console.log(`[print-pdf] STEP 3: outpainting page ${i}...`);
      const sq = await outpaintImage(openai, pageBuffers[i], false);
      squarePages.push(sq);
      costEstimate += 0.04;
      console.log(`[print-pdf] STEP 3: page ${i} outpainted (+$0.04, total ~$${costEstimate.toFixed(2)}) ${elapsed(globalStart)}`);
    } else {
      squarePages.push(null);
    }
  }

  // ── STEP 4: Upscale via Replicate Real-ESRGAN ────────────────────────────
  console.log(`[print-pdf] STEP 4: Upscaling with Real-ESRGAN...`);

  let upscaledCover = null;
  if (squareCover) {
    console.log(`[print-pdf] STEP 4: upscaling cover...`);
    upscaledCover = await upscaleImage(squareCover);
    costEstimate += 0.01;
    console.log(`[print-pdf] STEP 4: cover upscaled (+$0.01, total ~$${costEstimate.toFixed(2)}) ${elapsed(globalStart)}`);
  }

  const upscaledPages = [];
  for (let i = 0; i < 12; i++) {
    if (squarePages[i]) {
      console.log(`[print-pdf] STEP 4: upscaling page ${i}...`);
      const up = await upscaleImage(squarePages[i]);
      upscaledPages.push(up);
      costEstimate += 0.01;
      console.log(`[print-pdf] STEP 4: page ${i} upscaled (+$0.01, total ~$${costEstimate.toFixed(2)}) ${elapsed(globalStart)}`);
    } else {
      upscaledPages.push(null);
    }
  }

  // ── STEP 5: Render Hebrew text overlays via node-canvas ──────────────────
  console.log(`[print-pdf] STEP 5: Rendering Hebrew text overlays...`);
  const pages       = book.generatedBook?.pages || [];
  const totalPages  = pages.length || 12;
  const pageImages  = []; // { square: Buffer, textOverlay: Buffer|null }

  for (let i = 0; i < 12; i++) {
    const square = upscaledPages[i] || squarePages[i] || null;
    let textOverlay = null;
    const storyText = pages[i]?.text || pages[i]?.body || "";
    if (storyText && square) {
      try {
        textOverlay = renderHebrewTextToPng(storyText, i + 1, totalPages);
      } catch (canvasErr) {
        console.warn(`[print-pdf] STEP 5: canvas render failed for page ${i}: ${canvasErr.message} — will use pdfkit text fallback`);
      }
    }
    pageImages.push({ square, textOverlay });
  }
  console.log(`[print-pdf] STEP 5 done ${elapsed(globalStart)}`);

  // ── STEP 6: Build PDF ─────────────────────────────────────────────────────
  console.log(`[print-pdf] STEP 6: Building PDF...`);

  const processedImages = {
    cover: upscaledCover || squareCover || coverBuffer,
    pages: pageImages,
  };

  await buildPDF(book, processedImages, outputPath);

  const totalSec  = ((Date.now() - globalStart) / 1000).toFixed(1);
  console.log(`[print-pdf] ── DONE ── ${totalSec}s — estimated API cost: ~$${costEstimate.toFixed(2)}`);
  console.log(`[print-pdf] Output: ${outputPath}`);

  return { outputPath, costEstimate, totalSeconds: parseFloat(totalSec) };
}
