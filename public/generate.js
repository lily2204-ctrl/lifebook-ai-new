import { getBookData, updateBookData } from "./js/state.js";

const API_BASE   = window.location.origin;
const wizardData = getBookData();

if (!wizardData.croppedPhoto || !wizardData.childName || !wizardData.storyIdea || !wizardData.illustrationStyle) {
  window.location.href = "wizard.html";
}

const generateBookBtn = document.getElementById("generateBookBtn");
const backToSetupBtn  = document.getElementById("backToSetupBtn");
const backToCropBtn   = document.getElementById("backToCropBtn");
const generateStatus  = document.getElementById("generateStatus");

// Show uploaded photo
const photoPreview = document.getElementById("uploadedPhotoPreview");
const photoHolder  = document.getElementById("photoPlaceholder");
if (photoPreview && wizardData.croppedPhoto) {
  photoPreview.src     = wizardData.croppedPhoto;
  photoPreview.style.display = "block";
  if (photoHolder) photoHolder.style.display = "none";
}

// ── Step helpers ──────────────────────────────────────────────────
const STEPS = ["stepAnalyze","stepStory","stepCover","stepImages","stepDone"];

function setStep(id, state) {
  STEPS.forEach(s => {
    const el = document.getElementById(s);
    if (!el) return;
    el.classList.remove("active","done");
  });
  const target = document.getElementById(id);
  if (target) target.classList.add(state || "active");
  // Mark previous steps done
  const idx = STEPS.indexOf(id);
  for (let i = 0; i < idx; i++) {
    const el = document.getElementById(STEPS[i]);
    if (el) { el.classList.add("done"); el.querySelector(".step-dot").textContent = "✓"; }
  }
}

function setProgress(pct, msg) {
  if (window.setGenProgress) { window.setGenProgress(pct, msg); return; }
  const wrap = document.getElementById("progWrap");
  const fill = document.getElementById("progFill");
  const pctEl = document.getElementById("progPct");
  const stat  = document.getElementById("progStatus");
  if (wrap) wrap.style.display = "block";
  if (fill) fill.style.width   = pct + "%";
  if (pctEl) pctEl.textContent = pct + "%";
  if (stat && msg) stat.textContent = msg;
}

function setStatus(text) {
  if (generateStatus) generateStatus.textContent = text;
}

// ── API helpers ───────────────────────────────────────────────────
async function apiJson(url, options, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res  = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("Non-JSON response from server"); }
    if (!res.ok) throw new Error((json && (json.message || json.details)) || "Request failed");
    return json;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Request timed out — please try again");
    throw err;
  }
}

async function withRetry(fn, retries = 2) {
  for (let i = 1; i <= retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries) throw err;
      setStatus(`Retrying... (${i+1}/${retries})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ── Book record ───────────────────────────────────────────────────
async function createBookRecord() {
  if (wizardData.bookId) return wizardData.bookId;
  const result = await apiJson(API_BASE + "/api/books/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      childName:         wizardData.childName         || "",
      childAge:          wizardData.childAge          || "",
      childGender:       wizardData.childGender       || "",
      storyIdea:         wizardData.storyIdea         || "",
      illustrationStyle: wizardData.illustrationStyle || "Soft Storybook",
      croppedPhoto:      wizardData.croppedPhoto      || "",
      originalPhoto:     wizardData.originalPhoto     || "",
      customerEmail:     wizardData.customerEmail     || ""
    })
  }, 10000);
  updateBookData({ bookId: result.bookId });
  return result.bookId;
}

async function patchBook(bookId, patch) {
  if (!bookId) return;
  await apiJson(API_BASE + "/api/books/" + bookId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  }, 10000);
}

// ── Step 1: Analyze photo ─────────────────────────────────────────
async function analyzePhoto() {
  setStep("stepAnalyze");
  setProgress(8, "Analyzing your child's photo...");
  setStatus("Analyzing photo...");
  // Analysis happens server-side during generate-full; just a brief pause here
  await new Promise(r => setTimeout(r, 1200));
  setProgress(15, "Photo analyzed ✓");
}

// ── Step 2: Generate story text ───────────────────────────────────
async function generateStory(bookId) {
  setStep("stepStory");
  setProgress(18, "Writing the story...");
  setStatus("Writing your child's story...");

  const result = await withRetry(() =>
    apiJson(API_BASE + "/create-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        child_name:         wizardData.childName         || "",
        age:                wizardData.childAge          || "",
        gender:             wizardData.childGender       || "",
        story_type:         wizardData.storyIdea         || "A magical adventure",
        illustration_style: wizardData.illustrationStyle || "Soft Storybook",
        character_reference: {
          characterPromptCore: "A child named " + wizardData.childName + ", age " + wizardData.childAge,
          characterSummary:    wizardData.childName + " is a " + wizardData.childAge + " year old " + (wizardData.childGender || "child")
        }
      })
    }, 30000)
  );

  const generatedBook = {
    title:    result.title    || "",
    subtitle: result.subtitle || "",
    pages:    result.pages    || []
  };
  updateBookData({ generatedBook });
  await patchBook(bookId, { generatedBook });
  setProgress(38, "Story written ✓");
  return result;
}

// ── Step 3: Cover ─────────────────────────────────────────────────
async function generateCover(bookId, storyResult) {
  setStep("stepCover");
  setProgress(42, "Illustrating the cover...");
  setStatus("Creating the book cover...");

  const result = await withRetry(() =>
    apiJson(API_BASE + "/generate-cover-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title:               storyResult.title    || "",
        subtitle:            storyResult.subtitle || "",
        story_type:          wizardData.storyIdea || "",
        illustration_style:  wizardData.illustrationStyle || "Soft Storybook",
        characterPromptCore: "A child named " + wizardData.childName,
        characterSummary:    wizardData.childName + " the hero"
      })
    }, 60000)
  );

  if (result.coverImageBase64) {
    const coverSrc = "data:image/png;base64," + result.coverImageBase64;
    sessionStorage.setItem("coverImage", coverSrc);
    await patchBook(bookId, { coverImage: coverSrc });
  }
  setProgress(62, "Cover ready ✓");
}

// ── Step 4: Page images (fire & forget) ──────────────────────────
async function startPageImages(bookId) {
  setStep("stepImages");
  setProgress(65, "Starting page illustrations...");
  setStatus("Generating 16 illustrations...");

  // Server responds immediately and generates in background
  try {
    await apiJson(API_BASE + "/api/books/" + bookId + "/generate-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, 15000); // short timeout — server replies instantly
  } catch(e) {
    console.warn("generate-images kick-off:", e.message);
    // Non-fatal — generation may still be running on server
  }

  setProgress(88, "Illustrations generating in background...");
}

// ── Step 5: Wrap up ───────────────────────────────────────────────
async function finishUp() {
  setStep("stepDone");
  setProgress(95, "Wrapping up...");
  setStatus("Almost done...");
  await new Promise(r => setTimeout(r, 1000));
}

// ── Main ──────────────────────────────────────────────────────────
if (generateBookBtn) {
  generateBookBtn.addEventListener("click", async function () {
    try {
      generateBookBtn.disabled    = true;
      generateBookBtn.textContent = "Generating...";
      setStatus("Starting...");

      // Start live timer
      if (window.startGenTimer) window.startGenTimer();

      const bookId = await createBookRecord();
      await analyzePhoto();
      const storyResult = await generateStory(bookId);
      await generateCover(bookId, storyResult);
      await startPageImages(bookId);
      await finishUp();

      updateBookData({ purchaseUnlocked: false });
      setProgress(100, "Done! ✓");
      setStatus("Done! Opening preview...");

      setTimeout(() => {
        window.location.href = "preview.html?bookId=" + encodeURIComponent(bookId);
      }, 800);

    } catch (error) {
      console.error("generate.js error:", error);
      setStatus("Error: " + (error.message || "Something went wrong. Please try again."));
      generateBookBtn.disabled    = false;
      generateBookBtn.textContent = "✨ Generate Book";
    }
  });
}

if (backToSetupBtn) backToSetupBtn.addEventListener("click", () => { window.location.href = "wizard.html"; });
if (backToCropBtn)  backToCropBtn.addEventListener("click",  () => { window.location.href = "crop.html"; });
