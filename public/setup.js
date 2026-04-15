import { getBookData, updateBookData } from "./js/state.js";

var data = getBookData();
if (!data.croppedPhoto) { window.location.href = "crop.html"; }

var photo      = document.getElementById("previewCroppedPhoto");
var summary    = document.getElementById("setupSummary");
var backBtns   = [document.getElementById("backToCropBtn"), document.getElementById("backToCropBtn2")];
var continueBtn = document.getElementById("continueToStoryBtn");

if (photo) photo.src = data.croppedPhoto;
if (summary) {
  var rows = [
    ["Child name", data.childName || "-"],
    ["Age",        data.childAge  || "-"],
    ["Gender",     data.childGender || "-"],
    ["Illustration style", data.illustrationStyle || "-"],
    ["Story direction",    data.storyIdea || "-"]
  ];
  summary.innerHTML = rows.map(function(r) {
    return '<div class="summary-row"><span class="summary-label">' + r[0] + '</span><span class="summary-value">' + r[1] + '</span></div>';
  }).join("");
}

backBtns.forEach(function(b) {
  b && b.addEventListener("click", function() { window.location.href = "crop.html"; });
});

// ── Continue: create book record + kick generate-full → go to preview ──────
continueBtn && continueBtn.addEventListener("click", async function() {
  try {
    continueBtn.disabled = true;
    continueBtn.textContent = "Creating your book...";

    // Create book record in DB
    var createRes = await fetch(window.location.origin + "/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childName:         data.childName         || "",
        childAge:          data.childAge          || "",
        childGender:       data.childGender       || "",
        storyIdea:         data.storyIdea         || "",
        illustrationStyle: data.illustrationStyle || "Soft Storybook",
        croppedPhoto:      data.croppedPhoto      || "",
        originalPhoto:     data.originalPhoto     || "",
        customerEmail:     data.customerEmail     || ""
      })
    });

    var createData = await createRes.json();
    var bookId = createData.bookId || "";
    if (!bookId) throw new Error("Failed to create book record");
    updateBookData({ bookId });

    // Kick off full generation in background (server responds immediately)
    fetch(window.location.origin + "/api/books/" + bookId + "/generate-full", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }).catch(function(e) { console.warn("generate-full kick:", e.message); });

    // Go to preview immediately
    window.location.href = "preview.html?bookId=" + encodeURIComponent(bookId);

  } catch(err) {
    console.error("setup continue failed:", err);
    continueBtn.disabled = false;
    continueBtn.textContent = "Create My Book";
    alert("Something went wrong. Please try again.");
  }
});
