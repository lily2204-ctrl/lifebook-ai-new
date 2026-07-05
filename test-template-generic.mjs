/**
 * test-template-generic.mjs
 * Verifies the generic buildTemplateStoryPrompt logic against the allergy-hero template.
 * Uses hardcoded DB data — no Supabase call, no OpenAI call, zero cost.
 *
 * Usage: node test-template-generic.mjs
 */

// ── Simulated DB row for allergy-hero (copy the actual values from your DB) ──
// Replace story_skeleton below with the real value if you want a full check.
// The key thing we're testing: does allergyTypeVariant resolve correctly,
// does {{allergyOther}} expand inside the variation text, does genderNote work?

const ALLERGY_HERO_TEMPLATE = {
  variations: {
    allergyType: {
      "בוטנים":      "אלרגיה לבוטנים",
      "חלב":         "אלרגיה לחלב ומוצרי חלב",
      "ביצים":       "אלרגיה לביצים",
      "גלוטן":       "אלרגיה לגלוטן",
      "שומשום":      "אלרגיה לשומשום",
      "עץ":          "אלרגיה לאגוזי עץ",
      "דגים":        "אלרגיה לדגים",
      "פירות ים":    "אלרגיה לפירות ים",
      "אחר":         "אלרגיה ל{{allergyOther}}"
    }
  },
  story_skeleton: `
כתוב ספר ילדים בעברית עבור {{childName}}, בגיל {{childAge}}.
{{genderNote}}
הסיפור עוסק ב{{allergyTypeVariant}} ואיך {{childName}} לומד/ת להתמודד.
תיאור הדמות: {{characterSummary}}
החזר JSON: {"title":"...","subtitle":"...","pages":[{"text":"...","imagePrompt":"..."}]}`
};

// ── Generic logic (copy of the rewritten function, minus the Supabase call) ──
function sanitize(s) { return s; } // stub

function buildPromptGeneric(tmpl, inputs, characterSummary, promptCore) {
  const vals = {};
  for (const [k, v] of Object.entries(inputs || {})) {
    vals[k] = String(v ?? "");
  }

  const variations = tmpl.variations || {};
  for (const [varKey, varMap] of Object.entries(variations)) {
    if (varMap && typeof varMap === "object") {
      const chosen  = vals[varKey] || "";
      let resolved  = varMap[chosen] || chosen || "";
      resolved = resolved.replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k] ?? "");
      vals[varKey + "Variant"] = resolved;
    }
  }

  vals.genderNote       = (inputs.childGender === "ילד")
    ? "הילד הוא בן — השתמש בלשון זכר לאורך כל הסיפור."
    : "הילדה היא בת — השתמש בלשון נקבה לאורך כל הסיפור.";
  vals.characterSummary = sanitize(characterSummary || "");
  vals.promptCore       = sanitize(promptCore       || "");

  return tmpl.story_skeleton.replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k] ?? "");
}

// ── Test cases ────────────────────────────────────────────────────────────────
const cases = [
  {
    label: "ילדה + בוטנים (known allergyType)",
    inputs: { childName: "מיה", childAge: "5", childGender: "ילדה", allergyType: "בוטנים", allergyOther: "" },
    characterSummary: "A 5-year-old girl with curly hair.",
  },
  {
    label: "ילד + אחר (allergyOther sub-replacement)",
    inputs: { childName: "נועם", childAge: "4", childGender: "ילד", allergyType: "אחר", allergyOther: "קיוי" },
    characterSummary: "A 4-year-old boy.",
  },
  {
    label: "ילדה + חלב (another known type)",
    inputs: { childName: "רותם", childAge: "6", childGender: "ילדה", allergyType: "חלב", allergyOther: "" },
    characterSummary: "A 6-year-old girl.",
  },
];

let allPassed = true;
for (const tc of cases) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`TEST: ${tc.label}`);
  const prompt = buildPromptGeneric(ALLERGY_HERO_TEMPLATE, tc.inputs, tc.characterSummary, "");
  console.log(prompt);

  // Assertions
  const errors = [];
  if (prompt.includes("{{")) errors.push("UNFILLED placeholder found!");
  if (tc.inputs.childName && !prompt.includes(tc.inputs.childName)) errors.push("childName missing");
  if (tc.inputs.allergyType === "אחר" && tc.inputs.allergyOther && !prompt.includes(tc.inputs.allergyOther))
    errors.push("allergyOther sub-replacement failed");
  if (tc.inputs.allergyType !== "אחר") {
    const expected = ALLERGY_HERO_TEMPLATE.variations.allergyType[tc.inputs.allergyType];
    if (!prompt.includes(expected)) errors.push(`allergyTypeVariant missing — expected: "${expected}"`);
  }

  if (errors.length) {
    console.error("\n❌ FAILED:", errors.join(", "));
    allPassed = false;
  } else {
    console.log("\n✅ PASSED");
  }
}

console.log(`\n${"═".repeat(60)}`);
console.log(allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED");
