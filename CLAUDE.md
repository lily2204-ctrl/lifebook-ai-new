# Lifebook AI — Project Context & Status
*Last updated: April 26, 2026 (session 10 — Gumroad payment integration)*

## ⚠️ DO NOT MODIFY — ALREADY DONE
- `public/assets/branding/logo.svg` — viewBox `430 466 639 514`, transparent bg
- All HTML: `<img src="assets/branding/logo.svg" style="height:54px;width:auto;display:block"/>` — NO mix-blend-mode, NO logo.png
- `public/accessibility.js` — on ALL pages via `<script src="accessibility.js"></script>` before `</body>`
- `public/404.html` — Hebrew error page
- `server.js` two-email system — `sendPaymentConfirmationEmail` + `sendBookReadyEmail` — DO NOT TOUCH
- `server.js` `updateBookField()` — NO `.select()` — safe for large images — DO NOT CHANGE
- `server.js` `insertBook()` — NO `.select()` — safe for large photos — DO NOT CHANGE
- `public/preview.html` — step tracker loading screen, all English, DO NOT REVERT
- `server.js` `uploadImageToStorage()` — uploads to Supabase Storage bucket "book-images" — DO NOT CHANGE
- `server.js` LemonSqueezy webhook middleware — `express.raw()` runs BEFORE `express.json()` is explicitly skipped for `/webhooks/` — DO NOT REORDER

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
AI personalized children's storybook. Wizard → photo → crop → AI generates → payment → PDF + email.

## URLs
- Live: https://lifebooks.online
- Railway: https://romantic-patience-production.up.railway.app
- GitHub: lily2204-ctrl/lifebook-ai (connected to Railway auto-deploy)

## Stack
Node.js/Express · Supabase Pro (DB + Storage) · OpenAI gpt-4o-mini + gpt-image-1 · LemonSqueezy (payments) · Resend · Railway

---

## Payment System — LemonSqueezy (NOT Stripe)
- Stripe completely removed from server.js, package.json, and all HTML
- LemonSqueezy store: lifebooks.lemonsqueezy.com (Store ID: 347433)
- Webhook endpoint: `POST /webhooks/lemonsqueezy`
  - Verifies HMAC-SHA256 signature via `x-signature` header
  - Reads bookId from `payload.meta.custom_data.bookId`
  - Responds 200 immediately, processes in background IIFE
  - Unlocks book → sendPaymentConfirmationEmail → sendBookReadyEmail if already complete
  - Has detailed console.log at every step for debugging
- Checkout: `/api/create-checkout-session` → LemonSqueezy fetch API → returns `{ url }`
  - Passes bookId in `checkout_data.custom.bookId`
  - Logs bookId and checkout URL being created
- success.html polls for `purchaseUnlocked` every 2s up to 30 times (60s total)
  - After 60s timeout → redirects to delivery.html anyway (never goes back to checkout)
  - openBtn always → delivery.html (never reader.html or checkout.html)

## Railway Env Vars
```
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
APP_URL=https://lifebooks.online
ADMIN_EMAIL=books@lifebooks.online
LEMONSQUEEZY_API_KEY
LEMONSQUEEZY_WEBHOOK_SECRET
LEMONSQUEEZY_STORE_ID=347433
LEMONSQUEEZY_VARIANT_ID
```
NO STRIPE vars — Stripe is gone completely.
Note: must be SUPABASE_SERVICE_ROLE_KEY (not SUPABASE_ANON_KEY).
Note: SUPABASE_SERVICE_ROLE_KEY is required to write to Supabase Storage (anon key has no write permission).

---

## User Flow
```
wizard.html → crop.html → preview.html → checkout.html → [LemonSqueezy] → success.html → delivery.html → reader.html
```

## generate-full Pipeline
```
STEP 1: Analyze photo → updateBookField(characterReference) (~30s)
STEP 2: Write story 12 pages → updateBookField(generatedBook) (~45s)
STEP 3+4a: Cover + pages 0,1 IN PARALLEL → updateBookField each individually (~60s)
STEP 4b: Remaining pages batches of 5, each saved immediately with updateBookField
STEP 5: sendBookReadyEmail ONLY if purchaseUnlocked === true
```

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
| `/api/create-checkout-session` | POST | LemonSqueezy checkout → returns { url } |
| `/webhooks/lemonsqueezy` | POST | Verify sig (raw body HMAC) → unlock book → send emails |
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
1. **Supabase paused** — if the DB returns 522/connection timeout, go to supabase.com → project → click "Resume". Supabase pauses free-tier projects after inactivity. Consider upgrading to Pro.
2. **Supabase Storage bucket** — must create `book-images` bucket manually:
   - Go to Supabase dashboard → Storage → New bucket
   - Name: `book-images`
   - Set to **Public** (so image URLs work without auth tokens)
   - No file size limit needed (images are ~200KB each)
3. **Railway DNS** — if lifebooks.online is unreachable, go to Railway → Settings → Domains and verify the custom domain mapping is active. Also check your domain registrar DNS points to Railway's IP.
4. **LemonSqueezy webhook** — after deploy, go to LemonSqueezy → Settings → Webhooks and check delivery logs to confirm webhook fires and our endpoint returns 200.

## End-to-End Test Results — April 18, 2026
*Tested on Railway URL (lifebooks.online DNS is down — needs manual fix in Railway/registrar)*

| Step | Status | Notes |
|------|--------|-------|
| index.html loads | ✅ | Logo, hero image, CTA button all correct |
| wizard.html | ✅ | All form fields work, style selector works, Hebrew toggle present |
| crop.html | ✅ | Photo renders in circle, zoom slider, progress bar on submit, "Redirecting..." status |
| /api/books/create | ✅ | Book created, photos uploaded to Supabase Storage (not base64 in DB) |
| /api/books/:id/generate-full | ✅ | Returns 200 immediately, background pipeline starts |
| preview.html — step tracker | ✅ | "Creating Maya...", timer counts up, steps animate: photo→story→illustrations→ready |
| preview.html — story generated | ✅ | Title "Maya's Magical Forest Adventure", subtitle correct, ~45s |
| preview.html — images | ✅ | Cover + pages loaded from Supabase Storage URLs (confirmed NOT base64), ~60-90s |
| preview.html — page count | ✅ | "2/12 pages illustrated" (correct — not 16) |
| preview.html — trust badges | ✅ | "Secure checkout · Instant download · Secure payment" (no Stripe) |
| checkout.html | ✅ | Cover from Storage, order summary correct: Maya · 5 · 12 pages · $39 |
| /api/create-checkout-session | ✅ | LemonSqueezy checkout URL created and redirect fired correctly |
| LemonSqueezy redirect | ✅ | Tab navigated to lifebooks.lemonsqueezy.com/checkout correctly |
| /api/books/:id/unlock | ✅ | Dev unlock works: purchaseUnlocked=true, paymentStatus=paid |
| success.html | ✅ | Detected purchaseUnlocked=true, cover thumbnail from Storage, "📖 Open My Book" enabled |
| success.html → delivery.html | ✅ | "Open My Book" navigated correctly to delivery.html (not reader.html) |
| delivery.html loads | ✅ | Cover, title, child name, 12 pages, Paid status all correct |
| delivery.html — carousel | ✅ | Page images load from Storage URLs, navigation arrows/dots work |
| delivery.html — PDF | ✅ | PDF generated, progress bar shown, completed with no errors, file downloaded |
| Supabase Storage | ✅ | All 12 page images + cover served from jjhrynetritjbxotggqz.supabase.co/storage/v1/object/public/book-images/{bookId}/ |
| Console errors | ✅ | Zero JS errors across entire flow |
| Image quality | ✅ | No text rendered in images, consistent child character across pages |

### ⚠️ Infrastructure Issues Found
1. **lifebooks.online DNS is DOWN** — domain unreachable, Railway URL works fine. Fix: go to Railway → Settings → Domains, verify custom domain mapping. Check DNS registrar points to Railway IP.
2. **LemonSqueezy actual payment not tested** — cannot complete real payment in browser tool. Webhook flow (signature → unlock → email) should be verified via LemonSqueezy dashboard delivery logs after first real purchase.

## Known Bugs — Open
### 🟢 Nice to have
1. Hebrew on all pages (currently only wizard.html has full toggle)

---

## File Structure
```
server.js · CLAUDE.md · package.json
public/
  index.html       ← "12-page storybook", "Secure Payment" (no Stripe refs)
  wizard.html/js
  crop.html/js     ← inline status bar with progress steps, no alert()
  setup.html/js
  preview.html     ← step tracker loading screen, "0/12 pages", "Secure payment"
  checkout.html/js ← LemonSqueezy flow, "Secure payment" trust badge
  success.html     ← polls 30×2s, always → delivery.html, no session_id/unlockBook
  delivery.html    ← null safety on book/book.generatedBook, || 12 fallbacks
  reader.html/js · cover.html/js · contact.html
  terms.html       ← Refund policy + Privacy policy + General terms
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
44. ✅ generate-full STEP 5 email: improved console.log at every sub-step (before/after sendBookReadyEmail, purchaseUnlocked state, image count); always runs after all batches regardless of page failures
45. ✅ success.html title: polling loop now updates title/cover/meta on every poll iteration — real book title shown as soon as generatedBook arrives, not just after purchaseUnlocked
46. ✅ terms.html created: Refund policy (no refunds after generation begins), Privacy policy (photos deleted after creation), General terms, contact strip — matches design system (cream/gold/Playfair/Lato)
47. ✅ index.html footer: added "Terms &amp; Privacy" link to terms.html alongside existing "Contact Us"
48. ✅ book-ready email never sent — BUG FIX 1: webhook `allDone` check was too strict (required ALL images, so 1 failed page = email never sent); now allows up to 2 image failures (threshold = pages.length - 2, min 1)
49. ✅ book-ready email never sent — BUG FIX 2: webhook never extracted `payload.data.attributes.user_email` from LemonSqueezy; now saves verified LS email to `customerEmail` on the book — fixes silent failure when wizard email was blank/wrong
50. ✅ preview.html cover image never shown (all platforms): `updateLiveImages` used `!coverImage.src` (IDL property) which returns current page URL in mobile Safari when no src attr set — always false; fixed to `coverImage.getAttribute('src') !== b.coverImage`
51. ✅ preview.html payBtn never enabled: required `hasCover && has2Imgs` — if page images were slow/failed, payBtn stayed disabled forever even with cover ready; fixed to enable on `hasCover` alone; safety net added in timeout fallback
52. ✅ delivery.html PDF redesign: professional children's picture book layout — alternating Layout A (odd: gold 9mm header bar, full-bleed image 70%, cream bottom 30%, justified Times 12pt body) + Layout B (even: full-bleed image 58%, scallop wave transition, triple diamond ornament, centered Times 13pt); cover page: dark bg, starfield, gold 4.5mm bars, gold-framed illustration, corner L-ornaments, Times bold title; back cover: dark bg, starfield, gold branding; loadB64 helper for Supabase Storage URLs → canvas → data: for jsPDF embedding
53. ✅ checkout.js: replaced LemonSqueezy `/api/create-checkout-session` fetch with direct Gumroad redirect to https://lilypad583.gumroad.com/l/personalized-storybook?wanted=true; checkout.html: added "📬 After purchase, email your child's photo and details to: books@lifebooks.online" note below pay button in muted text
