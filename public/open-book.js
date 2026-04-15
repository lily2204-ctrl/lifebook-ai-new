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

async function loadBookIdFromOrder(orderIdValue) {
  const res = await fetch(`${API_BASE}/api/order/${encodeURIComponent(orderIdValue)}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "Failed to find book from order");
  }

  return data.bookId;
}

async function tryOpenBook() {
  try {
    setStatus("Checking payment status...");

    let finalBookId = bookId;

    if (!finalBookId && orderId) {
      finalBookId = await loadBookIdFromOrder(orderId);
    }

    if (!finalBookId) {
      setStatus("Missing book ID.", true);
      return;
    }

    const book = await loadBookById(finalBookId);

    if (book.purchaseUnlocked === true || book.paymentStatus === "paid") {
      setStatus("Your book is ready. Redirecting...");
      window.location.href = `preview.html?bookId=${encodeURIComponent(finalBookId)}`;
      return;
    }

    setStatus("Your payment has not been confirmed yet. Please wait a moment and try again.", true);
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
