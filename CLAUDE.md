# Lifebook AI — Project Context & Status
*Last updated: April 15, 2026*

## ⚠️ DO NOT MODIFY — ALREADY DONE
- `public/assets/branding/logo.svg` — new logo, viewBox `430 466 639 514`, transparent bg
- All HTML pages: `<img src="assets/branding/logo.svg" style="height:48px;width:auto;display:block"/>` — NO mix-blend-mode, NO logo.png
- `public/accessibility.js` — widget on ALL pages via `<script src="accessibility.js"></script>` before `</body>`
- `public/404.html` — Hebrew error page
- `server.js` two-email system — `sendPaymentConfirmationEmail` + `sendBookReadyEmail`
- `server.js` `updateBookField()` — DO NOT replace with `updateBook()` for image saves
- `public/preview.html` — new loading screen with step tracker + live timer (DO NOT revert to spinner)

---

## Project Overview
AI-powered personalized children's storybook generator.
Wizard → photo upload → crop → AI generates illustrated book → payment → PDF + email.

## URLs
- **Live:** https://lifebooks.online
- **Railway:** https://romantic-patience-production.up.railway.app

## Stack
Node.js/Express (`server.js`, ES modules) · Supabase (PostgreSQL Pro) · OpenAI gpt-4o-mini + gpt-image-1 · Stripe (sandbox) · Resend (`books@lifebooks.online` ✅) · Railway

---

## User Flow
```
wizard.html → crop.html → preview.html → checkout.html → success.html → delivery.html → reader.html
```
Both `crop.js` and `setup.js`: call `/api/books/create` → kick `/api/books/:id/generate-full` (fire & forget) → redirect to `preview.html?bookId=...`

---

## Design System
```css
--cream:#fdf6ec; --gold:#c8922a; --gold-light:#e8b84b; --brown:#5c3d1e;
--text:#3a2810; --text-muted:#7a6048; --parchment:#ede0c8;
```
Fonts: Playfair Display + Lato

---

## Key Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/books/create` | POST | Creates book record in Supabase |
| `/api/books/:id/generate-full` | POST | Full pipeline — background, returns immediately |
| `/api/books/:id` | GET | Fetch book (polling every 2.5s) |
| `/api/books/:id/unlock` | POST | Manual unlock (dev) |
| `/api/books/:id/resend-email` | POST | Resend book link |
| `/api/books/:id/update-photo` | POST | Update cropped photo |
| `/api/create-checkout-session` | POST | Stripe checkout |
| `/webhooks/stripe` | POST | Unlock book + send confirmation email |
| `/api/contact` | POST | Contact form |

---

## generate-full Pipeline
```
STEP 1: Analyze photo → characterReference (~30s)
STEP 2: Write story (12 pages) → generatedBook (~45s)
STEP 3+4a: Cover + pages 0,1 IN PARALLEL → saved individually (~60s)  ← already implemented
STEP 4b: Remaining pages, batches of 5, each saved immediately on completion (~5min)
STEP 5: Send book-ready email ONLY if purchaseUnlocked === true
```

## ⚠️ Critical DB Pattern
```javascript
// ✅ CORRECT — no .select(), safe for large images
await updateBookField(bookId, { fullImages: [...fullImages] });

// ❌ WRONG — returns full row → Supabase timeout with images
await updateBook(bookId, { fullImages });
```

---

## Email System
- **Mail 1:** "Payment confirmed" → sent immediately on Stripe webhook
- **Mail 2:** "Book ready" → sent at end of generate-full ONLY if `purchaseUnlocked === true`
- Edge case: book already complete at payment → both emails sent together

---

## preview.html — Loading Screen
New step tracker (DO NOT revert):
- Live timer (0:00, 0:01...)
- 4 steps with icons: 📷 Analyzing → ✍️ Writing → 🎨 Illustrating → 📖 Ready
- Each step marks ✅ when done with actual elapsed time
- Progress bar
- "You can close this tab" note

## preview.html — After Loading
- Shows story text + shimmer placeholders immediately when generatedBook exists
- Unlock button enabled only after cover + 2 page images exist
- Progress counter: "✨ X/16 pages illustrated"

## delivery.html — After Payment
- Live progress bar: "X/16 pages ready — ~N min remaining"
- ETA = remaining × 25s
- "✅ Your book is complete!" when done

---

## Payments
- **Stripe:** US sandbox only (no live — needs SSN)
- **Payoneer:** ✅ Approved
- **TODO:** LemonSqueezy (1 day, ~5%) or PayPlus (1 week, ~1-3%)

---

## Bugs Fixed
1. ✅ Supabase timeout → `updateBookField()` + JPEG compression
2. ✅ setup.js went to legacy generate.html → fixed to use generate-full
3. ✅ Stripe webhook 21% errors → returns 200 immediately
4. ✅ PDF emoji garbage → geometric shapes
5. ✅ Logo invisible → SVG viewBox fixed
6. ✅ SyntaxError crashes → fixed
7. ✅ Cover + pages 0,1 now parallel → ~60s saved
8. ✅ Each image saves immediately → user sees them appear one by one
9. ✅ updateBookField was called but never defined → added

---

## TODO
### 🔴 Critical
- [ ] Payment: LemonSqueezy or PayPlus
- [ ] End-to-end test with real payment

### 🟡 Important
- [ ] Terms & Refund policy page
- [ ] Reduce preview time further if possible

### 🟢 Nice to have
- [ ] Hebrew on more pages
- [ ] Analytics
- [ ] OpenAI fallback

---

## Railway Env Vars
```
OPENAI_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY,
APP_URL=https://lifebooks.online, ADMIN_EMAIL=books@lifebooks.online
```

---

## File Structure
```
server.js · CLAUDE.md · package.json
public/
  index.html · wizard.html/js · crop.html/js · setup.html/js
  preview.html          ← new loading screen, DO NOT revert
  checkout.html/js · success.html/js · delivery.html
  reader.html/js · cover.html/js · contact.html
  404.html              ← DO NOT REMOVE
  accessibility.js      ← DO NOT REMOVE, already on all pages
  generate.html/js      ← legacy, not used in normal flow
  styles.css · print.html · open-book.html
  js/state.js           ← sessionStorage state
  assets/branding/logo.svg  ← DO NOT REPLACE
```
