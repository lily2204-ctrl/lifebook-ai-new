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
  var gumroadBtn       = document.getElementById("gumroadBtn");
  var backToPreviewBtn = document.getElementById("backToPreviewBtn");
  var backToCoverBtn   = document.getElementById("backToCoverBtn");
  var checkoutStatus   = document.getElementById("checkoutStatus");

  if (!bookId) {
    window.location.href = "wizard.html";
    return;
  }

  // Set bookId as referral parameter and wire up direct redirect on click
  if (gumroadBtn) {
    var gumroadUrl = "https://lilypad583.gumroad.com/l/personalized-storybook?wanted=true&referral=" + encodeURIComponent(bookId);
    gumroadBtn.href = gumroadUrl;
    gumroadBtn.addEventListener("click", function(e) {
      e.preventDefault();
      window.location.href = gumroadUrl;
    });
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

  backToPreviewBtn && backToPreviewBtn.addEventListener("click", function() {
    window.location.href = "preview.html?bookId=" + encodeURIComponent(bookId);
  });

  backToCoverBtn && backToCoverBtn.addEventListener("click", function() {
    window.location.href = "cover.html?bookId=" + encodeURIComponent(bookId);
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
