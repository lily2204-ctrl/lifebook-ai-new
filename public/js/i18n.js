// public/js/i18n.js — Centralized i18n dictionary and helpers
const I18N = {
  he: {
    // Nav
    navCta: 'צרו ספר עכשיו',
    langToggle: 'English',
    // Wizard
    wizardTitle: 'בואו ניצור את הספר של הילד שלכם',
    wizardSubtitle: 'ספרו לנו קצת על הילד',
    childNameLabel: 'שם הילד/ה',
    childNamePlaceholder: 'למשל: מיה',
    childAgeLabel: 'גיל',
    childGenderLabel: 'מין',
    genderBoy: 'ילד',
    genderGirl: 'ילדה',
    storyIdeaLabel: 'רעיון לסיפור',
    storyPlaceholder: 'למשל: הרפתקה ביער קסום, גיבור אמיץ, מסע שינה בין הכוכבים...',
    illustrationStyleLabel: 'סגנון איור',
    continueBtn: 'המשך',
    uploadPhotoBtn: 'העלו תמונה',
    // Crop
    cropTitle: 'חתכו את התמונה',
    cropSubtitle: 'מרכזו את פני הילד/ה בעיגול',
    cropConfirmBtn: 'אשרו ותמשיכו',
    // Preview / Generate
    previewTitle: 'הספר שלכם נוצר...',
    previewStep1: 'מנתחים את התמונה',
    previewStep2: 'כותבים את הסיפור',
    previewStep3: 'מאיירים את הדפים',
    previewStep4: 'מכינים את הספר',
    previewReady: 'הספר מוכן!',
    previewCta: 'לתשלום ולהורדה — 89 ₪',
    // Checkout
    checkoutTitle: 'סיכום הזמנה',
    checkoutCta: 'לתשלום מאובטח — 89 ₪',
    checkoutPrice: '89 ₪',
    checkoutSecure: 'תשלום מאובטח',
    // Success
    successTitle: 'תודה! ✨',
    successSubtitle: 'הספר שלכם מוכן להורדה',
    successCta: 'פתחו את הספר',
    // Delivery
    deliveryTitle: 'הספר שלכם מוכן',
    deliveryDownloadBtn: 'הורדת הספר (PDF)',
    deliveryReadBtn: 'קריאה מקוונת',
    // Contact
    contactTitle: 'צרו קשר',
    contactEmail: 'lifebooks@lifebooksil.com',
    // General
    footerRights: '© 2025 Lifebook. כל הזכויות שמורות.',
    // Homepage extras
    magicTitle: 'מהתמונה שלכם — לדמות בסיפור קסום',
    magicCta: 'נסו עכשיו — התוצאה תפתיע אתכם',
    // Checkout / order summary dynamic strings
    almostThere: 'עוד רגע וזה שלכם ✨',
    bookReadyPayPrompt: 'הספר שלכם מוכן — נותר רק להשלים את התשלום',
    summaryTitle: 'סיכום הזמנה',
    bookTitleDefault: 'הספר הקסום שלכם',
    coverLoading: 'הכריכה בטעינה...',
    labelChild: 'ילד',
    labelAge: 'גיל',
    labelPages: 'עמודים',
    labelStyle: 'סגנון',
    productName: 'ספר דיגיטלי',
    productDesc: 'קובץ PDF · כל העמודים',
    pdfIncluded: 'PDF כלול',
    allPages: 'כל 12 העמודים',
    deliveryTime: 'מוכן תוך דקות',
    // Validation errors
    errChildName: 'נא להזין את שם הילד/ה',
    errChildAge: 'נא לבחור את גיל הילד/ה',
    errChildGender: 'נא לבחור את מין הילד/ה',
    errStoryIdea: 'נא להוסיף כיוון לסיפור',
    // Status / loading
    statusCreating: 'יוצר את הספר שלכם...',
    statusSaving: 'שומר על השרת...',
    statusStarting: 'מתחיל ביצירה...',
    statusRedirecting: 'מעביר...',
    statusPreparingPhoto: 'מכין תמונה...',
    pageCountSuffix: ' עמודים',
    // Crop page
    chooseAnotherPhoto: 'בחרו תמונה אחרת',
    createMyBook: 'צרו את הספר שלי',
    bestResult: 'לתוצאה הטובה ביותר',
    whatHappensNext: 'מה קורה בשלב הבא?',
    whyThisMatters: 'למה זה חשוב?',
    step2of3: 'שלב 2 מתוך 3',
    cropError: 'אירעה שגיאה — אנא נסו שוב',
    uploadError: 'שגיאת העלאה — אנא נסו שוב',
    // Preview page
    continueToCheckout: 'המשך לתשלום',
    previewFirstPages: 'תצוגה מקדימה — 2 עמודים ראשונים',
    downloadFullPdf: 'הורדת הספר המלא (PDF)',
    pagesIllustrated: 'עמודים מאוירים',
    stillPreparing: 'הספר המלא עדיין בהכנה...',
    pageLabel: 'עמוד',
    backBtn: 'חזרה',
    // Delivery page
    deliverySubtitle: 'קראו את ספר ההרפתקאות האישי שלכם או הורידו PDF',
    labelFormat: 'פורמט',
    digitalPdf: 'PDF דיגיטלי',
    labelStatus: 'סטטוס',
    dlCardTitle: 'הורדת קובץ ה-PDF',
    dlCardDesc: 'איכות גבוהה · מוכן להדפסה · כריכה + כל העמודים',
    flipHint: 'השתמשו בחצים או החליקו כדי לדפדף',
    // Success page
    backToHome: 'חזרה לדף הבית',
  },
  en: {
    navCta: 'Create a Book Now',
    langToggle: 'עברית',
    wizardTitle: "Let's create your child's book",
    wizardSubtitle: 'Tell us about the child',
    childNameLabel: "Child's name",
    childNamePlaceholder: 'e.g. Maya',
    childAgeLabel: 'Age',
    childGenderLabel: 'Gender',
    genderBoy: 'Boy',
    genderGirl: 'Girl',
    storyIdeaLabel: 'Story idea',
    storyPlaceholder: 'e.g. adventure in a magical forest...',
    illustrationStyleLabel: 'Illustration style',
    continueBtn: 'Continue',
    uploadPhotoBtn: 'Upload Photo',
    cropTitle: 'Crop the photo',
    cropSubtitle: 'Center the face in the circle',
    cropConfirmBtn: 'Confirm & Continue',
    previewTitle: 'Creating your book...',
    previewStep1: 'Analyzing the photo',
    previewStep2: 'Writing the story',
    previewStep3: 'Illustrating the pages',
    previewStep4: 'Preparing your book',
    previewReady: 'Book ready!',
    previewCta: 'Checkout — ₪89',
    checkoutTitle: 'Order Summary',
    checkoutCta: 'Secure Checkout — ₪89',
    checkoutPrice: '₪89',
    checkoutSecure: 'Secure Payment',
    successTitle: 'Thank you! ✨',
    successSubtitle: 'Your book is ready to download',
    successCta: 'Open My Book',
    deliveryTitle: 'Your Book is Ready',
    deliveryDownloadBtn: 'Download PDF',
    deliveryReadBtn: 'Read Online',
    contactTitle: 'Contact Us',
    contactEmail: 'lifebooks@lifebooksil.com',
    footerRights: '© 2025 Lifebook. All rights reserved.',
    magicTitle: 'From your photo — to a character in a magical story',
    magicCta: 'Try now — the result will surprise you',
    // Checkout / order summary dynamic strings
    almostThere: 'ALMOST THERE ✨',
    bookReadyPayPrompt: 'Your book is ready — complete your payment to download',
    summaryTitle: 'Order Summary',
    bookTitleDefault: 'Your Magical Book',
    coverLoading: 'Cover loading...',
    labelChild: 'CHILD',
    labelAge: 'AGE',
    labelPages: 'PAGES',
    labelStyle: 'STYLE',
    productName: 'Digital Storybook',
    productDesc: 'PDF download · All pages',
    pdfIncluded: 'PDF included',
    allPages: 'All 12 pages',
    deliveryTime: 'Ready in minutes',
    // Validation errors
    errChildName: "Please enter the child's name.",
    errChildAge: "Please select the child's age.",
    errChildGender: "Please select the child's gender.",
    errStoryIdea: 'Please add a story direction.',
    // Status / loading
    statusCreating: 'Creating your book...',
    statusSaving: 'Saving to server...',
    statusStarting: 'Starting generation...',
    statusRedirecting: 'Redirecting...',
    statusPreparingPhoto: 'Preparing photo...',
    pageCountSuffix: ' pages',
    // Crop page
    chooseAnotherPhoto: 'Choose Another Photo',
    createMyBook: 'Create My Book',
    bestResult: 'Best result',
    whatHappensNext: 'What happens next?',
    whyThisMatters: 'Why this matters',
    step2of3: 'Step 2 of 3',
    cropError: 'An error occurred — please try again',
    uploadError: 'Upload error — please try again',
    // Preview page
    continueToCheckout: 'Continue to Checkout',
    previewFirstPages: 'Preview — First 2 pages',
    downloadFullPdf: 'Download the full book as PDF (all pages)',
    pagesIllustrated: 'pages illustrated',
    stillPreparing: 'Full book is still being prepared...',
    pageLabel: 'PAGE',
    backBtn: 'Back',
    // Delivery page
    deliverySubtitle: 'Read your personalized storybook or download a premium PDF',
    labelFormat: 'Format',
    digitalPdf: 'Digital PDF',
    labelStatus: 'Status',
    dlCardTitle: 'Download your storybook PDF',
    dlCardDesc: 'High quality · Print-ready · Cover + all pages',
    flipHint: 'Use arrow keys or swipe to flip pages',
    // Success page
    backToHome: 'Back to home',
  }
};

function i18nGetLang() {
  return localStorage.getItem('lifebook_lang') || 'he';
}

function i18nSetLang(lang) {
  localStorage.setItem('lifebook_lang', lang);
}

function i18nT(key) {
  const lang = i18nGetLang();
  return (I18N[lang] && I18N[lang][key]) || (I18N['he'][key]) || key;
}

function i18nApply() {
  const lang = i18nGetLang();
  const dict = I18N[lang];
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key] !== undefined) el.textContent = dict[key];
  });
  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key] !== undefined) el.placeholder = dict[key];
  });
  // Update lang toggle button
  const toggleBtn = document.getElementById('langToggleBtn');
  if (toggleBtn) toggleBtn.textContent = dict.langToggle || (lang === 'he' ? 'English' : 'עברית');
  // RTL: apply to content elements only, never html/body/header
  const rtlTargets = document.querySelectorAll('main, section, .card, .page-content, .wizard-content, .checkout-content, .preview-content, .delivery-content');
  rtlTargets.forEach(el => {
    el.dir = lang === 'he' ? 'rtl' : 'ltr';
  });
}

function i18nToggle() {
  const current = i18nGetLang();
  i18nSetLang(current === 'he' ? 'en' : 'he');
  i18nApply();
}

// Auto-apply on DOMContentLoaded
document.addEventListener('DOMContentLoaded', i18nApply);
