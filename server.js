import express from "express";
import cors from "cors";
import OpenAI from "openai";
import Stripe from "stripe";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const app = express();
app.use(cors());

// ─── Stripe webhook needs the RAW body for signature verification ─────────────
app.use("/webhooks/stripe", express.raw({ type: "*/*", limit: "25mb" }));
app.use(express.json({ limit: "25mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

// ─── Clients ──────────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Utilities ────────────────────────────────────────────────────────────────
function safeJsonParse(raw, fallback = {}) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sanitizeBrandTerms(text = "") {
  return String(text)
    .replaceAll(/\bBatman\b/gi, "superhero")
    .replaceAll(/\bIron\s*Man\b/gi, "red superhero")
    .replaceAll(/\bMarvel\b/gi, "comic-style")
    .replaceAll(/\bDisney\b/gi, "storybook")
    .replaceAll(/\bPixar\b/gi, "3D animated")
    .replaceAll(/\bSuperman\b/gi, "heroic")
    .replaceAll(/\bSpider[- ]?Man\b/gi, "web hero")
    .replaceAll(/\bFrozen\b/gi, "snowy fantasy")
    .replaceAll(/\bMickey\b/gi, "cartoon mouse")
    .replaceAll(/\bMinnie\b/gi, "cartoon character");
}

function sanitizeStoryPayload(obj = {}) {
  return {
    ...obj,
    childName:          sanitizeBrandTerms(obj.childName || ""),
    storyIdea:          sanitizeBrandTerms(obj.storyIdea || ""),
    illustrationStyle:  sanitizeBrandTerms(obj.illustrationStyle || ""),
    croppedPhoto:       obj.croppedPhoto  || "",
    originalPhoto:      obj.originalPhoto || ""
  };
}

function sanitizeImagePrompt(text = "") {
  return sanitizeBrandTerms(text)
    .replaceAll(/\blogo\b/gi,      "symbol")
    .replaceAll(/\bbrand\b/gi,     "design")
    .replaceAll(/\btrademark\b/gi, "graphic detail");
}

function buildCharacterPromptCore(characterDNA, style) {
  const hair    = characterDNA.hair    || "soft child hair";
  const skin    = characterDNA.skin    || "natural skin tone";
  const eyes    = characterDNA.eyes    || "gentle expressive eyes";
  const face    = characterDNA.face    || "soft child face";
  const vibe    = characterDNA.vibe    || "warm curious child";
  const ageLook = characterDNA.ageLook || "young child";
  const outfit  = characterDNA.outfit  || "simple timeless child outfit";

  return `
Main character reference:
- ${ageLook}
- Hair: ${hair}
- Skin tone: ${skin}
- Eyes: ${eyes}
- Face: ${face}
- Outfit style: ${outfit}
- General vibe: ${vibe}

Keep this exact same child character consistent across all illustrations.
Do not change the child's identity, age appearance, hair color, skin tone, or facial structure.
Illustration style must be: ${style}.
`.trim();
}

async function normalizeImageToBase64(imageItem) {
  if (!imageItem) return null;
  if (imageItem?.b64_json) return imageItem.b64_json;
  if (imageItem?.url) {
    const r   = await fetch(imageItem.url);
    const arr = await r.arrayBuffer();
    return Buffer.from(arr).toString("base64");
  }
  return null;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
function dbRowToBook(row) {
  if (!row) return null;
  return {
    bookId:           row.book_id,
    childName:        row.child_name        || "",
    childAge:         row.child_age         || "",
    childGender:      row.child_gender      || "",
    storyIdea:        row.story_idea        || "",
    illustrationStyle:row.illustration_style|| "",
    croppedPhoto:     row.cropped_photo     || "",
    originalPhoto:    row.original_photo    || "",
    customerEmail:    row.customer_email    || "",
    characterReference: row.character_reference || null,
    generatedBook:    row.generated_book    || null,
    coverImage:       row.cover_image       || null,
    previewImages:    row.preview_images    || [],
    fullImages:       row.full_images       || [],
    selectedFormat:   row.selected_format   || "digital",
    selectedPrice:    row.selected_price    || 39,
    paymentStatus:    row.payment_status    || "pending",
    purchaseUnlocked: row.purchase_unlocked === true,
    stripeSessionId:  row.stripe_session_id || null,
    createdAt:        row.created_at        || null,
    updatedAt:        row.updated_at        || null
  };
}

function patchToDbFields(patch = {}) {
  const dbPatch = {};
  if ("childName"          in patch) dbPatch.child_name          = patch.childName;
  if ("childAge"           in patch) dbPatch.child_age           = patch.childAge;
  if ("childGender"        in patch) dbPatch.child_gender        = patch.childGender;
  if ("storyIdea"          in patch) dbPatch.story_idea          = patch.storyIdea;
  if ("illustrationStyle"  in patch) dbPatch.illustration_style  = patch.illustrationStyle;
  if ("croppedPhoto"       in patch) dbPatch.cropped_photo       = patch.croppedPhoto;
  if ("originalPhoto"      in patch) dbPatch.original_photo      = patch.originalPhoto;
  if ("customerEmail"      in patch) dbPatch.customer_email      = patch.customerEmail;
  if ("characterReference" in patch) dbPatch.character_reference = patch.characterReference;
  if ("generatedBook"      in patch) dbPatch.generated_book      = patch.generatedBook;
  if ("coverImage"         in patch) dbPatch.cover_image         = patch.coverImage;
  if ("previewImages"      in patch) dbPatch.preview_images      = patch.previewImages;
  if ("fullImages"         in patch) dbPatch.full_images         = patch.fullImages;
  if ("selectedFormat"     in patch) dbPatch.selected_format     = patch.selectedFormat;
  if ("selectedPrice"      in patch) dbPatch.selected_price      = patch.selectedPrice;
  if ("paymentStatus"      in patch) dbPatch.payment_status      = patch.paymentStatus;
  if ("purchaseUnlocked"   in patch) dbPatch.purchase_unlocked   = patch.purchaseUnlocked;
  if ("stripeSessionId"    in patch) dbPatch.stripe_session_id   = patch.stripeSessionId;
  dbPatch.updated_at = new Date().toISOString();
  return dbPatch;
}

async function insertBook(book) {
  const { error } = await supabase
    .from("books")
    .insert({
      book_id:            book.bookId,
      child_name:         book.childName,
      child_age:          book.childAge,
      child_gender:       book.childGender,
      story_idea:         book.storyIdea,
      illustration_style: book.illustrationStyle,
      cropped_photo:      book.croppedPhoto,
      original_photo:     book.originalPhoto,
      customer_email:     book.customerEmail || "",
      character_reference:book.characterReference,
      generated_book:     book.generatedBook,
      cover_image:        book.coverImage,
      preview_images:     book.previewImages,
      full_images:        book.fullImages,
      selected_format:    book.selectedFormat,
      selected_price:     book.selectedPrice,
      payment_status:     book.paymentStatus,
      purchase_unlocked:  book.purchaseUnlocked,
      stripe_session_id:  book.stripeSessionId
    });
  if (error) throw error;
  return book;
}

async function getBook(bookId) {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  return dbRowToBook(data);
}

async function updateBook(bookId, patch) {
  const dbPatch = patchToDbFields(patch);
  const { data, error } = await supabase
    .from("books")
    .update(dbPatch)
    .eq("book_id", bookId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return dbRowToBook(data);
}

// Lightweight update — NO .select() — safe for large image data
async function updateBookField(bookId, patch) {
  const dbPatch = patchToDbFields(patch);
  const { error } = await supabase
    .from("books")
    .update(dbPatch)
    .eq("book_id", bookId);
  if (error) throw error;
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/books/:bookId", async (req, res) => {
  try {
    const book = await getBook(req.params.bookId);
    if (!book) return res.status(404).json({ status: "error", message: "Book not found" });
    return res.json({ status: "ok", book });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err?.message || "Failed to fetch book" });
  }
});

// ─── Email: Payment confirmation (sent immediately after payment) ─────────────
async function sendPaymentConfirmationEmail(book) {
  if (!book.customerEmail) return;

  const appUrl    = process.env.APP_URL || "https://lifebooks.online";
  const childName = book.childName || "your child";
  const bookTitle = book.generatedBook?.title || `${childName}'s Magical Adventure`;

  try {
    await resend.emails.send({
      from:    "Lifebook <books@lifebooks.online>",
      to:      book.customerEmail,
      subject: `✅ Payment confirmed — ${childName}'s book is being created!`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#fdf6ec;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6ec;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(100,60,20,0.12);border:1px solid #ede0c8;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1008,#5c3d1e);padding:36px;text-align:center;">
            <div style="font-family:Georgia,serif;font-size:28px;color:#f5d98a;letter-spacing:0.5px;">lifebook</div>
            <div style="font-size:11px;color:#c4a87a;margin-top:5px;letter-spacing:2px;text-transform:uppercase;">AI Children's Storybooks</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="font-family:Georgia,serif;font-size:26px;color:#3a2810;margin:0 0 12px;line-height:1.2;">
              Payment confirmed! ✅
            </p>
            <p style="font-size:15px;color:#7a6048;line-height:1.7;margin:0 0 24px;">
              We received your payment and <strong>${childName}'s</strong> personalized storybook is now being created.
              Our AI is writing the story and illustrating every page — this usually takes <strong>5–10 minutes</strong>.
            </p>

            <!-- Status box -->
            <table cellpadding="0" cellspacing="0" width="100%" style="background:#fdf6ec;border-radius:14px;border:1px solid #ede0c8;margin-bottom:24px;">
              <tr>
                <td style="padding:18px 22px;">
                  <p style="font-family:Georgia,serif;font-size:17px;color:#5c3d1e;margin:0 0 6px;">"${bookTitle}"</p>
                  <p style="font-size:13px;color:#8a6240;margin:0 0 14px;">A personalized story for ${childName}</p>
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-right:28px;">
                        <span style="font-size:10px;color:#c8922a;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Status</span><br/>
                        <span style="font-size:14px;color:#3a2810;">Creating illustrations...</span>
                      </td>
                      <td>
                        <span style="font-size:10px;color:#c8922a;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Est. time</span><br/>
                        <span style="font-size:14px;color:#3a2810;">5–10 minutes</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="font-size:14px;color:#7a6048;line-height:1.7;margin:0;">
              You'll receive a second email as soon as your book is ready to read and download.
              No need to keep this page open — we'll come to you! 📬
            </p>

            <hr style="border:none;border-top:1px solid #f0e4d0;margin:24px 0 18px;" />

            <p style="font-size:12px;color:#b09070;line-height:1.6;margin:0;">
              Questions? Just reply to this email and we'll help right away.<br/>
              Thank you for creating with Lifebook 💛
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fdf6ec;border-top:1px solid #ede0c8;padding:16px 40px;text-align:center;">
            <p style="font-size:11px;color:#c4a87a;margin:0;">
              © 2026 Lifebook · <a href="${appUrl}/contact.html" style="color:#c8922a;text-decoration:none;">Contact Us</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
      `.trim()
    });
    console.log("Payment confirmation email sent to:", book.customerEmail);
  } catch(err) {
    console.error("Failed to send payment confirmation email:", err.message);
  }
}

// ─── Email: Book ready (sent only after ALL images are generated) ─────────────
async function sendBookReadyEmail(book) {
  if (!book.customerEmail) return;

  const appUrl    = process.env.APP_URL || "https://lifebooks.online";
  const bookTitle = book.generatedBook?.title    || "Your Magical Storybook";
  const bookSub   = book.generatedBook?.subtitle || "A personalized adventure";
  const childName = book.childName || "your child";
  const pageCount = book.generatedBook?.pages?.length || 16;
  const downloadUrl = `${appUrl}/delivery.html?bookId=${book.bookId}`;

  try {
    await resend.emails.send({
      from: "Lifebook <books@lifebooks.online>",
      to:   book.customerEmail,
      subject: `✨ ${childName}'s book is ready! "${bookTitle}"`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#fdf6ec;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6ec;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(100,60,20,0.12);border:1px solid #ede0c8;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1008,#5c3d1e);padding:40px;text-align:center;">
            <div style="font-size:36px;margin-bottom:10px;">📖</div>
            <div style="font-family:Georgia,serif;font-size:30px;color:#f5d98a;letter-spacing:0.5px;">lifebook</div>
            <div style="font-size:12px;color:#c4a87a;margin-top:5px;letter-spacing:2px;text-transform:uppercase;">AI Children's Storybooks</div>
          </td>
        </tr>

        <!-- Hero message -->
        <tr>
          <td style="padding:40px 44px 28px;">
            <p style="font-family:Georgia,serif;font-size:28px;color:#3a2810;margin:0 0 14px;line-height:1.2;">
              🎉 ${childName}'s book is ready!
            </p>
            <p style="font-size:16px;color:#7a6048;line-height:1.7;margin:0 0 28px;">
              Your personalized storybook has been beautifully crafted and is waiting for you.
            </p>

            <!-- Book info box -->
            <table cellpadding="0" cellspacing="0" width="100%" style="background:#fdf6ec;border-radius:16px;border:1px solid #ede0c8;margin-bottom:28px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="font-family:Georgia,serif;font-size:20px;color:#5c3d1e;margin:0 0 4px;">"${bookTitle}"</p>
                  <p style="font-size:14px;color:#8a6240;margin:0 0 14px;font-style:italic;">${bookSub}</p>
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-right:24px;">
                        <span style="font-size:11px;color:#c8922a;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Pages</span><br/>
                        <span style="font-size:15px;color:#3a2810;">${pageCount} illustrated pages</span>
                      </td>
                      <td>
                        <span style="font-size:11px;color:#c8922a;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Hero</span><br/>
                        <span style="font-size:15px;color:#3a2810;">${childName}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:linear-gradient(135deg,#e8b84b,#c8922a);border-radius:50px;padding:16px 40px;box-shadow:0 6px 24px rgba(200,146,42,0.35);">
                  <a href="${downloadUrl}"
                     style="font-family:Arial,sans-serif;font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;display:block;white-space:nowrap;">
                    Read &amp; Download My Book →
                  </a>
                </td>
              </tr>
            </table>

            <p style="font-size:13px;color:#b09070;line-height:1.6;margin:0 0 8px;">Or copy this link:</p>
            <p style="font-size:12px;color:#c8922a;word-break:break-all;margin:0 0 32px;background:#fdf6ec;padding:10px 14px;border-radius:10px;border:1px solid #ede0c8;">
              ${downloadUrl}
            </p>

            <hr style="border:none;border-top:1px solid #f0e4d0;margin:0 0 20px;" />

            <p style="font-size:13px;color:#b09070;line-height:1.7;margin:0;">
              Questions or issues? Just reply to this email and we'll help right away.<br/>
              Thank you for creating with Lifebook 💛
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fdf6ec;border-top:1px solid #ede0c8;padding:18px 44px;text-align:center;">
            <p style="font-size:12px;color:#c4a87a;margin:0;">
              © 2026 Lifebook · AI Children's Storybooks · <a href="${appUrl}/contact.html" style="color:#c8922a;text-decoration:none;">Contact Us</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
      `.trim()
    });
    console.log("Book ready email sent to:", book.customerEmail);
  } catch(err) {
    console.error("Failed to send book ready email:", err.message);
    // Don't throw — email failure should not break the book generation
  }
}

app.post("/api/books/create", async (req, res) => {
  try {
    const cleanInput = sanitizeStoryPayload(req.body || {});
    const rawInput   = req.body || {};
    const bookId     = crypto.randomUUID();

    const book = {
      bookId,
      childName:         cleanInput.childName        || "",
      childAge:          rawInput.childAge            || "",
      childGender:       rawInput.childGender         || "",
      storyIdea:         cleanInput.storyIdea         || "",
      illustrationStyle: cleanInput.illustrationStyle || "Soft Storybook",
      croppedPhoto:      cleanInput.croppedPhoto      || "",
      originalPhoto:     cleanInput.originalPhoto     || "",
      customerEmail:     rawInput.customerEmail       || "",
      characterReference:null,
      generatedBook:     null,
      coverImage:        null,
      previewImages:     [],
      fullImages:        [],
      selectedFormat:    "digital",
      selectedPrice:     39,
      paymentStatus:     "pending",
      purchaseUnlocked:  false,
      stripeSessionId:   null
    };

    await insertBook(book);
    return res.json({ status: "ok", bookId });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err?.message || "Failed to create book" });
  }
});

app.patch("/api/books/:bookId", async (req, res) => {
  try {
    const updated = await updateBook(req.params.bookId, req.body || {});
    if (!updated) return res.status(404).json({ status: "error", message: "Book not found" });
    return res.json({ status: "ok", book: updated });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err?.message || "Failed to update book" });
  }
});

// ─── Stripe: Create Checkout Session ─────────────────────────────────────────
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { bookId, format } = req.body;

    if (!bookId) {
      return res.status(400).json({ status: "error", message: "Missing bookId" });
    }

    const book = await getBook(bookId);
    if (!book) {
      return res.status(404).json({ status: "error", message: "Book not found" });
    }

    const isDigital    = (format || book.selectedFormat) !== "printed";
    const priceInCents = isDigital ? 3900 : 4900; // $39 / $49
    const productName  = isDigital
      ? `Lifebook — Digital Edition (${book.childName})`
      : `Lifebook — Printed Book (${book.childName})`;

    const appUrl = process.env.APP_URL || "https://lifebooks.online";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: productName,
              description: `Personalized storybook: "${book.generatedBook?.title || "Your Magical Adventure"}"`,
              images: book.coverImage ? [] : [] // Stripe requires hosted URLs, not base64
            },
            unit_amount: priceInCents
          },
          quantity: 1
        }
      ],
      mode: "payment",
      metadata: {
        bookId,
        format: isDigital ? "digital" : "printed"
      },
      success_url: `${appUrl}/success.html?bookId=${bookId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/checkout.html?bookId=${bookId}`
    });

    // Save session ID to book so we can link it on webhook
    await updateBook(bookId, { stripeSessionId: session.id });

    return res.json({ status: "ok", url: session.url });
  } catch (err) {
    console.error("Stripe session error:", err);
    return res.status(500).json({ status: "error", message: err?.message || "Failed to create checkout session" });
  }
});

// ─── Stripe Webhook ───────────────────────────────────────────────────────────
app.post("/webhooks/stripe", async (req, res) => {
  const sig           = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookId  = session.metadata?.bookId;

    if (!bookId) {
      console.warn("Stripe webhook: no bookId in metadata");
      return res.status(200).send("ok");
    }

    // ── Respond to Stripe IMMEDIATELY (must be within 30s) ──
    res.status(200).send("ok");

    // ── Do the heavy work in background (non-blocking) ──
    (async () => {
      try {
        await updateBook(bookId, {
          paymentStatus:    "paid",
          purchaseUnlocked: true,
          stripeSessionId:  session.id
        });
        console.log(`Book ${bookId} unlocked via Stripe`);

        // Send payment confirmation email immediately
        // Book ready email will be sent later by generate-full when all images are done
        const paidBook = await getBook(bookId);
        await sendPaymentConfirmationEmail(paidBook);
        console.log(`Payment confirmation email sent to: ${paidBook?.customerEmail}`);

        // Edge case: if book was already fully generated before payment
        // (e.g. user paid after generation completed), send book ready email now too
        const pages      = paidBook?.generatedBook?.pages || [];
        const images     = paidBook?.fullImages || [];
        const allDone    = pages.length > 0 && images.filter(Boolean).length >= pages.length;
        if (allDone) {
          console.log(`Book ${bookId} was already complete at payment time — sending book ready email`);
          await sendBookReadyEmail(paidBook);
        }
      } catch (err) {
        console.error("Stripe post-payment processing failed:", err.message);
      }
    })();

    return; // already sent response above
  }

  return res.status(200).send("ok");
});

// ─── Unlock endpoint (manual / dev) ──────────────────────────────────────────
app.post("/api/books/:bookId/unlock", async (req, res) => {
  try {
    const updated = await updateBook(req.params.bookId, {
      paymentStatus:    "paid",
      purchaseUnlocked: true
    });
    if (!updated) return res.status(404).json({ status: "error", message: "Book not found" });

    try {
      const unlockedBook = await getBook(req.params.bookId);
      // Send payment confirmation
      await sendPaymentConfirmationEmail(unlockedBook);
      // If book already fully generated, also send book ready email
      const pages   = unlockedBook?.generatedBook?.pages || [];
      const images  = unlockedBook?.fullImages || [];
      const allDone = pages.length > 0 && images.filter(Boolean).length >= pages.length;
      if (allDone) {
        await sendBookReadyEmail(unlockedBook);
        console.log(`Unlock: both emails sent to ${unlockedBook?.customerEmail}`);
      } else {
        console.log(`Unlock: payment confirmation sent, book ready will follow when generation completes`);
      }
    } catch (emailErr) {
      console.error("Failed to send emails on unlock:", emailErr.message);
    }

    return res.json({ status: "ok", book: updated });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err?.message || "Failed to unlock book" });
  }
});

// ─── Generate Full Book (story + cover + images) — fires in background ────────
app.post("/api/books/:bookId/generate-full", async (req, res) => {
  const bookId = req.params.bookId;

  // Respond immediately so crop.js can redirect to preview
  res.json({ status: "ok", message: "Generation started in background" });

  // Run everything async — errors are caught and saved to DB
  (async () => {
    try {
      const book = await getBook(bookId);
      if (!book) { console.error("generate-full: book not found", bookId); return; }

      console.log(`generate-full [${bookId}]: START — child: ${book.childName}, style: ${book.illustrationStyle}`);

      const childName         = book.childName         || "The Child";
      const childAge          = book.childAge          || "5";
      const childGender       = book.childGender       || "not specified";
      const storyIdea         = book.storyIdea         || "a magical adventure";
      const illustrationStyle = book.illustrationStyle || "Soft Storybook";
      const croppedPhoto      = book.croppedPhoto      || book.originalPhoto || "";
      const safeStyle         = sanitizeBrandTerms(illustrationStyle);

      // ── STEP 1: Character reference (photo → DNA + prompt core) ──────────────
      let characterReference = book.characterReference || null;

      if (!characterReference && croppedPhoto) {
        try {
          const dnaCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyze the uploaded child photo and return ONLY JSON.\nReturn:\n{\n  "hair": "string",\n  "skin": "string",\n  "eyes": "string",\n  "face": "string",\n  "ageLook": "string",\n  "outfit": "string",\n  "vibe": "string",\n  "summary": "string"\n}\nRules:\n- Focus only on the child\n- Ignore any brand names, logos, copyrighted characters, or toy franchises\n- If clothing includes a recognizable character or logo, describe it generically`
                },
                { type: "image_url", image_url: { url: croppedPhoto } }
              ]
            }],
            temperature: 0.2
          });

          const characterDNA = safeJsonParse(dnaCompletion.choices?.[0]?.message?.content || "{}", {
            hair: "soft child hair", skin: "warm natural skin tone",
            eyes: "bright child eyes", face: "soft rounded child face",
            ageLook: "young child", outfit: "simple timeless child outfit",
            vibe: "warm curious child", summary: "A warm curious child hero for a magical storybook."
          });

          const promptCore = buildCharacterPromptCore(characterDNA, safeStyle);
          characterReference = {
            characterDNA,
            characterPromptCore: promptCore,
            characterSummary: characterDNA.summary || "A warm curious child hero."
          };
          await updateBookField(bookId, { characterReference });
        } catch (err) {
          console.warn("generate-full: character reference failed, continuing without it:", err.message);
          characterReference = {
            characterDNA: {},
            characterPromptCore: `A young child aged ${childAge}, warm storybook style.`,
            characterSummary: `A ${childAge}-year-old child hero.`
          };
          await updateBookField(bookId, { characterReference });
        }
      }

      const promptCore       = characterReference?.characterPromptCore || `A young child aged ${childAge}.`;
      const characterSummary = characterReference?.characterSummary    || `A ${childAge}-year-old child hero.`;
      console.log(`generate-full [${bookId}]: STEP 1 done — character reference ready`);

      // ── STEP 2: Generate story text ───────────────────────────────────────────
      if (!book.generatedBook?.pages?.length) {
        const storyPrompt = `You are a premium personalized children's book writer.\n\nChild name: ${sanitizeBrandTerms(childName)}\nChild age: ${childAge}\nChild gender: ${childGender}\nStory direction: ${sanitizeBrandTerms(storyIdea)}\nIllustration style: ${safeStyle}\n\nCharacter summary:\n${sanitizeBrandTerms(characterSummary)}\n\nCharacter consistency instructions:\n${sanitizeBrandTerms(promptCore)}\n\nReturn ONLY JSON:\n{\n  "title": "string",\n  "subtitle": "string",\n  "pages": [\n    {\n      "text": "string",\n      "imagePrompt": "string"\n    }\n  ]\n}\n\nRules:\n- Exactly 16 story pages\n- Each page text must be 35-70 words\n- The child must clearly be the hero\n- imagePrompt must describe the same child consistently\n- No page numbers inside text\n- No brand names\n- Do not mention copyrighted characters or logos
- If the child's name contains Hebrew characters, write the ENTIRE story in Hebrew (including title, subtitle, and all page text). Keep imagePrompt always in English for image generation.
- If the name is in English or Latin characters, write in English`;

        const storyCompletion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: storyPrompt }],
          temperature: 0.8
        });

        const storyRaw  = storyCompletion.choices?.[0]?.message?.content || "{}";
        const storyData = safeJsonParse(storyRaw, {});
        const generatedBook = {
          title:    sanitizeBrandTerms(storyData.title    || `The Magical Adventure of ${childName}`),
          subtitle: sanitizeBrandTerms(storyData.subtitle || "A story where you are the hero"),
          pages:    Array.isArray(storyData.pages)
            ? storyData.pages.slice(0, 16).map(p => ({
                text:        sanitizeBrandTerms(String(p.text        || "").trim()),
                imagePrompt: sanitizeImagePrompt(String(p.imagePrompt || "").trim())
              }))
            : []
        };
        await updateBookField(bookId, { generatedBook });
      }

      // ── STEP 3+4a: Cover + first 2 page images IN PARALLEL ──────────────────
      // Running them together cuts the wait from ~2min to ~60s
      console.log(`generate-full [${bookId}]: STEP 2 done — story written, starting cover + priority images in parallel`);

      const bookBeforeImgs = await getBook(bookId);
      const pages          = bookBeforeImgs.generatedBook?.pages || [];
      const title          = bookBeforeImgs.generatedBook?.title    || `The Magical Adventure of ${childName}`;
      const subtitle       = bookBeforeImgs.generatedBook?.subtitle || "A story where you are the hero";
      const existingImages = bookBeforeImgs.fullImages || [];
      const fullImages     = [...existingImages];
      while (fullImages.length < pages.length) fullImages.push(null);

      // פונקציה ליצירת תמונה אחת
      async function generatePageImage(pageIndex) {
        const page = pages[pageIndex];
        const imgPrompt = `Create a premium children's storybook illustration.\n\nIllustration style: ${safeStyle}\n\nCharacter consistency:\n${sanitizeBrandTerms(promptCore)}\n\nScene:\n${sanitizeImagePrompt(page.imagePrompt || "")}\n\nRules:\n- same child identity\n- same face structure\n- same hair and skin tone\n- warm magical storybook aesthetic\n- no text\n- no watermark\n- elegant composition\n- no logos\n- no brand names\n- no copyrighted costume emblems`;
        const imgResp = await openai.images.generate({ model: "gpt-image-1", prompt: imgPrompt, size: "1024x1024" });
        return await normalizeImageToBase64(imgResp?.data?.[0]);
      }

      // Cover prompt
      const coverPrompt = `Create a premium children's storybook COVER illustration.\n\nIllustration style: ${safeStyle}\n\nLOCKED CHILD CHARACTER:\n${sanitizeBrandTerms(promptCore)}\n\nSHORT CHARACTER SUMMARY:\n${sanitizeBrandTerms(characterSummary)}\n\nBOOK TITLE:\n${sanitizeBrandTerms(title)}\n\nBOOK SUBTITLE:\n${sanitizeBrandTerms(subtitle)}\n\nSTORY DIRECTION:\n${sanitizeBrandTerms(storyIdea)}\n\nRules:\n- create ONE beautiful single cover illustration\n- show the child as the hero\n- magical, premium, warm\n- no character sheet\n- no multiple poses\n- no text rendered into the image\n- no watermark\n- no logos\n- no copyrighted costume emblems`;

      // Run cover + pages 0 and 1 all at once in parallel
      const [coverResult, page0Result, page1Result] = await Promise.allSettled([
        bookBeforeImgs.coverImage ? Promise.resolve(null) : openai.images.generate({ model: "gpt-image-1", prompt: coverPrompt, size: "1024x1024" }),
        fullImages[0] ? Promise.resolve(null) : generatePageImage(0),
        fullImages[1] ? Promise.resolve(null) : generatePageImage(1),
      ]);

      // Save cover
      if (coverResult?.status === "fulfilled" && coverResult.value) {
        const coverBase64 = await normalizeImageToBase64(coverResult.value?.data?.[0]);
        if (coverBase64) await updateBookField(bookId, { coverImage: `data:image/jpeg;base64,${coverBase64}` });
      }

      // Save priority pages
      if (page0Result?.status === "fulfilled" && page0Result.value) {
        fullImages[0] = `data:image/jpeg;base64,${page0Result.value}`;
        await updateBookField(bookId, { fullImages: [...fullImages] });
      }
      if (page1Result?.status === "fulfilled" && page1Result.value) {
        fullImages[1] = `data:image/jpeg;base64,${page1Result.value}`;
        await updateBookField(bookId, { fullImages: [...fullImages] });
      }

      console.log(`generate-full [${bookId}]: STEP 3+4a done — cover + priority images saved`);

      // שלב 4ב: שאר התמונות (3-16) בbatches של 3
      // שלב 4ב: שאר התמונות — 5 במקביל, כל תמונה נשמרת מיד כשמוכנה
      const remaining = [];
      for (let i = 2; i < pages.length; i++) {
        if (!fullImages[i]) remaining.push(i);
      }

      const BATCH_SIZE = 5;
      for (let batchStart = 0; batchStart < remaining.length; batchStart += BATCH_SIZE) {
        const batch = remaining.slice(batchStart, batchStart + BATCH_SIZE);

        // כל תמונה שומרת מיד לDB ברגע שמוכנה — לא מחכה לסוף הbatch
        await Promise.allSettled(batch.map(async (pageIndex) => {
          try {
            const base64 = await generatePageImage(pageIndex);
            if (base64) {
              fullImages[pageIndex] = `data:image/jpeg;base64,${base64}`;
              await updateBookField(bookId, { fullImages: [...fullImages] });
              const doneCount = fullImages.filter(Boolean).length;
              console.log(`generate-full [${bookId}]: image ${pageIndex} saved — ${doneCount}/${pages.length} total`);
            }
          } catch (err) {
            console.error(`generate-full [${bookId}]: image ${pageIndex} failed:`, err.message);
          }
        }));
      }

      // ── STEP 5: All done — send "book ready" email ───────────────────────────
      console.log("generate-full: completed for bookId:", bookId);
      try {
        const completedBook = await getBook(bookId);
        // Only send if book was paid (user might not have paid yet — that's ok,
        // email will be triggered again by Stripe webhook when they do pay)
        if (completedBook?.purchaseUnlocked && completedBook?.customerEmail) {
          await sendBookReadyEmail(completedBook);
          console.log("generate-full: book ready email sent to:", completedBook.customerEmail);
        } else {
          console.log("generate-full: book not yet paid, skipping book ready email for now");
        }
      } catch (emailErr) {
        console.error("generate-full: failed to send book ready email:", emailErr.message);
      }

    } catch (err) {
      console.error(`generate-full [${bookId}]: FATAL ERROR — ${err.message}`, err.stack?.split('\n')[1] || '');
    }
  })();
});

// ─── Batch generate all page images — fires in background ────────────────────
app.post("/api/books/:bookId/generate-images", async (req, res) => {
  try {
    const bookId = req.params.bookId;
    const book   = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ status: "error", message: "Book not found" });
    }

    const pages = book.generatedBook?.pages || [];
    if (pages.length === 0) {
      return res.status(400).json({ status: "error", message: "No pages to generate" });
    }

    const existingImages = book.fullImages || [];
    const alreadyDone = existingImages.filter(Boolean).length;

    if (alreadyDone >= pages.length) {
      return res.json({ status: "ok", generated: 0, total: pages.length, message: "All images already exist" });
    }

    // ── Respond immediately so client isn't waiting ──
    res.json({ status: "ok", message: "Image generation started in background", total: pages.length });

    // ── Generate in background ──────────────────────────────────────────────
    (async () => {
      try {
        const characterReference = book.characterReference || {};
        const style = book.illustrationStyle || "Soft Storybook";

        const fullImages = [...existingImages];
        while (fullImages.length < pages.length) fullImages.push(null);

        const toGenerate = [];
        for (let i = 0; i < pages.length; i++) {
          if (!fullImages[i]) toGenerate.push(i);
        }

        const BATCH_SIZE = 3; // 3 parallel — stable, not too aggressive
        let savedCount = 0;

        for (let batchStart = 0; batchStart < toGenerate.length; batchStart += BATCH_SIZE) {
          const batch = toGenerate.slice(batchStart, batchStart + BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (pageIndex) => {
              const page = pages[pageIndex];

              const finalPrompt = `Create a premium children's storybook illustration.

Illustration style: ${sanitizeBrandTerms(style)}

Character consistency:
${sanitizeBrandTerms(characterReference.characterPromptCore || "Keep the same main child character consistent.")}

Scene:
${sanitizeImagePrompt(page.imagePrompt || "")}

Rules:
- same child identity
- same face structure
- same hair and skin tone
- warm magical storybook aesthetic
- no text
- no watermark
- elegant composition
- no logos
- no brand names
- no copyrighted costume emblems`.trim();

              const imgResp = await openai.images.generate({
                model:  "gpt-image-1",
                prompt: finalPrompt,
                size:   "1024x1024"
              });

              const base64 = await normalizeImageToBase64(imgResp?.data?.[0]);
              return { pageIndex, base64 };
            })
          );

          let batchHadNew = false;
          for (const result of results) {
            if (result.status === "fulfilled" && result.value?.base64) {
              fullImages[result.value.pageIndex] = `data:image/png;base64,${result.value.base64}`;
              savedCount++;
              batchHadNew = true;
            }
          }

          // Save after every batch so polling clients see progress
          if (batchHadNew) {
            await updateBookField(bookId, { fullImages: [...fullImages] });
            console.log(`generate-images: saved ${savedCount}/${toGenerate.length} images for book ${bookId}`);
          }
        }

        console.log(`generate-images: completed ${savedCount} images for book ${bookId}`);
      } catch (err) {
        console.error("generate-images background error:", err.message);
      }
    })();

  } catch (err) {
    console.error("generate-images setup error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ status: "error", message: err?.message || "Failed to start image generation" });
    }
  }
});

// ─── Image generation progress check ─────────────────────────────────────────
// ─── Update cropped photo (after early generation started) ───────────────────
app.post("/api/books/:bookId/update-photo", async (req, res) => {
  try {
    const { croppedPhoto } = req.body;
    if (!croppedPhoto) return res.status(400).json({ ok: false });
    await updateBookField(req.params.bookId, { croppedPhoto });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Resend book link email ───────────────────────────────────────────────────
app.post("/api/books/:bookId/resend-email", async (req, res) => {
  try {
    const book = await getBook(req.params.bookId);
    if (!book) return res.status(404).json({ ok: false, error: "Book not found" });
    if (!book.customerEmail) return res.status(400).json({ ok: false, error: "No email on file" });
    if (!book.purchaseUnlocked) return res.status(403).json({ ok: false, error: "Book not purchased" });
    await sendBookReadyEmail(book);
    console.log(`Resend email: book link sent to ${book.customerEmail}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Resend email error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to send email" });
  }
});

app.get("/api/books/:bookId/image-status", async (req, res) => {
  try {
    const book = await getBook(req.params.bookId);
    if (!book) return res.status(404).json({ status: "error", message: "Book not found" });

    const totalPages    = book.generatedBook?.pages?.length || 0;
    const fullImages    = book.fullImages || [];
    const readyCount    = fullImages.filter(Boolean).length;

    return res.json({
      status: "ok",
      total:  totalPages,
      ready:  readyCount,
      done:   readyCount >= totalPages
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err?.message || "Failed" });
  }
});

// ─── Character reference ──────────────────────────────────────────────────────
app.post("/generate-character-reference", async (req, res) => {
  try {
    const { child_photo, illustration_style } = req.body;

    if (!child_photo) {
      return res.status(400).json({ status: "error", message: "Missing child_photo" });
    }

    const style     = illustration_style || "Soft Storybook";
    const safeStyle = sanitizeBrandTerms(style);

    const dnaCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
Analyze the uploaded child photo and return ONLY JSON.

Return:
{
  "hair": "string",
  "skin": "string",
  "eyes": "string",
  "face": "string",
  "ageLook": "string",
  "outfit": "string",
  "vibe": "string",
  "summary": "string"
}

Rules:
- Focus only on the child
- Ignore any brand names, logos, copyrighted characters, or toy franchises
- If clothing includes a recognizable character or logo, describe it generically
              `.trim()
            },
            {
              type: "image_url",
              image_url: { url: child_photo }
            }
          ]
        }
      ],
      temperature: 0.2
    });

    const dnaRaw      = dnaCompletion.choices?.[0]?.message?.content || "{}";
    const characterDNA = safeJsonParse(dnaRaw, {
      hair:    "soft brown child hair",
      skin:    "natural warm skin tone",
      eyes:    "bright child eyes",
      face:    "soft rounded child face",
      ageLook: "young child",
      outfit:  "simple timeless child outfit",
      vibe:    "warm curious child",
      summary: "A warm curious child hero for a magical storybook."
    });

    const promptCore = buildCharacterPromptCore(characterDNA, safeStyle);

    const characterSheetPrompt = `
Create a premium children's storybook character sheet.

Style: ${safeStyle}

${sanitizeBrandTerms(promptCore)}

Create ONE clean composition showing the same child character in:
- front view
- slight side view
- full body storybook pose

Background:
- clean soft storybook background
- minimal and elegant
- no text
- no watermark
- no logos
- no branded costume details
`.trim();

    const imageResp = await openai.images.generate({
      model:  "gpt-image-1",
      prompt: characterSheetPrompt,
      size:   "1024x1024"
    });

    const characterSheetBase64 = await normalizeImageToBase64(imageResp?.data?.[0]);

    return res.json({
      status:              "ok",
      characterDNA,
      characterPromptCore: promptCore,
      characterSummary:    characterDNA.summary || "",
      characterSheetBase64
    });
  } catch (err) {
    return res.status(500).json({
      status:  "error",
      message: "Character reference generation failed",
      details: err?.message || "unknown_error"
    });
  }
});

// ─── Create book (story text) ─────────────────────────────────────────────────
app.post("/create-book", async (req, res) => {
  try {
    const {
      child_name,
      age,
      gender,
      story_type,
      illustration_style,
      character_reference
    } = req.body;

    if (!child_name || !age || !story_type) {
      return res.status(400).json({
        status:  "error",
        message: "Missing required fields: child_name, age, story_type"
      });
    }

    const style            = illustration_style || "Soft Storybook";
    const characterSummary = character_reference?.characterSummary    || "A warm curious child hero";
    const characterPromptCore = character_reference?.characterPromptCore || "";

    const cleanStoryType         = sanitizeBrandTerms(story_type        || "");
    const cleanChildName         = sanitizeBrandTerms(child_name        || "");
    const cleanStyle             = sanitizeBrandTerms(style             || "");
    const cleanCharacterSummary  = sanitizeBrandTerms(characterSummary  || "");
    const cleanCharacterPromptCore = sanitizeBrandTerms(characterPromptCore || "");

    const prompt = `
You are a premium personalized children's book writer.

Child name: ${cleanChildName}
Child age: ${age}
Child gender: ${gender || "not specified"}
Story direction: ${cleanStoryType}
Illustration style: ${cleanStyle}

Character summary:
${cleanCharacterSummary}

Character consistency instructions:
${cleanCharacterPromptCore}

Return ONLY JSON:
{
  "title": "string",
  "subtitle": "string",
  "pages": [
    {
      "text": "string",
      "imagePrompt": "string"
    }
  ]
}

Rules:
- Exactly 16 story pages
- Each page text must be 35-70 words
- The child must clearly be the hero
- imagePrompt must describe the same child consistently
- No page numbers inside text
- No brand names
- Do not mention copyrighted characters or logos
- Convert any branded clothing or toys into generic descriptions
`.trim();

    const completion = await openai.chat.completions.create({
      model:           "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages:        [{ role: "user", content: prompt }],
      temperature:     0.8
    });

    const raw  = completion.choices?.[0]?.message?.content || "{}";
    const book = safeJsonParse(raw, {});

    const title    = sanitizeBrandTerms(book.title    || `The Magical Adventure of ${cleanChildName}`);
    const subtitle = sanitizeBrandTerms(book.subtitle || "A story where you are the hero");
    const pages    = Array.isArray(book.pages) ? book.pages.slice(0, 16) : [];

    return res.json({
      status: "ok",
      title,
      subtitle,
      illustration_style: cleanStyle,
      pages: pages.map((p) => ({
        text:        sanitizeBrandTerms(String(p.text        || "").trim()),
        imagePrompt: sanitizeImagePrompt(String(p.imagePrompt || "").trim())
      }))
    });
  } catch (err) {
    return res.status(500).json({
      status:  "error",
      message: "Book generation failed",
      details: err?.message || "unknown_error"
    });
  }
});

// ─── Generate cover image ─────────────────────────────────────────────────────
app.post("/generate-cover-image", async (req, res) => {
  try {
    const {
      title,
      subtitle,
      story_type,
      illustration_style,
      characterPromptCore,
      characterSummary
    } = req.body;

    if (!title) {
      return res.status(400).json({ status: "error", message: "Missing required field: title" });
    }

    const style = illustration_style || "Soft Storybook";

    const coverPrompt = `
Create a premium children's storybook COVER illustration.

Illustration style: ${sanitizeBrandTerms(style)}

LOCKED CHILD CHARACTER:
${sanitizeBrandTerms(characterPromptCore || "Keep the same main child character consistent.")}

SHORT CHARACTER SUMMARY:
${sanitizeBrandTerms(characterSummary || "A warm curious child hero.")}

BOOK TITLE:
${sanitizeBrandTerms(title)}

BOOK SUBTITLE:
${sanitizeBrandTerms(subtitle || "")}

STORY DIRECTION:
${sanitizeBrandTerms(story_type || "A magical storybook adventure.")}

Rules:
- create ONE beautiful single cover illustration
- show the child as the hero
- magical, premium, warm
- no character sheet
- no multiple poses
- no text rendered into the image
- no watermark
- no logos
- no copyrighted costume emblems
`.trim();

    const imgResp = await openai.images.generate({
      model:  "gpt-image-1",
      prompt: coverPrompt,
      size:   "1024x1024"
    });

    const coverImageBase64 = await normalizeImageToBase64(imgResp?.data?.[0]);
    return res.json({ status: "ok", coverImageBase64 });
  } catch (err) {
    return res.status(200).json({
      status:         "fallback",
      coverImageBase64: null,
      message:        "Cover generation was blocked, fallback will be used on client."
    });
  }
});

// ─── Generate page image ──────────────────────────────────────────────────────
app.post("/generate-image", async (req, res) => {
  try {
    const { prompt, illustration_style, characterPromptCore } = req.body;

    if (!prompt) {
      return res.status(400).json({ status: "error", message: "Missing required field: prompt" });
    }

    const style       = illustration_style || "Soft Storybook";
    const finalPrompt = `
Create a premium children's storybook illustration.

Illustration style: ${sanitizeBrandTerms(style)}

Character consistency:
${sanitizeBrandTerms(characterPromptCore || "Keep the same main child character consistent.")}

Scene:
${sanitizeImagePrompt(prompt)}

Rules:
- same child identity
- same face structure
- same hair and skin tone
- warm magical storybook aesthetic
- no text
- no watermark
- elegant composition
- no logos
- no brand names
- no copyrighted costume emblems
`.trim();

    const imgResp = await openai.images.generate({
      model:  "gpt-image-1",
      prompt: finalPrompt,
      size:   "1024x1024"
    });

    const imageBase64 = await normalizeImageToBase64(imgResp?.data?.[0]);
    return res.json({ status: "ok", imageBase64 });
  } catch (err) {
    return res.status(500).json({
      status:  "error",
      message: "Image generation failed",
      details: err?.message || "unknown_error"
    });
  }
});

// ─── Contact form ─────────────────────────────────────────────────────────────
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const subjectLabels = {
      "book-issue":   "Issue with my book",
      "payment":      "Payment question",
      "generation":   "Generation took too long",
      "pdf":          "PDF download problem",
      "other":        "Something else",
    };
    const subjectLine = subjectLabels[subject] || subject || "General inquiry";
    const appUrl = process.env.APP_URL || "https://lifebooks.online";
    const adminEmail = process.env.ADMIN_EMAIL || "books@lifebooks.online";

    // ── Notify admin ──────────────────────────────────────────────────────────
    await resend.emails.send({
      from:    "Lifebook Contact <books@lifebooks.online>",
      to:      [adminEmail],
      replyTo: email,
      subject: `[Contact] ${subjectLine} — from ${name}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fdf6ec">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:linear-gradient(135deg,#1a1008,#5c3d1e);padding:24px 32px;border-radius:16px 16px 0 0;text-align:center">
                <span style="font-size:28px">📖</span>
                <div style="font-family:Georgia,serif;font-size:22px;color:#f5d98a;margin-top:6px">New contact message</div>
              </td>
            </tr>
            <tr>
              <td style="background:#fff;padding:24px 32px;border:1px solid #ede0c8;border-top:none;border-radius:0 0 16px 16px">
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
                  <tr>
                    <td style="padding:8px 12px;background:#fdf6ec;font-weight:700;color:#c8922a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;width:100px;border-radius:6px 0 0 6px">Name</td>
                    <td style="padding:8px 12px;color:#3a2810;font-size:14px">${name}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;background:#f5e9d4;font-weight:700;color:#c8922a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Email</td>
                    <td style="padding:8px 12px;font-size:14px"><a href="mailto:${email}" style="color:#c8922a">${email}</a></td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;background:#fdf6ec;font-weight:700;color:#c8922a;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;border-radius:0 0 0 6px">Topic</td>
                    <td style="padding:8px 12px;color:#3a2810;font-size:14px">${subjectLine}</td>
                  </tr>
                </table>
                <div style="padding:16px;background:#fdf6ec;border-left:3px solid #c8922a;border-radius:4px;font-size:14px;line-height:1.7;color:#3a2810;white-space:pre-wrap">${message.replace(/</g,"&lt;")}</div>
              </td>
            </tr>
          </table>
        </div>
      `,
    });

    // ── Auto-reply to sender ──────────────────────────────────────────────────
    await resend.emails.send({
      from:    "Lifebook <books@lifebooks.online>",
      to:      [email],
      subject: "We got your message! 📖",
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:0;background:#fdf6ec">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:linear-gradient(135deg,#1a1008,#5c3d1e);padding:36px;text-align:center">
                <div style="font-size:36px;margin-bottom:8px">📖</div>
                <div style="font-family:Georgia,serif;font-size:26px;color:#f5d98a">lifebook</div>
                <div style="font-size:11px;color:#c4a87a;margin-top:4px;letter-spacing:2px;text-transform:uppercase">AI Children's Storybooks</div>
              </td>
            </tr>
            <tr>
              <td style="background:#fff;padding:36px;border:1px solid #ede0c8;border-top:none">
                <h2 style="font-family:Georgia,serif;color:#5c3d1e;margin:0 0 12px;font-size:24px">Thanks, ${name}! 🎉</h2>
                <p style="color:#7a6048;line-height:1.7;margin:0 0 20px">We've received your message and will get back to you within <strong>24 hours</strong>.</p>
                <div style="background:#fdf6ec;border-radius:14px;padding:18px;border:1px solid #ede0c8;margin-bottom:24px">
                  <p style="color:#c8922a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 8px">Your message</p>
                  <p style="color:#3a2810;line-height:1.7;font-size:14px;margin:0;white-space:pre-wrap">${message.replace(/</g,"&lt;")}</p>
                </div>
                <p style="color:#7a6048;font-size:13px;line-height:1.6;margin:0">
                  While you wait, feel free to <a href="${appUrl}" style="color:#c8922a;text-decoration:none;font-weight:700">visit your book</a> any time.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#fdf6ec;padding:16px;text-align:center;border:1px solid #ede0c8;border-top:none;border-radius:0 0 16px 16px">
                <p style="font-size:12px;color:#b09070;margin:0">© 2026 Lifebook · <a href="${appUrl}/contact.html" style="color:#c8922a;text-decoration:none">Contact Us</a></p>
              </td>
            </tr>
          </table>
        </div>
      `,
    });

    console.log(`Contact form submitted by ${name} <${email}> — topic: ${subjectLine}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Contact form error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to send message" });
  }
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  // API routes return JSON 404
  if (req.path.startsWith("/api/") || req.path.startsWith("/webhooks/")) {
    return res.status(404).json({ status: "error", message: "Not found" });
  }
  // HTML pages return 404.html
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
