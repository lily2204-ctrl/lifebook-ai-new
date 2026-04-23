# Lifebook AI — Project Context & Status
*Last updated: April 16, 2026*

## ⚠️ DO NOT MODIFY — ALREADY DONE
- `public/assets/branding/logo.svg` — viewBox `430 466 639 514`, transparent bg
- All HTML: `<img src="assets/branding/logo.svg" style="height:48px;width:auto;display:block"/>` — NO mix-blend-mode, NO logo.png
- `public/accessibility.js` — on ALL pages via `<script src="accessibility.js"></script>` before `</body>`
- `public/404.html` — Hebrew error page
- `server.js` two-email system — `sendPaymentConfirmationEmail` + `sendBookReadyEmail`
- `server.js` `updateBookField()` — NO `.select()` — safe for large images
- `server.js` `insertBook()` — NO `.select()` — safe for large photos
- `public/preview.html` — step tracker loading screen, all English

## ⚠️ CRITICAL DB RULES
```javascript
// ✅ CORRECT — no .select()
await updateBookField(bookId, { fullImages: [...fullImages] });
await updateBookField(bookId, { characterReference });
await updateBookField(bookId, { generatedBook });
// ✅ insertBook also has no .select()

// ❌ WRONG — causes Supabase timeout
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
- Stripe completely removed from server.js and package.json
- LemonSqueezy store: lifebooks.lemonsqueezy.com (Store ID: 347433)
- Webhook: POST /webhooks/lemonsqueezy → verify signature → unlock book → send emails
- Checkout: /api/create-checkout-session returns LemonSqueezy checkout URL
- success.html polls for purchaseUnlocked, then redirects to delivery.html

## Railway Env Vars
```
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
RESEND_API_KEY
APP_URL=https://lifebooks.online
ADMIN_EMAIL=books@lifebooks.online
LEMONSQUEEZY_API_KEY
LEMONSQUEEZY_WEBHOOK_SECRET
LEMONSQUEEZY_STORE_ID=347433
LEMONSQUEEZY_VARIANT_ID
```
NO STRIPE vars — Stripe is gone completely.

---

## generate-full Pipeline
```
STEP 1: Analyze photo → updateBookField(characterReference) (~30s)
STEP 2: Write story 12 pages → updateBookField(generatedBook) (~45s)
STEP 3+4a: Cover + pages 0,1 IN PARALLEL → updateBookField each individually (~60s)
STEP 4b: Remaining pages batches of 5, each saved immediately with updateBookField
STEP 5: sendBookReadyEmail ONLY if purchaseUnlocked === true
```

---

## Known Bugs (fix these)

### 🔴 Critical
1. **crop.html mobile** — "Create My Book" button stuck, does not proceed to preview
   - Check crop.js button click handler
   - Check /api/books/create endpoint works
   - Check sessionStorage has childName, storyIdea etc from wizard
   - May be a mobile-specific JS issue

2. **success.html** — "Open My Book" must go to delivery.html NOT checkout/reader
   - openBtn.onclick → `delivery.html?bookId=...`
   - Only after purchaseUnlocked === true

3. **delivery.html PDF error** — `undefined is not an object (evaluating 'book.generatedBook')`
   - Add null safety: `book?.generatedBook?.title`, `book?.generatedBook?.pages`
   - Check book is loaded before generatePDF() runs

### 🟡 Important
4. **Cover image** — AI renders text inside image
   - Add to coverPrompt: "NO text, letters, words, numbers, or writing of any kind rendered inside the image"
   - Same for generatePageImage() prompt

5. **Character consistency** — varies across pages
   - Improve characterPromptCore to be more specific
   - End with: "This is the SAME child that must appear identically in every illustration"

6. **index.html** — still shows "16 pages" in some places → change to "12 pages"

### 🟢 Nice to have
7. Hebrew on all pages (currently only wizard.html)
8. Terms & Refund policy page

---

## File Structure
```
server.js · CLAUDE.md · package.json
public/
  index.html · wizard.html/js · crop.html/js · setup.html/js
  preview.html     ← step tracker loading screen
  checkout.html/js ← uses LemonSqueezy NOT Stripe
  success.html/js  ← openBtn → delivery.html after purchaseUnlocked
  delivery.html    ← null safety on book.generatedBook
  reader.html/js · cover.html/js · contact.html
  404.html · accessibility.js · styles.css
  js/state.js · assets/branding/logo.svg
```

---

## Bugs Fixed History
1. ✅ Supabase timeout → updateBookField + JPEG
2. ✅ setup.js legacy flow
3. ✅ Stripe webhook 21% errors
4. ✅ PDF emoji garbage
5. ✅ Logo SVG viewBox
6. ✅ SyntaxError crashes
7. ✅ Cover + pages 0,1 parallel
8. ✅ Each image saves immediately
9. ✅ updateBookField not defined
10. ✅ insertBook had .select()
11. ✅ characterReference/generatedBook used updateBook → fixed to updateBookField
12. ✅ Stripe removed, LemonSqueezy integrated
13. ✅ preview.html Hebrew text → English
