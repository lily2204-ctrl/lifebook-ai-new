const API_BASE = window.location.origin;

// ─── URL param ────────────────────────────────────────────────────────────────
function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

const bookId = getUrlParam("bookId");

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const printTitle       = document.getElementById("printTitle");
const spreadList       = document.getElementById("spreadList");
const backToPreviewBtn = document.getElementById("backToPreviewBtn");
const goToReaderBtn    = document.getElementById("goToReaderBtn");
const goToCheckoutBtn  = document.getElementById("goToCheckoutBtn");
const printBrandLogo   = document.getElementById("printBrandLogo");

if (printBrandLogo) {
  printBrandLogo.addEventListener("error", () => { printBrandLogo.style.display = "none"; });
}

let book       = null;
let pages      = [];
let fullImages = [];

const generatedImageCache = new Map();

// ─── Load book from API ───────────────────────────────────────────────────────
async function loadBook() {
  if (!bookId) throw new Error("Missing bookId in URL");
  const res  = await fetch(`${API_BASE}/api/books/${encodeURIComponent(bookId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to load book");
  return data.book;
}

// ─── Get image: stored first, generate as fallback ────────────────────────────
async function getPageImage(index) {
  if (Array.isArray(fullImages) && fullImages[index]) {
    const stored = fullImages[index];
    return stored.startsWith("data:") ? stored : `data:image/png;base64,${stored}`;
  }

  const previewImages = book.previewImages || [];
  if (Array.isArray(previewImages) && previewImages[index]) {
    const preview = previewImages[index];
    return preview.startsWith("data:") ? preview : `data:image/png;base64,${preview}`;
  }

  // Last resort: generate fresh
  const cacheKey = `gen-${index}`;
  if (generatedImageCache.has(cacheKey)) return generatedImageCache.get(cacheKey);

  const characterReference = book.characterReference || {};
  const res = await fetch(`${API_BASE}/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt:              pages[index]?.imagePrompt || "",
      illustration_style:  book.illustrationStyle || "Soft Storybook",
      characterPromptCore: characterReference.characterPromptCore || "",
      characterSummary:    characterReference.characterSummary || ""
    })
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result?.message || `Failed to generate page ${index + 1}`);

  const src = `data:image/png;base64,${result.imageBase64}`;
  generatedImageCache.set(cacheKey, src);
  return src;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createSpreadCard(leftPage, leftIndex, rightPage, rightIndex) {
  const section = document.createElement("section");
  section.className = "spread-card";

  const rightPageHtml = rightPage
    ? `
      <article class="print-page" id="print-page-${rightIndex}">
        <div class="print-page-image-wrap" data-image-slot="${rightIndex}">
          <div class="print-page-loading">Loading page ${rightIndex + 1}…</div>
        </div>
        <div class="print-page-text">${escapeHtml(rightPage.text || "")}</div>
      </article>
    `
    : `
      <article class="print-page">
        <div class="print-page-image-wrap">
          <div class="print-page-loading"></div>
        </div>
        <div class="print-page-text"></div>
      </article>
    `;

  section.innerHTML = `
    <div class="spread-header">
      <div class="spread-badge">Spread ${Math.floor(leftIndex / 2) + 1}</div>
      <div class="spread-badge">Pages ${leftIndex + 1}${rightPage ? ` – ${rightIndex + 1}` : ""}</div>
    </div>
    <div class="spread-grid">
      <article class="print-page" id="print-page-${leftIndex}">
        <div class="print-page-image-wrap" data-image-slot="${leftIndex}">
          <div class="print-page-loading">Loading page ${leftIndex + 1}…</div>
        </div>
        <div class="print-page-text">${escapeHtml(leftPage.text || "")}</div>
      </article>
      ${rightPageHtml}
    </div>
  `;

  return section;
}

// ─── Render all spreads ───────────────────────────────────────────────────────
async function renderSpreads() {
  if (!spreadList) return;
  spreadList.innerHTML = "";

  for (let i = 0; i < pages.length; i += 2) {
    const leftPage  = pages[i];
    const rightPage = pages[i + 1] || null;

    const spread = createSpreadCard(leftPage, i, rightPage, i + 1);
    spreadList.appendChild(spread);

    // Load left image
    const leftSlot = spread.querySelector(`[data-image-slot="${i}"]`);
    try {
      const leftSrc = await getPageImage(i);
      leftSlot.innerHTML = `<img class="print-page-image" src="${leftSrc}" alt="Page ${i + 1}" />`;
    } catch (err) {
      console.error(`Print page ${i + 1} failed:`, err);
      leftSlot.innerHTML = `<div class="print-page-error">Failed to load page ${i + 1}</div>`;
    }

    // Load right image
    if (rightPage) {
      const rightSlot = spread.querySelector(`[data-image-slot="${i + 1}"]`);
      try {
        const rightSrc = await getPageImage(i + 1);
        rightSlot.innerHTML = `<img class="print-page-image" src="${rightSrc}" alt="Page ${i + 2}" />`;
      } catch (err) {
        console.error(`Print page ${i + 2} failed:`, err);
        rightSlot.innerHTML = `<div class="print-page-error">Failed to load page ${i + 2}</div>`;
      }
    }
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
backToPreviewBtn?.addEventListener("click", () => {
  window.location.href = bookId
    ? `preview.html?bookId=${encodeURIComponent(bookId)}`
    : "preview.html";
});

goToReaderBtn?.addEventListener("click", () => {
  window.location.href = bookId
    ? `reader.html?bookId=${encodeURIComponent(bookId)}`
    : "reader.html";
});

goToCheckoutBtn?.addEventListener("click", () => {
  window.location.href = bookId
    ? `checkout.html?bookId=${encodeURIComponent(bookId)}`
    : "checkout.html";
});

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (!bookId) {
      alert("Missing bookId.");
      window.location.href = "wizard.html";
      return;
    }

    book       = await loadBook();
    pages      = book.generatedBook?.pages || [];
    fullImages = book.fullImages || [];

    if (pages.length === 0) {
      alert("This book has no pages.");
      window.location.href = `preview.html?bookId=${encodeURIComponent(bookId)}`;
      return;
    }

    if (printTitle) {
      printTitle.textContent = book.generatedBook?.title || "Print-ready preview";
    }

    await renderSpreads();
  } catch (err) {
    console.error("Print init error:", err);
    if (spreadList) {
      spreadList.innerHTML = `<div style="text-align:center;padding:40px;color:#f3b5a5;">${err.message || "Failed to load book."}</div>`;
    }
  }
})();
