import { getBookData, updateBookData } from "./js/state.js";

const cropCanvas   = document.getElementById("cropCanvas");
const cropCtx      = cropCanvas.getContext("2d");
const zoomSlider   = document.getElementById("zoomSlider");
const zoomValueEl  = document.getElementById("zoomValue");
const continueBtn  = document.getElementById("continueAfterCrop");
const resetBtn     = document.getElementById("resetCropBtn");
const backBtn      = document.getElementById("backToWizard");
const chooseNewBtn = document.getElementById("chooseNewPhotoBtn");

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

// ── Continue ──────────────────────────────────────────────────────────────────
continueBtn.addEventListener("click", async function() {
  try {
    continueBtn.disabled = true;
    continueBtn.textContent = "Creating your book...";

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
        customerEmail:      data.customerEmail      || ""
      })
    });
    var createData = await createRes.json();
    var bookId = createData.bookId || "";
    updateBookData({ bookId });

    if (bookId) {
      fetch(window.location.origin + "/api/books/" + bookId + "/generate-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }).catch(function(e) { console.warn("generate-full kick:", e.message); });
    }

    window.location.href = "preview.html?bookId=" + encodeURIComponent(bookId);

  } catch(err) {
    console.error("crop continue failed:", err);
    continueBtn.disabled = false;
    continueBtn.textContent = "✓ Create My Book";
    alert("Something went wrong. Please try again.");
  }
});

backBtn      && backBtn.addEventListener("click",      function() { window.location.href = "wizard.html"; });
chooseNewBtn && chooseNewBtn.addEventListener("click",  function() { window.location.href = "wizard.html"; });
