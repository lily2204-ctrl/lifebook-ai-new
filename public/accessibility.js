(function() {
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('lb_a11y') || '{}'); } catch(e) {}

  function applyPrefs() {
    var root = document.documentElement;
    root.style.fontSize = prefs.fontSize ? prefs.fontSize + 'px' : '';
    if (prefs.contrast) root.setAttribute('data-contrast', 'high');
    else root.removeAttribute('data-contrast');
    if (prefs.links) root.setAttribute('data-links', 'highlight');
    else root.removeAttribute('data-links');
  }
  applyPrefs();

  function savePrefs() {
    try { localStorage.setItem('lb_a11y', JSON.stringify(prefs)); } catch(e) {}
    applyPrefs();
  }

  document.addEventListener('DOMContentLoaded', function() {
    var style = document.createElement('style');
    style.textContent = `
      #lb-a11y-btn {
        position:fixed;bottom:24px;left:24px;z-index:9999;
        width:44px;height:44px;border-radius:50%;
        background:#5c3d1e;color:#fff;border:none;font-size:20px;
        cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.25);
        display:flex;align-items:center;justify-content:center;transition:transform 0.2s;
      }
      #lb-a11y-btn:hover{transform:scale(1.08);}
      #lb-a11y-btn:focus{outline:3px solid #e8b84b;outline-offset:2px;}
      #lb-a11y-panel {
        position:fixed;bottom:76px;left:24px;z-index:9999;
        background:#fff;border:1.5px solid #ede0c8;border-radius:16px;
        padding:16px 18px;box-shadow:0 8px 32px rgba(100,60,20,0.18);
        min-width:210px;display:none;flex-direction:column;gap:12px;
        font-family:'Lato',sans-serif;
      }
      #lb-a11y-panel.open{display:flex;}
      .a11y-title{font-size:12px;font-weight:700;color:#c8922a;text-transform:uppercase;letter-spacing:0.8px;}
      .a11y-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
      .a11y-label{font-size:14px;color:#3a2810;}
      .a11y-toggle{width:40px;height:22px;border-radius:11px;background:#ede0c8;border:none;cursor:pointer;position:relative;transition:background 0.2s;flex-shrink:0;}
      .a11y-toggle.on{background:#c8922a;}
      .a11y-toggle::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.2s;}
      .a11y-toggle.on::after{left:21px;}
      .a11y-toggle:focus{outline:2px solid #e8b84b;}
      .a11y-font-row{display:flex;align-items:center;gap:8px;}
      .a11y-font-btn{width:32px;height:32px;border-radius:8px;border:1.5px solid #ede0c8;background:#fdf6ec;cursor:pointer;font-weight:700;color:#5c3d1e;display:flex;align-items:center;justify-content:center;font-family:'Lato',sans-serif;}
      .a11y-font-btn:hover{border-color:#c8922a;}
      .a11y-font-btn:focus{outline:2px solid #e8b84b;}
      .a11y-font-size{font-size:13px;color:#7a6048;min-width:32px;text-align:center;}
      .a11y-reset{font-size:12px;color:#c8922a;background:none;border:none;cursor:pointer;text-decoration:underline;text-align:right;font-family:'Lato',sans-serif;padding:0;}
      [data-contrast="high"] body{background:#fff!important;color:#000!important;}
      [data-contrast="high"] nav{background:#fff!important;border-bottom:2px solid #000!important;}
      [data-contrast="high"] .btn-primary{background:#000!important;color:#fff!important;}
      [data-links="highlight"] a{text-decoration:underline!important;text-decoration-thickness:2px!important;}
    `;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'lb-a11y-btn';
    btn.setAttribute('aria-label', 'תפריט נגישות');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'lb-a11y-panel');
    btn.textContent = '♿';
    document.body.appendChild(btn);

    var panel = document.createElement('div');
    panel.id = 'lb-a11y-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'אפשרויות נגישות');
    var baseSize = prefs.fontSize || 16;
    panel.innerHTML =
      '<div class="a11y-title">נגישות</div>' +
      '<div class="a11y-row"><span class="a11y-label">ניגודיות גבוהה</span>' +
      '<button class="a11y-toggle ' + (prefs.contrast ? 'on' : '') + '" id="a11y-contrast" aria-pressed="' + (!!prefs.contrast) + '" aria-label="ניגודיות גבוהה"></button></div>' +
      '<div class="a11y-row"><span class="a11y-label">הדגש קישורים</span>' +
      '<button class="a11y-toggle ' + (prefs.links ? 'on' : '') + '" id="a11y-links" aria-pressed="' + (!!prefs.links) + '" aria-label="הדגש קישורים"></button></div>' +
      '<div><div class="a11y-label" style="margin-bottom:6px">גודל טקסט</div>' +
      '<div class="a11y-font-row">' +
      '<button class="a11y-font-btn" id="a11y-font-down" aria-label="הקטן טקסט" style="font-size:13px">A-</button>' +
      '<span class="a11y-font-size" id="a11y-font-val">' + baseSize + 'px</span>' +
      '<button class="a11y-font-btn" id="a11y-font-up" aria-label="הגדל טקסט" style="font-size:15px">A+</button>' +
      '</div></div>' +
      '<button class="a11y-reset" id="a11y-reset">איפוס הגדרות</button>';
    document.body.appendChild(panel);

    btn.addEventListener('click', function() {
      var isOpen = panel.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', function(e) {
      if (!panel.contains(e.target) && e.target !== btn) {
        panel.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panel.classList.contains('open')) {
        panel.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      }
    });

    document.getElementById('a11y-contrast').addEventListener('click', function() {
      prefs.contrast = !prefs.contrast;
      this.classList.toggle('on', prefs.contrast);
      this.setAttribute('aria-pressed', String(prefs.contrast));
      savePrefs();
    });
    document.getElementById('a11y-links').addEventListener('click', function() {
      prefs.links = !prefs.links;
      this.classList.toggle('on', prefs.links);
      this.setAttribute('aria-pressed', String(prefs.links));
      savePrefs();
    });
    document.getElementById('a11y-font-up').addEventListener('click', function() {
      baseSize = Math.min(baseSize + 2, 24);
      prefs.fontSize = baseSize;
      document.getElementById('a11y-font-val').textContent = baseSize + 'px';
      savePrefs();
    });
    document.getElementById('a11y-font-down').addEventListener('click', function() {
      baseSize = Math.max(baseSize - 2, 12);
      prefs.fontSize = baseSize;
      document.getElementById('a11y-font-val').textContent = baseSize + 'px';
      savePrefs();
    });
    document.getElementById('a11y-reset').addEventListener('click', function() {
      prefs = {}; baseSize = 16;
      document.getElementById('a11y-font-val').textContent = '16px';
      document.getElementById('a11y-contrast').classList.remove('on');
      document.getElementById('a11y-contrast').setAttribute('aria-pressed', 'false');
      document.getElementById('a11y-links').classList.remove('on');
      document.getElementById('a11y-links').setAttribute('aria-pressed', 'false');
      savePrefs();
    });
  });
})();
