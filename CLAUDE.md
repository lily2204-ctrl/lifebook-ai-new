# Lifebook AI — Project Context & Status
*Last updated: April 18, 2026*

## ⚠️ DO NOT MODIFY — ALREADY DONE
- `public/assets/branding/logo.svg` — viewBox `430 466 639 514`, transparent bg
- All HTML: `<img src="assets/branding/logo.svg" style="height:54px;width:auto;display:block"/>` — NO mix-blend-mode, NO logo.png
- `public/accessibility.js` — on ALL pages via `<script src="accessibility.js"></script>` before `</body>`
- `public/404.html` — Hebrew error page
- `server.js` two-email system — `sendPaymentConfirmationEmail` + `sendBookReadyEmail` — DO NOT TOUCH
- `server.js` `updateBookField()` — NO `.select()` — safe for large images — DO NOT CHANGE
- `server.js` `insertBook()` — NO `.select()` — safe for large photos — DO NOT CHANGE
- `public/preview.html` — step tracker loading screen, all English, DO NOT REVERT

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
Node.js/Express · Supabase Pro · OpenAI gpt-4o-mini + gpt-image-1 · LemonSqueezy (payments) · Resend · Railway

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

## Key Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/books/create` | POST | Creates book record — NO .select() on insert |
| `/api/books/:id/generate-full` | POST | Full pipeline — background IIFE, returns 200 immediately |
| `/api/books/:id` | GET | Fetch book (polling every 2s) |
| `/api/books/:id/unlock` | POST | Manual unlock (dev only) |
| `/api/books/:id/resend-email` | POST | Resend book ready link |
| `/api/books/:id/update-photo` | POST | Update cropped photo |
| `/api/create-checkout-session` | POST | LemonSqueezy checkout → returns { url } |
| `/webhooks/lemonsqueezy` | POST | Verify sig → unlock book → send emails |
| `/api/contact` | POST | Contact form |

---

## Image Generation Rules (gpt-image-1)
- Cover + page images: NEVER render text inside the image
- Cover prompt must include: "NO text, letters, words, numbers, or writing of any kind rendered inside the image" + "NO captions, titles, subtitles, labels, or book title text on the image"
- Page prompt must include same rule + "NO captions, labels, speech bubbles"
- Character prompts end with: "This is the SAME child that must appear identically in every illustration"
- `buildCharacterPromptCore()` has LOCKED CHILD CHARACTER header + 6-rule CONSISTENCY RULES block

---

## Known Bugs — Open
### 🟢 Nice to have
1. Hebrew on all pages (currently only wizard.html has full toggle)
2. Terms & Refund policy page (terms.html exists but not linked from all pages)

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
  reader.html/js · cover.html/js · contact.html · terms.html
  404.html · accessibility.js · styles.css
  js/state.js · assets/branding/logo.svg
```

---

## Bugs Fixed History
1. ✅ Supabase timeout → updateBookField + JPEG
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
