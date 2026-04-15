const API_BASE = window.location.origin;

function getBookId() {
  return new URLSearchParams(window.location.search).get("bookId");
}

document.addEventListener("DOMContentLoaded", async function() {
  var bookId = getBookId();

  var coverImageEl     = document.getElementById("coverImage");
  var bookTitleValue   = document.getElementById("bookTitleValue");
  var bookSubtitleValue= document.getElementById("bookSubtitleValue");
  var nameEl           = document.getElementById("name");
  var ageEl            = document.getElementById("age");
  var styleEl          = document.getElementById("style");
  var pagesEl          = document.getElementById("pages");
  var proceedBtn       = document.getElementById("proceedToPaymentBtn");
  var backToPreviewBtn = document.getElementById("backToPreviewBtn");
  var backToCoverBtn   = document.getElementById("backToCoverBtn");
  var checkoutStatus   = document.getElementById("checkoutStatus");

  if (!bookId) {
    window.location.href = "wizard.html";
    return;
  }

  var book = null;

  async function loadBook() {
    var res  = await fetch(API_BASE + "/api/books/" + bookId);
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load book");
    return data.book;
  }

  function renderBook(b) {
    if (!b) return;
    if (coverImageEl) {
      var src = b.coverImage || b.croppedPhoto || b.originalPhoto;
      if (src) coverImageEl.src = src;
      else coverImageEl.style.display = "none";
    }
    if (bookTitleValue)    bookTitleValue.textContent    = b.generatedBook && b.generatedBook.title    ? b.generatedBook.title    : "-";
    if (bookSubtitleValue) bookSubtitleValue.textContent = b.generatedBook && b.generatedBook.subtitle ? b.generatedBook.subtitle : "";
    if (nameEl)  nameEl.textContent  = b.childName         || "-";
    if (ageEl)   ageEl.textContent   = b.childAge          || "-";
    if (styleEl) styleEl.textContent = b.illustrationStyle || "-";
    if (pagesEl) pagesEl.textContent = String((b.generatedBook && b.generatedBook.pages ? b.generatedBook.pages.length : 0)) + " pages";
  }

  async function redirectToStripe() {
    if (!book) throw new Error("Book details are still loading.");

    proceedBtn.disabled    = true;
    proceedBtn.textContent = "Opening secure checkout...";

    if (checkoutStatus) {
      checkoutStatus.textContent = "Redirecting to secure payment...";
      checkoutStatus.className = "status-note";
    }

    var res  = await fetch(API_BASE + "/api/create-checkout-session", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ bookId: bookId })
    });

    var data = await res.json();

    if (!res.ok || !data.url) throw new Error(data.message || "Failed to open payment page.");

    window.location.href = data.url;
  }

  backToPreviewBtn && backToPreviewBtn.addEventListener("click", function() {
    window.location.href = "preview.html?bookId=" + encodeURIComponent(bookId);
  });

  backToCoverBtn && backToCoverBtn.addEventListener("click", function() {
    window.location.href = "cover.html?bookId=" + encodeURIComponent(bookId);
  });

  proceedBtn && proceedBtn.addEventListener("click", async function() {
    try {
      await redirectToStripe();
    } catch(error) {
      console.error("Stripe redirect failed:", error);
      if (checkoutStatus) {
        checkoutStatus.textContent = error.message || "Failed to open payment page.";
        checkoutStatus.className = "status-note error";
      }
      proceedBtn.disabled    = false;
      proceedBtn.textContent = "Pay Securely - $39";
    }
  });

  try {
    book = await loadBook();
    renderBook(book);
  } catch(error) {
    console.error("loadBook failed:", error);
    if (checkoutStatus) {
      checkoutStatus.textContent = error.message || "Failed to load book.";
      checkoutStatus.className = "status-note error";
    }
  }
});
