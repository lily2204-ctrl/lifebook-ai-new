# Lifebook AI — Project Context & Status
*Last updated: June 25, 2026 (session 14 — design unification: Assistant font, logo rename, Hebrew emails, email cleanup)*

## ⚠️ DO NOT MODIFY — ALREADY DONE
- `public/assets/branding/lifebook-logo.webp` — main logo (renamed from "lifebook new logo .webp")
- All HTML: `<img src="assets/branding/lifebook-logo.webp" style="height:54px;width:auto;display:block"/>` — NO mix-blend-mode, NO logo.svg, NO logo.png
- `public/accessibility.js` — on ALL pages via `<script src="accessibility.js"></script>` before `</body>`
- `public/404.html` — Hebrew error page
- `server.js` two-email system — `sendPaymentConfirmationEmail` + `sendBookReadyEmail` — DO NOT TOUCH
- `server.js` `updateBookField()` — NO `.select()` — safe for large images — DO NOT CHANGE
- `server.js` `insertBook()` — NO `.select()` — safe for large photos — DO NOT CHANGE
- `public/preview.html` — step tracker loading screen, all English, DO NOT REVERT
- `server.js` `uploadImageToStorage()` — uploads to Supabase Storage bucket "book-images" — DO NOT CHANGE
- `server.js` LemonSqueezy webhook middleware — `express.raw()` runs BEFORE `express.json()` is explicitly skipped for `/webhooks/` — DO NOT REORDER
- **Font**: Assistant (Google Fonts, wght 300–800) everywhere. Playfair Display and Lato removed from all HTML/CSS.
- **Logo**: `public/assets/branding/lifebook-logo.webp` (renamed from "lifebook new logo .webp"). All HTML files updated.
- **Sender email**: `lifebooks@lifebooksil.com` — used in server.js Resend calls and all public/ HTML files.
- **Email templates**: `sendPaymentConfirmationEmail` + `sendBookReadyEmail` — both in Hebrew, `dir="rtl"`, Assistant font, logo from `https://lifebooksil.com/assets/branding/lifebook-logo.webp`.
- **RTL rule**: `dir="rtl"` on `<html>` in email templates only. In HTML pages: `dir="rtl"` on content elements (`<section>`, `<main>`, cards) — NEVER on html/body/header.

## ⚠️ CRITICAL DB RULES
```javascript
// ✅ CORRECT — no .select()
await updateBookField(bookId, { fullImages: [...fullImages] });
await updateBookField(bookId, { characterReference });
await updateBookField(bookId, { generatedBook });
// ✅ insertBook also has no .select()

// ❌ WRONG — causes Supabase timeout on large base64 data
await updateBook(bookId, { fullImages });
await updateBook(bookId, { characterReference });
await updateBook(bookId, { generatedBook });
```

---

## Project
AI personalized children's storybook. Internal tool — no payment wall. Wizard → photo → crop → AI generates → preview → PDF downloads directly from delivery.html.

## URLs
- Live: https://lifebooks.online
- Railway: https://romantic-patience-production.up.railway.app
- GitHub: lily2204-ctrl/lifebook-ai (connected to Railway auto-deploy)

## Stack
Node.js/Express · Supabase Pro (DB + Storage) · OpenAI gpt-4o-mini + gpt-image-1 · Resend (email) · Railway

---

## Payment Status — Shopify Active
- **Shopify** is the active payment provider. Webhook: `orders/paid` at `POST /webhooks/shopify` — verified working.
- Stripe: completely removed from server.js, package.json, and all HTML
- LemonSqueezy: webhook still in server.js (`POST /webhooks/lemonsqueezy`) for legacy orders — UI no longer points to it
- Gumroad: webhook still in server.js (`POST /webhooks/gumroad`) for legacy Gumroad sales — UI no longer points to it
- checkout.html: uses Shopify checkout button — manual contact block removed
- preview.html button: goes to checkout.html
- Contact email everywhere: `lifebooks@lifebooksil.com`

## Railway Env Vars
```
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
APP_URL=https://lifebooks.online
ADMIN_EMAIL=lifebooks@lifebooksil.com
LEMONSQUEEZY_API_KEY
LEMONSQUEEZY_WEBHOOK_SECRET
LEMONSQUEEZY_STORE_ID=347433
LEMONSQUEEZY_VARIANT_ID
```
Note: must be SUPABASE_SERVICE_ROLE_KEY (not SUPABASE_ANON_KEY).
Note: SUPABASE_SERVICE_ROLE_KEY is required to write to Supabase Storage (anon key has no write permission).

---

## User Flow (Internal Tool)
```
wizard.html → crop.html → preview.html → [Download PDF button] → delivery.html → PDF download
```
checkout.html still exists but is now just a contact page (not part of main flow).

## generate-full Pipeline
```
STEP 1: Analyze photo → updateBookField(characterReference) (~30s)
STEP 2: Write story 12 pages → updateBookField(generatedBook) (~45s)
STEP 3+4a: Cover + pages 0,1 IN PARALLEL → updateBookField each individually (~60s)
STEP 4b: Remaining pages batches of 5, each saved immediately with updateBookField
STEP 5: sendBookReadyEmail ONLY if purchaseUnlocked === true
```
Each step logs elapsed time in Railway logs: `+Xs` format.
Language detection logs: `language=Hebrew` or `language=English` at generation start.

---

## Hebrew Support
- Story generation: if childName OR storyIdea contains Hebrew characters → story generated in Hebrew
- imagePrompts: ALWAYS in English (regardless of story language) for image generation
- title/subtitle/page text: in Hebrew when Hebrew book
- PDF Hebrew: rendered via Canvas 2D API (`renderHebrewCanvas()`) → PNG embedded in jsPDF. No TTF font loading. Browser uses native Heebo from Google Fonts in `<head>`. Eliminates all encoding/gibberish issues.
- PDF filename: Hebrew names stripped gracefully; falls back to `{bookId.substring(0,8)}_lifebook.pdf`

## Page Layout — Viewer + PDF
All story pages (both viewer in delivery.html/reader.html AND PDF) use a unified split layout:
- **Left half**: solid colored background + text centered vertically, direction:rtl for Hebrew, Playfair Display font, page number subtle at bottom
- **Right half**: illustration image, object-fit:cover, full bleed, no padding/margin/white border
- **Color palette** rotates per page based on child gender:
  - בן (boy): `#E8F4FD, #E8F8F5, #EAF2FF, #FFF8E7, #F0F4FF` — text `#1a5276`
  - בת (girl): `#FDE8F4, #F3E8FF, #FFF0E8, #E8FDF5, #FFFDE8` — text `#7b1a5a`
- gender detection: `childGender` field, matches boy/male/זכר/בן vs default girl palette
- Cover + back cover keep existing dark/gold design unchanged

---

## Image Storage Architecture
All images are stored in **Supabase Storage** bucket `book-images`, NOT as base64 in the DB.

- Bucket: `book-images` (must be PUBLIC — create in Supabase dashboard if not exists)
- Path structure: `{bookId}/cover.jpg`, `{bookId}/page-0.jpg`, `{bookId}/page-1.jpg` ... `{bookId}/page-11.jpg`
- User photos: `{bookId}/cropped-photo.jpg`, `{bookId}/original-photo.jpg`
- DB columns (`cover_image`, `full_images`, `cropped_photo`, `original_photo`) now store **public URLs**, not base64
- Old books (pre-migration) may still have base64 in those columns — backward compat maintained

```javascript
// New helper — DO NOT CHANGE
async function uploadImageToStorage(bookId, imageName, base64data) {
  // Strips data:image/jpeg;base64, prefix → Buffer → uploads to "book-images" bucket
  // Returns public URL. Throws on error.
}
```

### getBookLight vs getBook
- `getBook(bookId)` — `SELECT *` — returns all fields including image URLs — use for delivery/reader
- `getBookLight(bookId)` — excludes `cover_image, full_images, cropped_photo, original_photo, preview_images` — use for metadata-only reads (email decisions, auth checks)
- Main GET `/api/books/:id` uses `getBook()` so frontend sees image URLs (no frontend changes needed)

### Fallback behavior
- If Storage upload fails, `uploadImageToStorage` throws and the catch block falls back to saving base64 in DB
- This ensures book generation never fails due to a Storage error

---

## Key Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/books/create` | POST | Creates book, uploads user photos to Storage |
| `/api/books/:id/generate-full` | POST | Full pipeline — background IIFE, returns 200 immediately |
| `/api/books/:id` | GET | Fetch full book including image URLs — used by all pages |
| `/api/books/:id/unlock` | POST | Manual unlock (dev only) |
| `/api/books/:id/resend-email` | POST | Resend book ready link |
| `/api/books/:id/update-photo` | POST | Update cropped photo — uploads to Storage |
| `/webhooks/lemonsqueezy` | POST | Verify sig (raw body HMAC) → unlock book → send emails |
| `/webhooks/gumroad` | POST | Form-urlencoded; bookId from `referrer` field → unlock → send emails |
| `/api/contact` | POST | Contact form |

---

## Image Generation Rules (gpt-image-1)
- Cover + page images: NEVER render text inside the image
- Cover prompt must include: "NO text, letters, words, numbers, or writing of any kind rendered inside the image" + "NO captions, titles, subtitles, labels, or book title text on the image"
- Page prompt must include same rule + "NO captions, labels, speech bubbles"
- Character prompts end with: "This is the SAME child that must appear identically in every illustration"
- `buildCharacterPromptCore()` has LOCKED CHILD CHARACTER header + 6-rule CONSISTENCY RULES block

---

## ⚠️ INFRASTRUCTURE — Requires Manual Action
These cannot be fixed in code — need dashboard access:
1. **Supabase paused** — if the DB returns 522/connection timeout, go to supabase.com → project → click "Resume". Supabase pauses free-tier projects after inactivity.
2. **Supabase Storage bucket** — must create `book-images` bucket manually:
   - Go to Supabase dashboard → Storage → New bucket
   - Name: `book-images`
   - Set to **Public** (so image URLs work without auth tokens)
3. **Railway DNS** — if lifebooks.online is unreachable, go to Railway → Settings → Domains and verify the custom domain mapping is active.

## Known Bugs — Open
*(none currently — all known bugs fixed)*

---

## File Structure
```
server.js · CLAUDE.md · package.json
public/
  index.html       ← landing page, "12-page storybook"
  wizard.html/js   ← child name, age, gender, story idea, photo upload
  crop.html/js     ← circle crop, zoom, → fires generate-full, → preview.html
  preview.html     ← step tracker loading screen; "⬇ Download PDF" → delivery.html
  checkout.html/js ← contact form (email + WhatsApp); NOT in main flow
  delivery.html    ← book viewer + PDF download (jsPDF + Heebo for Hebrew)
  reader.html/js   ← full page-flip reader
  open-book.js     ← legacy; if bookId → redirect delivery.html
  contact.html     ← contact form
  terms.html       ← Refund + Privacy + General Terms (onlinelifebooks@gmail.com)
  404.html · accessibility.js · styles.css
  js/state.js · assets/branding/logo.svg
```

---

## Bugs Fixed History
1. ✅ Supabase NANO crash (20MB+ DB rows) → images moved to Supabase Storage bucket "book-images"
2. ✅ setup.js legacy flow
3. ✅ Stripe webhook 21% errors
4. ✅ PDF emoji garbage → geometric shapes
5. ✅ Logo SVG viewBox
6. ✅ SyntaxError crashes
7. ✅ Cover + pages 0,1 parallel
8. ✅ Each image saves immediately
9. ✅ updateBookField not defined
10. ✅ insertBook had .select()
11. ✅ characterReference/generatedBook used updateBook → fixed to updateBookField
12. ✅ Stripe removed, LemonSqueezy integrated (checkout + webhook)
13. ✅ preview.html Hebrew text → English
14. ✅ crop.js mobile stuck — inline status, createRes.ok check, no alert()
15. ✅ delivery.html PDF null crash — null guards on book + book.generatedBook + fresh
16. ✅ Cover/page AI text bleed — strong NO TEXT rules in all prompts
17. ✅ Character consistency — LOCKED CHILD CHARACTER + 6-rule CONSISTENCY RULES block
18. ✅ "16 pages" → "12 pages" everywhere (server.js, index.html, preview.html, delivery.html)
19. ✅ "Stripe encrypted" → "Secure payment" everywhere (checkout.html, preview.html, index.html)
20. ✅ success.html: openBtn wired to reader.html → fixed to delivery.html
21. ✅ success.html: polled 10×2s (20s) → 30×2s (60s)
22. ✅ success.html: after 60s timeout → redirect to delivery.html (not checkout)
23. ✅ success.html: removed session_id param + unlockBook() auto-fire (Stripe leftover)
24. ✅ server.js webhook: CRITICAL — was using updateBook() (has .select() → Supabase timeout) → fixed to updateBookField()
25. ✅ server.js webhook: accept both x-signature AND x-lemonsqueezy-signature headers
26. ✅ server.js webhook: added 20 detailed console.log lines at every step for Railway log debugging
27. ✅ server.js checkout: added [Checkout] logging — bookId, env vars, redirect URL, LS response
28. ✅ success.html: removed session_id param + unlockBook() auto-fire (Stripe leftover, was calling /unlock without payment verification)
29. ✅ success.html: openBtn wired to reader.html → fixed to delivery.html
30. ✅ success.html: poll 10×2s (20s) → 30×2s (60s)
31. ✅ success.html: after 60s timeout → show "Payment confirmed — opening your book..." then redirect to delivery.html after 2.5s (never goes to checkout)
32. ✅ package.json: removed stripe dependency (was still installed despite full Stripe removal)
33. ✅ contact.html: removed mix-blend-mode:multiply from logo (was making logo invisible), fixed height 36px → 54px
34. ✅ wizard.html, cover.html, reader.html, setup.html, open-book.html: logo height 40px/44px → 54px (matches spec)
35. ✅ success.js: orphaned legacy file with Shopify references + reader.html redirect — gutted, now empty stub
36. ✅ cover.js: redirected to generate.html (legacy) → wizard.html
37. ✅ server.js generate-images endpoint: MIME type data:image/png → data:image/jpeg
38. ✅ CRITICAL ARCHITECTURE: images moved from Supabase DB (base64, 20MB+ rows) to Supabase Storage (URLs) — added uploadImageToStorage() helper, all generate-full image saves now upload to Storage with base64 fallback
39. ✅ /api/books/create: croppedPhoto + originalPhoto uploaded to Storage before DB insert (reduces row size immediately)
40. ✅ /api/books/:id/update-photo: photo uploaded to Storage before DB save
41. ✅ server.js getBookLight(): lightweight DB fetch excluding image columns — used for email-only reads in generate-full STEP 5 and available for metadata-only reads elsewhere
42. ✅ LemonSqueezy webhook 400 fix: express.json() now explicitly skips all /webhooks/ routes so raw buffer is guaranteed intact for HMAC-SHA256 signature verification
43. ✅ generate-full image hang: added `generatePageImageWithRetry()` — 2 retries + 90s timeout per attempt for all page images (pages 0-11); cover also wrapped with 90s timeout; pipeline always reaches STEP 5 even if individual pages fail
44. ✅ generate-full STEP 5 email: improved console.log at every sub-step; always runs after all batches regardless of page failures
45. ✅ success.html title: polling loop now updates title/cover/meta on every poll iteration
46. ✅ terms.html created: Refund + Privacy + General Terms — matches design system
47. ✅ index.html footer: added "Terms & Privacy" link to terms.html
48. ✅ book-ready email never sent — BUG FIX 1: webhook allDone threshold now allows up to 2 image failures (pages.length - 2, min 1)
49. ✅ book-ready email never sent — BUG FIX 2: webhook now extracts payload.data.attributes.user_email from LemonSqueezy and saves to customerEmail
50. ✅ preview.html cover image never shown (mobile Safari): fixed `!coverImage.src` (returns page URL when no src) → `coverImage.getAttribute('src') !== b.coverImage`
51. ✅ preview.html payBtn never enabled: was requiring hasCover && has2Imgs; fixed to enable on hasCover alone
52. ✅ delivery.html PDF redesign: professional layout, Layout A (odd) + Layout B (even) + cover + back cover; loadB64 canvas helper for Storage URLs
53. ✅ Payment flow removed: site is now internal tool — preview.html button "⬇ Download PDF" → delivery.html directly; checkout.html replaced with contact form
54. ✅ Email changed: books@lifebooks.online → onlinelifebooks@gmail.com everywhere (server.js, checkout.html, terms.html, contact.html)
55. ✅ Gumroad webhook added: POST /webhooks/gumroad — form-urlencoded, bookId from referrer field, unlocks book + sends emails
56. ✅ Hebrew PDF fix: delivery.html Heebo font changed from variable font (Heebo[wght].ttf) to static (static/Heebo-Regular.ttf) — jsPDF cannot parse variable fonts, causing Hebrew to render as boxes
57. ✅ Hebrew detection improved: server.js generate-full now checks childName OR storyIdea for Hebrew characters (previously only childName)
58. ✅ PDF filename Hebrew fix: Hebrew child names (all converted to underscores) now fall back to bookId prefix instead of "___lifebook.pdf"
59. ✅ Timing logs added: generate-full logs elapsed time at each step (+Xs format) and language=Hebrew/English at start
60. ✅ preview.html totalPages fallback: was 16 → fixed to 12 (correct page count)
61. ✅ open-book.js: removed broken /api/order/:orderId call (Stripe legacy, endpoint never existed); now redirects directly to delivery.html; removed unused orderId param handling
