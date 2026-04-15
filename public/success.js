import { clearBookData, updateBookData } from "./js/state.js";

const API_BASE = window.location.origin;

// ─── Read params from URL ────────────────────────────────────────────────────
function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Support both ?bookId=... (direct) and ?orderId=... (from Shopify redirect)
let bookId = getUrlParam("bookId");
const orderId = getUrlParam("orderId") || getUrlParam("order_id");

// ─── DOM refs ────────────────────────────────────────────────────────────────
const successCoverFill     = document.getElementById("successCoverFill");
const successChildName     = document.getElementById("successChildName");
const successFormat        = document.getElementById("successFormat");
const successPrice         = document.getElementById("successPrice");
const successPages         = document.getElementById("successPages");
const backToCheckoutBtn    = document.getElementById("backToCheckoutBtn");
const goHomeBtn            = document.getElementById("goHomeBtn");
const createAnotherBtn     = document.getElementById("createAnotherBtn");
const successBrandLogo     = document.getElementById("successBrandLogo");
const openBookBtn          = document.getElementById("openBookBtn");
const statusMsg            = document.getElementById("successStatusMsg");

// ─── Logo error handling ─────────────────────────────────────────────────────
function hideBrokenLogo(img) {
  if (!img) return;
  img.addEventListener("error", () => { img.style.display = "none"; });
}
hideBrokenLogo(successBrandLogo);

// ─── Resolve bookId from orderId if needed ───────────────────────────────────
async function resolveBookId() {
  // If we already have bookId, nothing to do
  if (bookId) return bookId;

  // Try to get bookId from Shopify orderId via our API
  if (orderId) {
    try {
      const res = await fetch(`${API_BASE}/api/order/${encodeURIComponent(orderId)}`);
      const data = await res.json();
      if (res.ok && data.bookId) {
        return data.bookId;
      }
    } catch (err) {
      console.error("resolveBookId failed:", err);
    }
  }

  return null;
}

// ─── Fetch book from API ─────────────────────────────────────────────────────
async function loadBook(id) {
  const res = await fetch(`${API_BASE}/api/books/${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to load book");
  return data.book;
}

// ─── Poll until purchaseUnlocked = true (max ~30 sec) ───────────────────────
async function waitForUnlock(id, maxAttempts = 12, intervalMs = 2500) {
  for (let i = 0; i < maxAttempts; i++) {
    const book = await loadBook(id);
    if (book.purchaseUnlocked === true) return book;

    if (statusMsg) {
      statusMsg.textContent = `Confirming your payment… (${i + 1}/${maxAttempts})`;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  // Return book even if still not unlocked — show it anyway but flag it
  return await loadBook(id);
}

// ─── Render book data into the page ─────────────────────────────────────────
function renderBook(book) {
  if (!book) return;

  if (successCoverFill) {
    const src = book.coverImage || book.croppedPhoto || book.originalPhoto;
    if (src) {
      successCoverFill.src = src;
    } else {
      successCoverFill.style.display = "none";
    }
  }

  if (successChildName) successChildName.textContent = book.childName || "-";
  if (successFormat)    successFormat.textContent    = book.selectedFormat === "printed" ? "Printed Book" : "Digital Book";
  if (successPrice) {
    const price = book.selectedPrice || (book.selectedFormat === "printed" ? 49 : 39);
    successPrice.textContent = `$${price}`;
  }
  if (successPages) successPages.textContent = String(book.generatedBook?.pages?.length || 0);

  // Show "Open Book" button only if purchase is confirmed
  if (openBookBtn) {
    openBookBtn.style.display = book.purchaseUnlocked ? "inline-flex" : "none";
    openBookBtn.onclick = () => {
      window.location.href = `reader.html?bookId=${encodeURIComponent(book.bookId)}`;
    };
  }

  if (statusMsg) {
    statusMsg.textContent = book.purchaseUnlocked
      ? "✓ Payment confirmed. Your book is ready!"
      : "⚠ Payment confirmation is taking longer than expected. Your book will unlock shortly.";
    statusMsg.style.color = book.purchaseUnlocked ? "#a0f0b0" : "#f0d090";
  }

  // Sync state for other pages
  updateBookData({
    bookId: book.bookId,
    childName: book.childName || "",
    childAge: book.childAge || "",
    childGender: book.childGender || "",
    storyIdea: book.storyIdea || "",
    illustrationStyle: book.illustrationStyle || "",
    croppedPhoto: book.croppedPhoto || "",
    originalPhoto: book.originalPhoto || "",
    generatedBook: book.generatedBook || null,
    characterReference: book.characterReference || null,
    purchaseUnlocked: book.purchaseUnlocked === true,
    selectedFormat: book.selectedFormat || "digital",
    selectedPrice: book.selectedPrice || 39
  });
}

// ─── Button listeners ────────────────────────────────────────────────────────
backToCheckoutBtn?.addEventListener("click", () => {
  if (bookId) {
    window.location.href = `checkout.html?bookId=${encodeURIComponent(bookId)}`;
  } else {
    window.location.href = "wizard.html";
  }
});

goHomeBtn?.addEventListener("click", () => {
  window.location.href = "index.html";
});

createAnotherBtn?.addEventListener("click", () => {
  clearBookData();
  window.location.href = "wizard.html";
});

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (statusMsg) statusMsg.textContent = "Loading your order…";

    // Step 1: resolve bookId (might come from orderId via Shopify redirect)
    bookId = await resolveBookId();

    if (!bookId) {
      if (statusMsg) {
        statusMsg.textContent = "Could not find your order. Please contact support.";
        statusMsg.style.color = "#ffb5b5";
      }
      return;
    }

    // Step 2: poll until payment is confirmed in our DB (webhook may take a moment)
    const book = await waitForUnlock(bookId);
    renderBook(book);
  } catch (err) {
    console.error("success page error:", err);
    if (statusMsg) {
      statusMsg.textContent = err.message || "Failed to load confirmation page.";
      statusMsg.style.color = "#ffb5b5";
    }
  }
})();
