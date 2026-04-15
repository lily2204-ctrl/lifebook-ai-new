import { clearBookData, getBookData, updateBookData } from "./js/state.js";

const openPhotoModal   = document.getElementById("openPhotoModal");
const photoModal       = document.getElementById("photoModal");
const closePhotoModal  = document.getElementById("closePhotoModal");
const goToSetupBtn     = document.getElementById("goToSetupBtn");
const cameraInput      = document.getElementById("cameraInput");
const galleryInput     = document.getElementById("galleryInput");

const childNameInput     = document.getElementById("childName");
const childAgeInput      = document.getElementById("childAge");
const childGenderInput   = document.getElementById("childGender");
const storyIdeaInput     = document.getElementById("storyIdea");
const customerEmailInput = document.getElementById("customerEmail");

const styleCards = document.querySelectorAll(".style-card");

function getSelectedStyle() {
  var active = document.querySelector(".style-card.active");
  return (active && active.dataset.style) || "Soft Storybook";
}

function saveSetupData() {
  return updateBookData({
    bookId:            "",
    childName:         (childNameInput     && childNameInput.value.trim())   || "",
    childAge:          (childAgeInput      && childAgeInput.value)           || "",
    childGender:       (childGenderInput   && childGenderInput.value)        || "",
    storyIdea:         (storyIdeaInput     && storyIdeaInput.value.trim())   || "",
    illustrationStyle: getSelectedStyle(),
    customerEmail:     (customerEmailInput && customerEmailInput.value.trim()) || ""
  });
}

function showError(msg) {
  var el = document.getElementById("wizardError");
  if (!el) return;
  el.textContent = "⚠️  " + msg;
  el.style.display = "block";
  setTimeout(function() { el.style.display = "none"; }, 4000);
}

function validateSetupData() {
  var childName   = (childNameInput   && childNameInput.value.trim())   || "";
  var childAge    = (childAgeInput    && childAgeInput.value)           || "";
  var childGender = (childGenderInput && childGenderInput.value)        || "";
  var storyIdea   = (storyIdeaInput   && storyIdeaInput.value.trim())   || "";

  if (!childName)   { showError("Please enter the child's name.");    return false; }
  if (!childAge)    { showError("Please select the child's age.");    return false; }
  if (!childGender) { showError("Please select the child's gender."); return false; }
  if (!storyIdea)   { showError("Please add a story direction.");     return false; }
  return true;
}

function restoreSetupData() {
  var data = getBookData();
  if (data.childName     && childNameInput)     childNameInput.value     = data.childName;
  if (data.childAge      && childAgeInput)      childAgeInput.value      = data.childAge;
  if (data.childGender   && childGenderInput)   childGenderInput.value   = data.childGender;
  if (data.storyIdea     && storyIdeaInput)     storyIdeaInput.value     = data.storyIdea;
  if (data.customerEmail && customerEmailInput) customerEmailInput.value = data.customerEmail;

  var selectedStyle = data.illustrationStyle || "Soft Storybook";
  styleCards.forEach(function(card) {
    card.classList.toggle("active", card.dataset.style === selectedStyle);
  });
}

function bindStyleSelection() {
  styleCards.forEach(function(card) {
    card.addEventListener("click", function() {
      styleCards.forEach(function(c) { c.classList.remove("active"); });
      card.classList.add("active");
      saveSetupData();
    });
  });
}

function openModal() {
  if (photoModal) photoModal.classList.remove("hidden");
}

function closeModal() {
  if (photoModal) photoModal.classList.add("hidden");
}

if (openPhotoModal) {
  openPhotoModal.addEventListener("click", function() {
    saveSetupData();
    openModal();
  });
}

if (closePhotoModal) {
  closePhotoModal.addEventListener("click", closeModal);
}

if (photoModal) {
  photoModal.addEventListener("click", function(e) {
    if (e.target === photoModal) closeModal();
  });
}

// Continue button — validates, then goes to crop if photo exists, else opens modal
if (goToSetupBtn) {
  goToSetupBtn.addEventListener("click", function() {
    if (!validateSetupData()) return;
    saveSetupData();

    var existing = getBookData();
    if (existing.originalPhoto) {
      window.location.href = "crop.html";
      return;
    }
    openModal();
  });
}

function fileToDataURL(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload  = function() { resolve(reader.result); };
    reader.onerror = function() { reject(new Error("Failed to read image file.")); };
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload  = function() { resolve(img); };
    img.onerror = function() { reject(new Error("Failed to load image.")); };
    img.src = src;
  });
}

async function compressImageDataUrl(dataUrl, maxDimension, quality) {
  if (maxDimension === undefined) maxDimension = 1200;
  if (quality === undefined) quality = 0.82;
  var img    = await loadImage(dataUrl);
  var width  = img.width;
  var height = img.height;
  var scale  = Math.min(1, maxDimension / Math.max(width, height));
  width  = Math.round(width  * scale);
  height = Math.round(height * scale);
  var canvas = document.createElement("canvas");
  canvas.width  = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function handleSelectedFile(file) {
  if (!file) return;

  var uploadTitle = openPhotoModal && openPhotoModal.querySelector(".upload-title");
  if (openPhotoModal)  openPhotoModal.style.opacity = "0.6";
  if (uploadTitle)     uploadTitle.textContent       = "Loading...";

  try {
    var rawDataUrl = await fileToDataURL(file);
    var compressed = await compressImageDataUrl(rawDataUrl, 1200, 0.82);

    saveSetupData();

    updateBookData({
      bookId:             "",
      originalPhoto:      compressed,
      croppedPhoto:       "",
      characterReference: null,
      generatedBook:      null,
      purchaseUnlocked:   false
    });

    closeModal();
    setTimeout(function() { window.location.href = "crop.html"; }, 150);

  } catch(error) {
    if (openPhotoModal)  openPhotoModal.style.opacity = "1";
    if (uploadTitle)     uploadTitle.textContent       = "Add photo";
    showError(error.message || "Something went wrong loading the image.");
  }
}

if (cameraInput) {
  cameraInput.addEventListener("change", async function(e) {
    var file = e.target.files && e.target.files[0];
    await handleSelectedFile(file);
    e.target.value = "";
  });
}

if (galleryInput) {
  galleryInput.addEventListener("change", async function(e) {
    var file = e.target.files && e.target.files[0];
    await handleSelectedFile(file);
    e.target.value = "";
  });
}

document.addEventListener("DOMContentLoaded", function() {
  clearBookData();
  restoreSetupData();
  bindStyleSelection();
});
