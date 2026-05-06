const API_BASE = window.location.origin;

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

const bookId = getQueryParam("bookId");
const orderId = getQueryParam("order_id");

const statusEl = document.getElementById("openBookStatus");
const retryBtn = document.getElementById("retryBtn");
const goHomeBtn = document.getElementById("goHomeBtn");

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function loadBookById(id) {
  const res = await fetch(`${API_BASE}/api/books/${id}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "Failed to load book");
  }

  return data.book;
}

async function tryOpenBook() {
  try {
    setStatus("Loading your book...");

    if (!bookId) {
      setStatus("Missing book ID. Please use the link from your email.", true);
      return;
    }

    const book = await loadBookById(bookId);

    setStatus("Your book is ready. Redirecting...");
    window.location.href = `delivery.html?bookId=${encodeURIComponent(bookId)}`;
  } catch (error) {
    console.error("open-book failed:", error);
    setStatus(error.message || "Failed to open your book.", true);
  }
}

retryBtn?.addEventListener("click", () => {
  tryOpenBook();
});

goHomeBtn?.addEventListener("click", () => {
  window.location.href = "index.html";
});

tryOpenBook();
