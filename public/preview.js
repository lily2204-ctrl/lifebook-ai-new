var API_BASE = window.location.origin;

function getBookId() {
  return new URLSearchParams(window.location.search).get("bookId");
}

var bookId = getBookId();

if (!bookId) {
  window.location.href = "wizard.html";
}

// DOM refs
var loadingScreen    = document.getElementById("loadingScreen");
var mainLayout       = document.getElementById("mainLayout");
var loadingStatus    = document.getElementById("loadingStatus");
var loadingBar       = document.getElementById("loadingProgressBar");
var loadingChildName = document.getElementById("loadingChildName");
var coverImage       = document.getElementById("coverImage");
var coverPlaceholder = document.getElementById("coverPlaceholder");
var bookTitleEl      = document.getElementById("bookTitle");
var bookSubtitleEl   = document.getElementById("bookSubtitle");
var pagesWrap        = document.getElementById("pagesWrap");
var payBtn           = document.getElementById("payBtn");
var stillGenerating  = document.getElementById("stillGenerating");

var lstep1 = document.getElementById("lstep1");
var lstep2 = document.getElementById("lstep2");
var lstep3 = document.getElementById("lstep3");
var lstep4 = document.getElementById("lstep4");

// Show child name in loading if available
var bgTitle = sessionStorage.getItem("bg_title");
var storedName = (sessionStorage.getItem("bg_childName") || "");
if (loadingChildName && storedName) loadingChildName.textContent = storedName;

function setLoadingStep(stepNum, statusText, progress) {
  var steps = [lstep1, lstep2, lstep3, lstep4];
  steps.forEach(function(s, i) {
    if (!s) return;
    s.classList.remove("active", "done");
    if (i + 1 < stepNum) s.classList.add("done");
    else if (i + 1 === stepNum) s.classList.add("active");
  });
  if (loadingStatus) loadingStatus.textContent = statusText;
  if (loadingBar) loadingBar.style.width = progress + "%";
}

function showPreview() {
  if (loadingScreen) loadingScreen.style.display = "none";
  if (mainLayout) { mainLayout.style.display = "grid"; mainLayout.classList.add("visible"); }
}

function createPageCard(page, index, imageSrc) {
  var card = document.createElement("div");
  card.className = "page-card";
  card.id = "page-card-" + index;

  var imgHtml = imageSrc
    ? '<img src="' + imageSrc + '" alt="Page ' + (index+1) + '"/>'
    : '<div class="page-img-loading"><div class="page-img-spinner"></div><span>Illustrating page ' + (index+1) + '...</span></div>';

  card.innerHTML =
    '<div class="page-num">Page ' + (index+1) + '</div>' +
    '<div class="page-img-wrap" id="page-img-' + index + '">' + imgHtml + '</div>' +
    '<div class="page-text">' + (page.text || "") + '</div>';

  return card;
}

function updatePageImage(index, src) {
  var wrap = document.getElementById("page-img-" + index);
  if (!wrap) return;
  wrap.innerHTML = '<img src="' + src + '" alt="Page ' + (index+1) + '"/>';
}

// Pay button
payBtn && payBtn.addEventListener("click", function() {
  window.location.href = "checkout.html?bookId=" + encodeURIComponent(bookId);
});

// --- Main polling loop ---------------------------------------------------------
async function pollForBook() {
  var maxWait    = 180;  // 3 minutes max
  var pollEvery  = 3;    // seconds
  var elapsed    = 0;
  var previewShown = false;

  setLoadingStep(1, "Analyzing photo and building character...", 10);

  while (elapsed < maxWait) {
    await new Promise(function(r) { setTimeout(r, pollEvery * 1000); });
    elapsed += pollEvery;

    try {
      var res  = await fetch(API_BASE + "/api/books/" + bookId);
      var data = await res.json();

      if (!res.ok || !data.book) continue;
      var book = data.book;

      // Update loading steps based on what's ready
      var hasCharRef     = !!(book.characterReference && book.characterReference.characterPromptCore);
      var hasStory       = !!(book.generatedBook && book.generatedBook.pages && book.generatedBook.pages.length > 0);
      var hasImages      = !!(book.fullImages && book.fullImages.filter(Boolean).length >= 1);
      var hasCover       = !!book.coverImage;
      var hasTwoImages   = !!(book.fullImages && book.fullImages.filter(Boolean).length >= 2);

      if (!hasCharRef) {
        setLoadingStep(1, "Analyzing photo and building character...", 15);
      } else if (!hasStory) {
        setLoadingStep(2, "Writing " + (book.childName || "your child") + "'s story...", 35);
        if (loadingChildName && book.childName) loadingChildName.textContent = book.childName;
      } else if (!hasImages) {
        setLoadingStep(3, "Illustrating the first pages...", 55);
      } else if (!hasCover) {
        setLoadingStep(4, "Creating the cover...", 75);
      } else {
        setLoadingStep(4, "Almost ready...", 90);
      }

      // Show preview as soon as we have story + at least 1 image (cover or page)
      if (!previewShown && hasStory && (hasImages || hasCover)) {
        previewShown = true;
        renderPreview(book);
        showPreview();
      }

      // If preview is shown, update images as they arrive
      if (previewShown) {
        updateLiveImages(book);
      }

      // If cover + 2 page images ready, we're done polling
      if (hasCover && hasTwoImages) {
        setLoadingStep(4, "Ready!", 100);

        // Check if full book still being generated
        var totalPages = book.generatedBook && book.generatedBook.pages ? book.generatedBook.pages.length : 0;
        var readyImages = book.fullImages ? book.fullImages.filter(Boolean).length : 0;
        if (readyImages < totalPages && stillGenerating) {
          stillGenerating.style.display = "flex";
        }
        break;
      }

    } catch(err) {
      console.warn("Poll error:", err.message);
    }
  }

  // Fallback: if we never showed preview, try to show whatever we have
  if (!previewShown) {
    try {
      var res  = await fetch(API_BASE + "/api/books/" + bookId);
      var data = await res.json();
      if (data.book) { renderPreview(data.book); showPreview(); }
    } catch(e) {
      // Show error state
      if (loadingStatus) loadingStatus.textContent = "Taking longer than expected. Please refresh.";
    }
  }
}

function renderPreview(book) {
  // Title + subtitle
  var title = (book.generatedBook && book.generatedBook.title) || "Your Magical Adventure";
  var sub   = (book.generatedBook && book.generatedBook.subtitle) || "";
  if (bookTitleEl)   bookTitleEl.textContent   = title;
  if (bookSubtitleEl) bookSubtitleEl.textContent = sub;

  // Cover
  if (book.coverImage && coverImage) {
    coverImage.src = book.coverImage;
  }

  // First 2 pages
  var pages      = (book.generatedBook && book.generatedBook.pages) || [];
  var fullImages = book.fullImages || [];
  var previewPages = pages.slice(0, 2);

  if (pagesWrap) pagesWrap.innerHTML = "";

  previewPages.forEach(function(page, i) {
    var imgSrc = fullImages[i] || null;
    var card = createPageCard(page, i, imgSrc);
    if (pagesWrap) pagesWrap.appendChild(card);
  });
}

function updateLiveImages(book) {
  var fullImages = book.fullImages || [];

  // Update cover
  if (book.coverImage && coverImage && !coverImage.src) {
    coverImage.src = book.coverImage;
  }

  // Update page images 0 and 1
  for (var i = 0; i < 2; i++) {
    if (fullImages[i]) {
      var wrap = document.getElementById("page-img-" + i);
      if (wrap && !wrap.querySelector("img")) {
        updatePageImage(i, fullImages[i]);
      }
    }
  }
}

// Start polling
pollForBook();
