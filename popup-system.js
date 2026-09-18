(function () {
  'use strict';

  var MIN_W = 240, MIN_H = 200;
  var PANEL_BUDGET = 6; 
  var VERSION_KEY = 'pb-version';

  // system default until the visitor explicitly overrides it

  function systemPrefersDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (err) { return false; }
  }

  function storedVersion() {
    try {
      var v = localStorage.getItem(VERSION_KEY);
      return (v === 'a' || v === 'b') ? v : null; // no explicit choice yet
    } catch (err) { return null; } 
  }

  var VERSION_EXPLICIT = storedVersion() !== null;
  var CURRENT_VERSION = storedVersion() || (systemPrefersDark() ? 'b' : 'a');


  // Versions switching <meta name="title-a/b">
  function applyVersion(doc, isContentFrame) {
    if (!doc || !doc.documentElement) return;
    doc.documentElement.setAttribute('data-v', CURRENT_VERSION);
    if (isContentFrame) {
      var meta = doc.querySelector('meta[name="title-' + CURRENT_VERSION + '"]');
      if (meta) doc.title = meta.content;
      refreshOpenNotes(doc); 
    }
  }

  // A highlight note 
  function refreshOpenNotes(doc) {
    var opens = Array.prototype.slice.call(doc.querySelectorAll('.expand.open'));
    opens.filter(function (t) { return !t.closest('.inline-box'); })
         .forEach(refreshOneNote);
  }

  function refreshOneNote(trigger) {
    var box = trigger._box;
    if (!box) return;
    var body = box.querySelector('.inline-body');
    if (!body) return;

    var openIdx = [];
    Array.prototype.forEach.call(body.querySelectorAll('.expand'), function (el, i) {
      if (el.classList.contains('open')) openIdx.push(i);
    });

    noteContent(trigger, function (html) {
      body.innerHTML = html;
      var fresh = body.querySelectorAll('.expand');
      openIdx.forEach(function (i) { if (fresh[i]) fresh[i].click(); });
    });
  }

  // Active buttons toggle
  
  function refreshToggleButtons() {
    var currentView = currentFlowView();
    document.querySelectorAll('[data-set-version], [data-set-view]').forEach(function (btn) {
      var wantVersion = btn.getAttribute('data-set-version');
      var wantView = btn.getAttribute('data-set-view');
      var on = (wantVersion === null || wantVersion === CURRENT_VERSION) &&
               (wantView === null || wantView === currentView);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Flow views for Glossary and Reference: diff from toggle

  function currentFlowView() {
    var wrap = document.querySelector('.flow-views');
    return wrap ? wrap.getAttribute('data-current-view') || 'main' : 'main';
  }

  function setFlowView(view) {
    var wrap = document.querySelector('.flow-views');
    if (!wrap) return;
    wrap.setAttribute('data-current-view', view);
    refreshToggleButtons();
  }


  function refreshAllSurfaces() {
    applyVersion(document, false);
    refreshToggleButtons();

    document.querySelectorAll('.cluster').forEach(function (cluster) {
      cluster.querySelectorAll('.panel').forEach(function (panel) {
        var frame = panel.querySelector('iframe');
        if (!frame) return;
        var doc;
        try { doc = frame.contentDocument; } catch (err) { doc = null; }
        if (!doc) return;
        applyVersion(doc, true);
        if (panel._isRoot) {
          var bar = cluster.querySelector('.popup-title');
          if (bar) bar.textContent = doc.title || bar.textContent;
        }
      });
    });
  }

  // Only from an explicit toggle click 
  function setVersion(v) {
    if (v !== 'a' && v !== 'b') return;
    CURRENT_VERSION = v;
    VERSION_EXPLICIT = true;
    try { localStorage.setItem(VERSION_KEY, v); } catch (err) { /* best-effort */ }
    refreshAllSurfaces();
  }


  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (VERSION_EXPLICIT) return; // an explicit choice always wins over the system
      CURRENT_VERSION = e.matches ? 'b' : 'a';
      refreshAllSurfaces();
    });
  } catch (err) { /* matchMedia/addEventListener unsupported — initial system default still applies */ }

  // A .ctx link's fallback title 
  function linkLabel(link) {
    var active = link.querySelector('[data-v="' + CURRENT_VERSION + '"]');
    return (active ? active.textContent : link.textContent).trim();
  }

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function textSize() { return { w: Math.round(rand(300, 470)), h: Math.round(rand(250, 430)) }; }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function fitToScreen(w, h) {
    var maxW = Math.min(window.innerWidth * 0.55, 860);
    var maxH = Math.min(window.innerHeight * 0.78, 780);
    var s = Math.min(1, maxW / w, maxH / h);
    return { w: Math.round(w * s), h: Math.round(h * s) };
  }

  // Panel size
  //   1. <meta name="popup-size" content="www x hhh">
  //   2. image only: fit the image's natural size
  //   3. otherwise: a random text size
  function measurePage(frame) {
    var doc;
    try { doc = frame.contentDocument; } catch (err) { return textSize(); } // cross-origin
    if (!doc) return textSize();

    var meta = doc.querySelector('meta[name="popup-size"]');
    if (meta) {
      var parts = meta.content.split(/[x×,\s]+/).map(Number);
      if (parts[0] && parts[1]) return fitToScreen(parts[0], parts[1]);
    }
    var imgs = doc.images;
    if (imgs.length === 1 && imgs[0].naturalWidth) {
      return fitToScreen(imgs[0].naturalWidth, imgs[0].naturalHeight);
    }
    return textSize();
  }

  function readNextLinks(frame) {
    var doc;
    try { doc = frame.contentDocument; } catch (err) { return { right: null, down: null, up: null, left: null }; }
    if (!doc || !doc.head) return { right: null, down: null, up: null, left: null };
    var r = doc.head.querySelector('link[rel="next-right"]');
    var d = doc.head.querySelector('link[rel="next-down"]');
    var u = doc.head.querySelector('link[rel="next-up"]');
    var l = doc.head.querySelector('link[rel="next-left"]');
    // .href (resolved), not getAttribute — a relative path must resolve
    // against the iframe's own document, not the top page's.
    return { right: r ? r.href : null, down: d ? d.href : null, up: u ? u.href : null, left: l ? l.href : null };
  }

  function resolveTitle(frame, fallback, onTitle) {
    var t;
    try { t = frame.contentDocument && frame.contentDocument.title; } catch (err) { t = null; }
    onTitle(t || fallback);
  }

  // ---------- inline highlight notes ("expanders") ----------

  var EXPAND_CSS =
    '.expand { border: 1px solid currentColor; padding: 0 .2em; cursor: pointer; white-space: nowrap; }' +
    '.expand:hover { background: #f0f0f0; }' +
    '.expand.open { background: #111; color: #fff; }' +
    '.pop { border: 1px solid currentColor; padding: 0 .2em; cursor: pointer; white-space: nowrap; }' +
    '.pop:hover { background: #f0f0f0; }' +
    '.inline-box { float: right; display: block; width: 58%; min-width: 10rem; margin: .3rem 0 .55rem 1rem; padding: .55rem .75rem .6rem; border: 1px solid #111; background: #fff; position: relative; font-size: .95em; }' +
    '.inline-box.left { float: left; margin: .3rem 1rem .55rem 0; }' +
    '.inline-body { display: block; padding-right: 1.1rem; }' +
    '.inline-body .para { display: block; margin-bottom: .5rem; }' +
    '.inline-body .para:last-child { margin-bottom: 0; }' +
    '.inline-close { position: absolute; top: .2rem; right: .35rem; border: 0; background: none; font: inherit; line-height: 1; cursor: pointer; opacity: .7; }' +
    '.inline-close:hover { opacity: 1; }';

  // popup-system.css on the landing in case shit happens
  var VERSION_CSS =
    'html [data-v] { display: none; }' + // descendant combinator, not bare [data-v] — see popup-system.css
    'html[data-v="a"] [data-v="a"] { display: revert; }' +
    'html[data-v="b"] [data-v="b"] { display: revert; }';

  // Minimal link styling for a .ctx a found inside loaded content
  var CTX_CSS =
    '.ctx a { color: inherit; text-decoration: underline dotted; text-underline-offset: 3px; cursor: pointer; }' +
    '.ctx a:hover { text-decoration-style: solid; }';

  function closeNote(box) {
    if (!box) return;
    if (box._trigger) { box._trigger.classList.remove('open'); box._trigger._box = null; }
    box.remove();
  }

  // Content for a note: in case
  function noteContent(trigger, done) {
    var versioned = trigger.dataset['note' + (CURRENT_VERSION === 'b' ? 'B' : 'A')];
    if (versioned) {
      done('<span class="para">' + versioned + '</span>');
      return;
    }
    if (trigger.dataset.note) {
      done('<span class="para">' + trigger.dataset.note + '</span>');
      return;
    }

    var href = trigger.dataset['href' + (CURRENT_VERSION === 'b' ? 'B' : 'A')] || trigger.dataset.href;
    if (href) {

      var resolved = new URL(href, trigger.baseURI).href;
      fetch(resolved)
        .then(function (res) { return res.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          done(doc.body ? doc.body.innerHTML : '<span class="para">(empty)</span>');
        })
        .catch(function () { done('<span class="para">Could not load this note.</span>'); });
      return;
    }
    done('<span class="para">(no content declared for this highlight)</span>');
  }

  // Open .ctx link as its own new pop-up cluster
  function openFromCtxLink(link) {
    openCluster(link.href, linkLabel(link));
  }

  function wireCtxLinks(doc) {
    doc.addEventListener('click', function (e) {
      var link = e.target.closest('.ctx a');
      if (!link) return;
      e.preventDefault();
      openFromCtxLink(link);
    });
  }
  // the resolved URL (openCluster loads into a new iframe), not fetch html
  function hrefForVersion(trigger) {
    var href = trigger.dataset['href' + (CURRENT_VERSION === 'b' ? 'B' : 'A')] || trigger.dataset.href;
    return href ? new URL(href, trigger.baseURI).href : null;
  }

  function openFromPopTrigger(trigger) {
    var href = hrefForVersion(trigger);
    if (href) openCluster(href, linkLabel(trigger));
  }

  function wirePopTriggers(doc) {
    doc.addEventListener('click', function (e) {
      var trigger = e.target.closest('.pop');
      if (!trigger) return;
      openFromPopTrigger(trigger);
    });
  }
  function wireExpanders(doc) {
    doc.addEventListener('click', function (e) {
      var closer = e.target.closest('.inline-close');
      if (closer) { closeNote(closer.closest('.inline-box')); return; }

      var trigger = e.target.closest('.expand');
      if (!trigger) return;

      if (trigger._box) { closeNote(trigger._box); return; } // toggle shut

      var box = doc.createElement('span');
      box.className = 'inline-box';
      box.innerHTML = '<button class="inline-close" aria-label="Close">&times;</button><span class="inline-body">Loading…</span>';
      trigger.after(box);
      trigger.classList.add('open');
      trigger._box = box;
      box._trigger = trigger;

      noteContent(trigger, function (html) {
        var body = box.querySelector('.inline-body');
        if (body) body.innerHTML = html; // event delegation covers any .expand inside this too
      });
    });
  }


  function adoptFrame(doc) {
    applyVersion(doc, true); 
    if (doc._expandersAdopted) return;
    doc._expandersAdopted = true;
    var s = doc.createElement('style');
    s.textContent = EXPAND_CSS + VERSION_CSS + CTX_CSS;
    doc.head.appendChild(s);
    wireExpanders(doc);
    wireCtxLinks(doc);
    wirePopTriggers(doc);
  }

  // ---------- grid relayout ----------


  function relayout(cluster) {
    var panels = Array.prototype.slice.call(cluster.querySelectorAll('.panel'));
    if (!panels.length) return;
    var minCol = Math.min.apply(null, panels.map(function (p) { return p._col; }));
    var maxCol = Math.max.apply(null, panels.map(function (p) { return p._col; }));
    var minRow = Math.min.apply(null, panels.map(function (p) { return p._row; }));
    var maxRow = Math.max.apply(null, panels.map(function (p) { return p._row; }));
    var colOffset = 1 - minCol;
    var rowOffset = 2 - minRow; // row 1 = title bar, always

    var cols = [], rows = [];
    for (var c = minCol; c <= maxCol; c++) {
      var colPanels = panels.filter(function (p) { return p._col === c; });
      cols.push(Math.max.apply(null, [MIN_W].concat(colPanels.map(function (p) { return p._w; }))) + 'px');
    }
    for (var r = minRow; r <= maxRow; r++) {
      var rowPanels = panels.filter(function (p) { return p._row === r; });
      rows.push(Math.max.apply(null, [MIN_H].concat(rowPanels.map(function (p) { return p._h; }))) + 'px');
    }
    cluster.style.gridTemplateColumns = cols.join(' ');
    cluster.style.gridTemplateRows = 'auto ' + rows.join(' '); // row 1 = title bar

    panels.forEach(function (p) {
      p.style.gridColumn = p._col + colOffset;
      p.style.gridRow = p._row + rowOffset;
    });
  }

  // ---------- panels ----------

  function makePanel(cluster, col, row, opts) {
    opts = opts || {};
    var panel = document.createElement('section');
    panel.className = 'panel';
    panel.innerHTML =
      (opts.root ? '' : '<button class="panel-close" aria-label="Close">&times;</button>') +
      '<div class="panel-body"></div>' +
      '<button class="ext ext-right" aria-label="Extend right" hidden>&rsaquo;</button>' +
      '<button class="ext ext-down" aria-label="Extend down" hidden>&rsaquo;</button>' +
      '<button class="ext ext-up" aria-label="Extend up" hidden>&rsaquo;</button>' +
      '<button class="ext ext-left" aria-label="Extend left" hidden>&rsaquo;</button>';

    panel._col = col; panel._row = row;
    panel._w = MIN_W; panel._h = MIN_H;
    panel._kids = [];
    panel._parent = null;
    panel._isRoot = !!opts.root;
    panel._nextRight = null;
    panel._nextDown = null;
    panel._nextUp = null;
    panel._nextLeft = null;
    cluster._cells.add(col + ',' + row);

    panel.querySelector('.ext-right').onclick = function () { extend(cluster, panel, 1, 0, panel._nextRight); };
    panel.querySelector('.ext-down').onclick = function () { extend(cluster, panel, 0, 1, panel._nextDown); };
    panel.querySelector('.ext-up').onclick = function () { extend(cluster, panel, 0, -1, panel._nextUp); };
    panel.querySelector('.ext-left').onclick = function () { extend(cluster, panel, -1, 0, panel._nextLeft); };
    if (!opts.root) panel.querySelector('.panel-close').onclick = function () { removePanel(cluster, panel); };

    cluster.appendChild(panel);
    return panel;
  }

  function loadPanel(cluster, panel, url, opts) {
    opts = opts || {};
    var frame = document.createElement('iframe');
    frame.title = 'context';
    frame.addEventListener('load', function () {
      var doc;
      try { doc = frame.contentDocument; } catch (err) { doc = null; }
      if (doc) adoptFrame(doc);

      if (opts.onTitle) resolveTitle(frame, opts.fallbackTitle, opts.onTitle);

      var size = measurePage(frame);
      panel._w = size.w; panel._h = size.h;

      var next = readNextLinks(frame);
      panel._nextRight = next.right;
      panel._nextDown = next.down;
      panel._nextUp = next.up;
      panel._nextLeft = next.left;

      relayout(cluster);
      refreshArrows(cluster);
      clampIntoView(cluster);
    });

    panel.querySelector('.panel-body').appendChild(frame);
    frame.src = url;
    return frame;
  }

  function extend(cluster, from, dCol, dRow, href) {
    if (!href) return; // this direction has nothing declared
    var col = from._col + dCol, row = from._row + dRow;
    if (cluster._cells.has(col + ',' + row)) return; 
    if (cluster._spent >= PANEL_BUDGET) return;

    var panel = makePanel(cluster, col, row);
    panel._parent = from;
    from._kids.push(panel);
    cluster._spent++;

    loadPanel(cluster, panel, href);

    relayout(cluster);
    refreshArrows(cluster);
    clampIntoView(cluster); // it just got bigger
  }

  // Closing a panel takes everything grown off it.
  function removePanel(cluster, panel) {
    panel._kids.slice().forEach(function (kid) { removePanel(cluster, kid); });
    cluster._cells.delete(panel._col + ',' + panel._row);
    if (panel._parent) panel._parent._kids = panel._parent._kids.filter(function (k) { return k !== panel; });
    panel.remove();
    cluster._spent--;
    relayout(cluster);
    refreshArrows(cluster);
  }

  // there's still budget left.
  function refreshArrows(cluster) {
    var budgetLeft = cluster._spent < PANEL_BUDGET;
    cluster.querySelectorAll('.panel').forEach(function (p) {
      function free(c, r) { return !cluster._cells.has(c + ',' + r); }
      p.querySelector('.ext-right').hidden = !(budgetLeft && p._nextRight && free(p._col + 1, p._row));
      p.querySelector('.ext-down').hidden = !(budgetLeft && p._nextDown && free(p._col, p._row + 1));
      p.querySelector('.ext-up').hidden = !(budgetLeft && p._nextUp && free(p._col, p._row - 1));
      p.querySelector('.ext-left').hidden = !(budgetLeft && p._nextLeft && free(p._col - 1, p._row));
    });
  }

  // ---------- position & drag ----------

  function placeRandomly(el) {
    var pad = 24;
    var rect = el.getBoundingClientRect();
    var maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    var maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    el.style.left = pad + Math.random() * (maxX - pad) + 'px';
    el.style.top = pad + Math.random() * (maxY - pad) + 'px';
  }

  function clampIntoView(el) {
    var box = el.getBoundingClientRect();
    el.style.left = clamp(box.left, 0, Math.max(0, window.innerWidth - box.width)) + 'px';
    el.style.top = clamp(box.top, 0, Math.max(0, window.innerHeight - box.height)) + 'px';
  }

  var zTop = 100;
  function bringToFront(el) { el.style.zIndex = ++zTop; }

  function makeDraggable(cluster) {
    var bar = cluster.querySelector('.popup-bar');
    cluster.addEventListener('pointerdown', function () { bringToFront(cluster); });

    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.popup-close')) return;
      var box = cluster.getBoundingClientRect();
      var dx = e.clientX - box.left, dy = e.clientY - box.top;

      bar.setPointerCapture(e.pointerId);
      cluster.classList.add('dragging');
      bar.classList.add('dragging');

      function move(ev) {
        cluster.style.left = clamp(ev.clientX - dx, 0, window.innerWidth - box.width) + 'px';
        cluster.style.top = clamp(ev.clientY - dy, 0, window.innerHeight - box.height) + 'px';
      }
      function up() {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        cluster.classList.remove('dragging');
        bar.classList.remove('dragging');
      }
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      e.preventDefault();
    });
  }

  // ---------- opening a cluster ----------

  function openCluster(url, fallbackTitle) {
    var cluster = document.createElement('div');
    cluster.className = 'cluster';
    cluster.innerHTML =
      '<div class="popup-bar">' +
      '<span class="grip">⣿⣿⣿</span>' +
      '<span class="popup-title"></span>' +
      '<button class="popup-close" aria-label="Close">&times;</button>' +
      '</div>';
    cluster._cells = new Set();
    cluster._spent = 0;

    var label = cluster.querySelector('.popup-title');
    label.textContent = fallbackTitle; // shown until the page loads

    var root = makePanel(cluster, 0, 0, { root: true }); // virtual origin 
    loadPanel(cluster, root, url, {
      fallbackTitle: fallbackTitle,
      onTitle: function (t) { label.textContent = t; }
    });

    cluster.querySelector('.popup-close').onclick = function () { cluster.remove(); };

    document.body.appendChild(cluster);
    relayout(cluster);
    placeRandomly(cluster);
    bringToFront(cluster);
    makeDraggable(cluster);
    refreshArrows(cluster);
    return cluster;
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('.ctx a');
    if (link) {
      e.preventDefault(); // without JS the link still just navigates
      openFromCtxLink(link);
      return;
    }
    var popTrigger = e.target.closest('.pop');
    if (popTrigger) { openFromPopTrigger(popTrigger); return; }

    var versionBtn = e.target.closest('[data-set-version]');
    if (versionBtn) setVersion(versionBtn.getAttribute('data-set-version'));
    var viewBtn = e.target.closest('[data-set-view]');
    if (viewBtn) setFlowView(viewBtn.getAttribute('data-set-view'));
  });

  window.addEventListener('resize', function () {
    document.querySelectorAll('.cluster').forEach(clampIntoView);
  });


  applyVersion(document, false);
  refreshToggleButtons();
})();
