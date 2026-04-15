import { clearBookData, getBookData } from "./js/state.js";

const data = getBookData();

if (!data.generatedBook || !Array.isArray(data.generatedBook.pages) || data.generatedBook.pages.length === 0) {
  window.location.href = "generate.html";
}

const generatedBook = data.generatedBook;
const coverImage = sessionStorage.getItem("coverImage") || "";
const bookId = data.bookId || "";

const coverTitle = document.getElementById("coverTitle");
const coverSubtitle = document.getElementById("coverSubtitle");
const coverFillImage = document.getElementById("coverFillImage");

const metaChildName = document.getElementById("metaChildName");
const metaAge = document.getElementById("metaAge");
const metaStyle = document.getElementById("metaStyle");
const metaStory = document.getElementById("metaStory");
const metaPages = document.getElementById("metaPages");

const backToGenerateBtn = document.getElementById("backToGenerateBtn");
const continueToPreviewBtn = document.getElementById("continueToPreviewBtn");
const restartBookBtn = document.getElementById("restartBookBtn");

const brandLogoTop = document.getElementById("brandLogoTop");
const brandLogoMini = document.getElementById("brandLogoMini");

function hideBrokenLogo(img) {
  if (!img) return;
  img.addEventListener("error", () => {
    img.style.display = "none";
  });
}

hideBrokenLogo(brandLogoTop);
hideBrokenLogo(brandLogoMini);

if (coverTitle) {
  coverTitle.textContent = generatedBook.title || "Your Magical Adventure";
}

if (coverSubtitle) {
  coverSubtitle.textContent = generatedBook.subtitle || "A story where you are the hero";
}

if (coverFillImage) {
  if (coverImage) {
    coverFillImage.src = coverImage;
  } else if (data.croppedPhoto) {
    coverFillImage.src = data.croppedPhoto;
  } else if (data.originalPhoto) {
    coverFillImage.src = data.originalPhoto;
  } else {
    coverFillImage.style.display = "none";
  }
}

if (metaChildName) {
  metaChildName.textContent = data.childName || "-";
}

if (metaAge) {
  metaAge.textContent = data.childAge || "-";
}

if (metaStyle) {
  metaStyle.textContent = data.illustrationStyle || "-";
}

if (metaStory) {
  metaStory.textContent = data.storyIdea || "-";
}

if (metaPages) {
  metaPages.textContent = String(generatedBook.pages?.length || 0);
}

backToGenerateBtn?.addEventListener("click", () => {
  window.location.href = "generate.html";
});

continueToPreviewBtn?.addEventListener("click", () => {
  if (!bookId) {
    alert("Missing book ID. Please generate the book again.");
    return;
  }

  window.location.href = `preview.html?bookId=${encodeURIComponent(bookId)}`;
});

restartBookBtn?.addEventListener("click", () => {
  sessionStorage.removeItem("characterSheetImage");
  sessionStorage.removeItem("coverImage");
  clearBookData();
  window.location.href = "wizard.html";
});
