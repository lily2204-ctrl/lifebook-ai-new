import { getBookData, updateBookData } from "./js/state.js";

const cropCanvas   = document.getElementById("cropCanvas");
const cropCtx      = cropCanvas.getContext("2d");
const zoomSlider   = document.getElementById("zoomSlider");
const zoomValueEl  = document.getElementById("zoomValue");
const continueBtn  = document.getElementById("continueAfterCrop");
const resetBtn     = document.getElementById("resetCropBtn");
const backBtn      = document.getElementById("backToWizard");
const chooseNewBtn = document.getElementById("chooseNewPhotoBtn");
const statusWrap   = document.getElementById("cropStatusWrap");
const statusText   = document.getElementById("cropStatusText");
const progressBar  = document.getElementById("cropProgressBar");

const bookData      = getBookData();
const uploadedPhoto = bookData.originalPhoto;

const sourceImage = new Image();
let scale = 1, offsetX = 0, offsetY = 0;
let isDragging = false, startDragX = 0, startDragY = 0;

if (!uploadedPhoto) { window.location.href = "wizard.html"; }

sourceImage.src = uploadedPhoto;
sourceImage.onload = function() { fitImageInitially(); drawCanvas(); };

function fitImageInitially() {
  var cw = cropCanvas.width, ch = cropCanvas.height;
  var ir = sourceImage.width / sourceImage.height;
  scale  = ir > cw/ch ? ch / sourceImage.height : cw / sourceImage.width;
  scale  = Math.max(scale, 0.9);
  zoomSlider.value = String(scale);
  zoomValueEl.textContent = Math.round(scale * 100) + "%";
  offsetX = 0; offsetY = 0;
}

function drawCanvas() {
  cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
  var iw = sourceImage.width * scale, ih = sourceImage.height * scale;
  var cx = (cropCanvas.width  - iw) / 2 + offsetX;
  var cy = (cropCanvas.height - ih) / 2 + offsetY;
  cropCtx.drawImage(sourceImage, cx, cy, iw, ih);
}

zoomSlider.addEventListener("input", function(e) {
  scale = parseFloat(e.target.value);
  zoomValueEl.textContent = Math.round(scale * 100) + "%";
  drawCanvas();
});

resetBtn.addEventListener("click", function() { fitImageInitially(); drawCanvas(); });

// Mouse drag
cropCanvas.addEventListener("mousedown",  function(e) { isDragging = true; startDragX = e.offsetX; startDragY = e.offsetY; });
cropCanvas.addEventListener("mousemove",  function(e) { if (!isDragging) return; offsetX += e.offsetX - startDragX; offsetY += e.offsetY - startDragY; startDragX = e.offsetX; startDragY = e.offsetY; drawCanvas(); });
cropCanvas.addEventListener("mouseup",    function() { isDragging = false; });
cropCanvas.addEventListener("mouseleave", function() { isDragging = false; });

// Touch drag
cropCanvas.addEventListener("touchstart", function(e) { var r = cropCanvas.getBoundingClientRect(), t = e.touches[0]; isDragging = true; startDragX = t.clientX - r.left; startDragY = t.clientY - r.top; }, { passive: true });
cropCanvas.addEventListener("touchmove",  function(e) { if (!isDragging) return; e.preventDefault(); var r = cropCanvas.getBoundingClientRect(), t = e.touches[0]; var x = t.clientX - r.left, y = t.clientY - r.top; offsetX += x - startDragX; offsetY += y - startDragY; startDragX = x; startDragY = y; drawCanvas(); }, { passive: false });
cropCanvas.addEventListener("touchend",   function() { isDragging = false; });

// ── Status helpers ────────────────────────────────────────────────────────────
function setStatus(msg, pct) {
  if (statusWrap) statusWrap.classList.add("visible");
  if (statusText) { statusText.style.color = "#f0c46d"; statusText.textContent = msg; }
  if (progressBar) progressBar.style.width = (pct || 0) + "%";
}

function showError(msg) {
  if (statusWrap) statusWrap.classList.add("visible");
  if (statusText) { statusText.style.color = "#ff7070"; statusText.textContent = "⚠ " + msg; }
  if (progressBar) { progressBar.style.background = "#e05555"; progressBar.style.width = "100%"; }
}

// ── Continue ──────────────────────────────────────────────────────────────────
continueBtn.addEventListener("click", async function() {
  try {
    continueBtn.disabled = true;
    continueBtn.textContent = i18nT("statusCreating");
    setStatus(i18nT("statusPreparingPhoto"), 15);

    // Export the cropped circle to a 768×768 JPEG
    var exportCanvas = document.createElement("canvas");
    exportCanvas.width = exportCanvas.height = 768;
    var ec  = exportCanvas.getContext("2d");
    var iw  = sourceImage.width  * scale, ih = sourceImage.height * scale;
    var cx  = (cropCanvas.width  - iw) / 2 + offsetX;
    var cy  = (cropCanvas.height - ih) / 2 + offsetY;
    var rat = exportCanvas.width / cropCanvas.width;
    ec.save(); ec.beginPath(); ec.arc(384, 384, 320, 0, Math.PI * 2); ec.closePath(); ec.clip();
    ec.drawImage(sourceImage, cx * rat, cy * rat, iw * rat, ih * rat);
    ec.restore();

    var croppedPhoto = exportCanvas.toDataURL("image/jpeg", 0.9);
    updateBookData({ croppedPhoto });

    setStatus(i18nT("statusSaving"), 40);

    var data = getBookData();
    var createRes = await fetch(window.location.origin + "/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childName:          data.childName          || "",
        childAge:           data.childAge           || "",
        childGender:        data.childGender        || "",
        storyIdea:          data.storyIdea          || "",
        illustrationStyle:  data.illustrationStyle  || "Soft Storybook",
        croppedPhoto:       croppedPhoto,
        originalPhoto:      data.originalPhoto      || "",
        customerEmail:      data.customerEmail      || "",
        language:           (typeof i18nGetLang === "function" ? i18nGetLang() : "he")
      })
    });

    if (!createRes.ok) {
      var errText = "";
      try { var errData = await createRes.json(); errText = errData.message || ""; } catch(e) {}
      throw new Error(i18nT("uploadError") + " (" + createRes.status + (errText ? ": " + errText : "") + ")");
    }

    var createData = await createRes.json();
    var bookId = createData.bookId || "";
    updateBookData({ bookId });

    if (!bookId) {
      throw new Error("No bookId returned from server. Please try again.");
    }

    // Analytics: photo uploaded successfully
    if (typeof gtag === 'function') gtag('event', 'photo_uploaded');
    if (typeof ttq !== 'undefined') ttq.track('AddToWishlist', { content_name: 'photo_uploaded' });

    setStatus(i18nT("statusStarting"), 75);

    // Fire generate-full in background — don't await
    fetch(window.location.origin + "/api/books/" + bookId + "/generate-full", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }).catch(function(e) { console.warn("generate-full kick:", e.message); });

    // Analytics: book generation started
    if (typeof gtag === 'function') gtag('event', 'book_generation_started');
    if (typeof ttq !== 'undefined') ttq.track('SubmitForm', { content_name: 'book_generation_started' });

    setStatus(i18nT("statusRedirecting"), 95);

    // Small delay so the status is visible before navigation
    await new Promise(function(r) { setTimeout(r, 300); });

    window.location.href = "preview.html?bookId=" + encodeURIComponent(bookId);

  } catch(err) {
    console.error("crop continue failed:", err);
    continueBtn.disabled = false;
    continueBtn.textContent = i18nT("createMyBook");
    showError(err.message || i18nT("cropError"));
  }
});

backBtn      && backBtn.addEventListener("click",      function() { window.location.href = "wizard.html"; });
chooseNewBtn && chooseNewBtn.addEventListener("click",  function() { window.location.href = "wizard.html"; });
