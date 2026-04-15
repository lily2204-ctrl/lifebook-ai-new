const API_BASE = window.location.origin;

// ─── URL param ────────────────────────────────────────────────────────────────
function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

const bookId = getUrlParam("bookId");

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const readerTitle      = document.getElementById("readerTitle");
const readerSubtitle   = document.getElementById("readerSubtitle");
const readerPageBadge  = document.getElementById("readerPageBadge");
const readerImageWrap  = document.getElementById("readerImageWrap");
const readerPageText   = document.getElementById("readerPageText");
const readerPageCounter = document.getElementById("readerPageCounter");
const prevPageBtn      = document.getElementById("prevPageBtn");
const nextPageBtn      = document.getElementById("nextPageBtn");
const backToPreviewBtn = document.getElementById("backToPreviewBtn");
const readerBrandLogo  = document.getElementById("readerBrandLogo");

if (readerBrandLogo) {
  readerBrandLogo.addEventListener("error", () => { readerBrandLogo.style.display = "none"; });
}

let book = null;
let pages = [];
let fullImages = [];
let currentPageIndex = 0;

// In-session cache so we never re-generate the same image twice
const generatedImageCache = new Map();

// ─── Load book from API ───────────────────────────────────────────────────────
async function loadBook() {
  if (!bookId) {
    throw new Error("Missing bookId in URL");
  }

  const res = await fetch(`${API_BASE}/api/books/${encodeURIComponent(bookId)}`);
  const data = await res.json();

  if (!res.ok) throw new Error(data.message || "Failed to load book");
  return data.book;
}

// ─── Generate a page image on demand (fallback if not pre-generated) ──────────
async function generatePageImage(page, index) {
  const cacheKey = `gen-${index}`;
  if (generatedImageCache.has(cacheKey)) {
    return generatedImageCache.get(cacheKey);
  }

  const characterReference = book.characterReference || {};

  const res = await fetch(`${API_BASE}/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: page.imagePrompt || "",
      illustration_style: book.illustrationStyle || "Soft Storybook",
      characterPromptCore: characterReference.characterPromptCore || "",
      characterSummary: characterReference.characterSummary || ""
    })
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result?.message || `Failed to generate image for page ${index + 1}`);

  const src = `data:image/png;base64,${result.imageBase64}`;
  generatedImageCache.set(cacheKey, src);
  return src;
}

// ─── Get image for a page — prefer stored, fallback to generate ───────────────
async function getPageImage(index) {
  // 1. Use fullImages stored in Supabase if available
  if (Array.isArray(fullImages) && fullImages[index]) {
    const stored = fullImages[index];
    // Handle both base64 strings and data URLs
    if (stored.startsWith("data:")) return stored;
    return `data:image/png;base64,${stored}`;
  }

  // 2. Check previewImages as fallback (may be lower quality but works)
  const previewImages = book.previewImages || [];
  if (Array.isArray(previewImages) && previewImages[index]) {
    const preview = previewImages[index];
    if (preview.startsWith("data:")) return preview;
    return `data:image/png;base64,${preview}`;
  }

  // 3. Last resort: generate fresh (costs API call)
  const page = pages[index];
  if (!page) throw new Error(`No page data at index ${index}`);
  return await generatePageImage(page, index);
}

// ─── Render the current page ──────────────────────────────────────────────────
async function renderCurrentPage() {
  const page = pages[currentPageIndex];
  const pageNumber = currentPageIndex + 1;

  if (readerPageBadge)   readerPageBadge.textContent = `Page ${pageNumber}`;
  if (readerPageCounter) readerPageCounter.textContent = `Page ${pageNumber} of ${pages.length}`;
  if (readerPageText)    readerPageText.textContent = page?.text || "";

  if (prevPageBtn) {
    prevPageBtn.disabled = currentPageIndex === 0;
    prevPageBtn.style.opacity = currentPageIndex === 0 ? "0.55" : "1";
  }

  if (nextPageBtn) {
    nextPageBtn.textContent = currentPageIndex === pages.length - 1 ? "Finish" : "Next →";
  }

  if (readerImageWrap) {
    readerImageWrap.innerHTML = `<div class="reader-image-loading">Loading illustration for page ${pageNumber}…</div>`;
  }

  try {
    const imageSrc = await getPageImage(currentPageIndex);

    if (readerImageWrap) {
      readerImageWrap.innerHTML = `
        <img class="reader-image" src="${imageSrc}" alt="Illustration for page ${pageNumber}" />
      `;
    }
  } catch (err) {
    console.error(`Page ${pageNumber} image error:`, err);
    if (readerImageWrap) {
      readerImageWrap.innerHTML = `
        <div class="reader-image-error">
          Could not load illustration for page ${pageNumber}.
        </div>
      `;
    }
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
prevPageBtn?.addEventListener("click", async () => {
  if (currentPageIndex === 0) return;
  currentPageIndex -= 1;
  await renderCurrentPage();
});

nextPageBtn?.addEventListener("click", async () => {
  if (currentPageIndex < pages.length - 1) {
    currentPageIndex += 1;
    await renderCurrentPage();
    return;
  }
  // Last page done
  window.location.href = `delivery.html?bookId=${encodeURIComponent(bookId)}`;
});

backToPreviewBtn?.addEventListener("click", () => {
  window.location.href = bookId
    ? `preview.html?bookId=${encodeURIComponent(bookId)}`
    : "preview.html";
});

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (!bookId) {
      alert("Missing bookId. Please return to checkout.");
      window.location.href = "wizard.html";
      return;
    }

    book = await loadBook();

    // Verify purchase is unlocked
    if (!book.purchaseUnlocked) {
      alert("This book has not been purchased yet. Please complete checkout first.");
      window.location.href = `checkout.html?bookId=${encodeURIComponent(bookId)}`;
      return;
    }

    pages = book.generatedBook?.pages || [];
    fullImages = book.fullImages || [];

    if (pages.length === 0) {
      alert("This book has no pages. Please go back and try again.");
      window.location.href = `preview.html?bookId=${encodeURIComponent(bookId)}`;
      return;
    }

    if (readerTitle)    readerTitle.textContent    = book.generatedBook?.title    || "Your Magical Adventure";
    if (readerSubtitle) readerSubtitle.textContent = book.generatedBook?.subtitle || "A story where you are the hero";

    await renderCurrentPage();
  } catch (err) {
    console.error("Reader init error:", err);
    if (readerImageWrap) {
      readerImageWrap.innerHTML = `<div class="reader-image-error">${err.message || "Failed to load book."}</div>`;
    }
  }
})();
