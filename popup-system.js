/*
 * Popup / extend-cluster system — grid-based.
 *
 * Ported from a reference prototype the project owner supplied (a
 * "frankie.html" cluster/panel skeleton), adapted to load real pages
 * rather than the reference's placeholder text.
 *
 * ARCHITECTURE: a cluster is a CSS Grid. Each panel occupies one
 * (col, row) cell, in a VIRTUAL coordinate space centred on the root
 * panel at (0, 0) — col grows right/shrinks left, row grows down/
 * shrinks up, so a cluster can extend in any of the four directions
 * from any panel, not just right/down from the root. Virtual coords can
 * go negative (growing left or up), but actual CSS grid lines can't —
 * and row 1 is always reserved for the single shared title bar, however
 * far the cluster has grown upward — so relayout() remaps virtual to
 * real grid lines every time it runs: it finds the current min column
 * and min row across every panel and offsets everything so the
 * leftmost column always lands on grid line 1 and the topmost content
 * row always lands on grid line 2 (line 1 stays the title bar). That
 * remapping is cheap and total, so it doesn't matter which direction —
 * or mix of directions — a cluster has grown in; relayout() turns each
 * panel's own desired size into grid tracks — a column is as wide as
 * its widest occupant, a row as tall as its tallest — so panels sharing
 * an edge stay flush without any manual pixel bookkeeping. A Set of
 * "col,row" strings (virtual coords, signed) tracks which cells are
 * taken, so two different branches can never claim the same cell (e.g.
 * a right-child's own up-extend and an up-child's own right-extend
 * would land on the same cell — whichever gets there first wins, the
 * other's arrow just doesn't appear for that cell).
 *
 * Wire-up: give any link the ".ctx" wrapper this page already uses
 * (`<span class="ctx"><a href="...">...</a></span>`), include this file
 * plus popup-system.css. No extra container element is needed — clusters
 * are appended straight to <body>.
 *
 * EXTENDING: a loaded page offers any of the four directions via up to
 * four optional <link> tags in its own <head> — any panel can offer
 * any combination, not just the root:
 *
 *   <link rel="next-right" href="extend-02.html">
 *   <link rel="next-down"  href="extend-01.html">
 *   <link rel="next-up"    href="extend-up.html">
 *   <link rel="next-left"  href="extend-left.html">
 *
 * The arrow for a direction only shows when the page declares it, the
 * target grid cell is free, and the cluster hasn't spent its PANEL_BUDGET
 * (how many extensions one cluster allows in total, see below). Closing
 * a panel removes it and everything grown off it, freeing those cells
 * back up — an ancestor's arrow reappears automatically since arrow
 * visibility is just recomputed from current occupancy each time.
 *
 * SIZING: measurePage() checks, in order: a `<meta name="popup-size"
 * content="WxH">` tag (author opts in to an exact size, scaled down to
 * fit the screen if needed); a page that's a single <img> (fits to that
 * image's natural size); otherwise a random size within a comfortable
 * text-reading range. This is a deliberate change from content-height
 * auto-measurement — it's what the reference file does, and it means a
 * page can pin its own size via the meta tag when it matters.
 *
 * HIGHLIGHTS: a phrase inside any loaded page can open an inline note
 * beside it, using a <span> (not a link) so it can sit inside a <p>:
 *
 *   <span class="expand" data-href="annotation-01.html">a data resource</span>
 *   <span class="expand" data-note="Some text right here.">another phrase</span>
 *
 * Clicking it fetches data-href (or uses data-note directly) and inserts
 * a floated note span right after the phrase — CSS float is what makes
 * the rest of the paragraph wrap around it, so it's genuinely "inside"
 * the text it came from, not a separately positioned box that might
 * spill past its container (no pixel math needed for this one at all).
 * Click again, or its own close button, to remove it. This lives
 * entirely inside the loaded page's own document — same-origin pages
 * get the notes' CSS and click-handling injected automatically once,
 * so content pages don't need to carry that styling themselves.
 *
 * VERSIONS (the site-wide toggle): any page — the landing page itself,
 * or a page loaded into a pop-up — can carry two variants of its text
 * and let one global switch pick which one shows, everywhere, live:
 *
 *   <meta name="title-a" content="Clinical title">
 *   <meta name="title-b" content="Poetic title">
 *   ...
 *   <div data-v="a">Clinical-register paragraph(s).</div>
 *   <div data-v="b">Poetic-register paragraph(s).</div>
 *
 * An element tagged data-v="a"/"b" only renders while the nearest <html>
 * carries the matching data-v attribute; that attribute is what the
 * toggle flips. It's set on the landing page's own document and, via the
 * same same-origin adoption this file already does for highlight CSS, on
 * every loaded content iframe too — so a page never has to wire this up
 * itself beyond marking its two variants. A highlight's data-note can
 * also be versioned (data-note-a / data-note-b, falling back to a plain
 * data-note if only one is given). Any button anywhere on the page with
 * a data-set-version="a"/"b" attribute becomes a toggle control for
 * free, the same delegated-click way .ctx links work — see
 * .version-toggle in popup-system.css for a ready-made one.
 *
 * Default version: same pattern as this project's own --paper/--ink
 * light/dark custom properties. Until someone actually clicks the
 * toggle, the version follows the OS's prefers-color-scheme live (dark
 * → poetic, light → clinical); the first click is remembered
 * (localStorage) as an explicit choice and wins over the system from
 * then on, on every later visit.
 *
 * POPPING OUT: a .ctx link works the same wherever it is, not just on
 * the landing page — one inside a loaded page's own content (its
 * ordinary paragraph text, or a fetched highlight note) opens as its
 * own new, independent, draggable pop-up too, instead of the browser's
 * default same-frame navigation. A plain <a> with no .ctx wrapper is
 * left alone and navigates in place as normal — .ctx is the opt-in.
 *
 * FLOW VIEWS (landing-page-only switcher, separate from the version
 * toggle above): wrap alternate landing-page sections in
 * <div class="flow-view" data-view="...">, all inside one
 * <div class="flow-views" data-current-view="...">, and give a button
 * data-set-view="..." to switch which one shows. Unlike data-set-version
 * this never touches an open pop-up's content — it only ever changes
 * what the landing page itself is showing in that one region. A button
 * can carry both data-set-view and data-set-version at once (see
 * homedemo.html's Proposition/Field Notes buttons) to mean "show the
 * main view, in this register" — Glossary/Reference carry only
 * data-set-view, so they leave the site-wide register untouched.
 */

(function () {
  'use strict';

  var MIN_W = 240, MIN_H = 200;
  var PANEL_BUDGET = 6; // how many extensions (any direction, combined) one cluster allows in total

  // ---------- content versioning (the toggle) ----------

  var VERSION_KEY = 'pb-version';

  // Same "system default until the visitor explicitly overrides it"
  // pattern as --paper/--ink already use for light/dark: no explicit
  // choice yet → follow prefers-color-scheme (dark → poetic, light →
  // clinical); once the toggle is clicked once, that choice is explicit
  // and sticks regardless of what the system does afterwards.
  function systemPrefersDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (err) { return false; }
  }

  function storedVersion() {
    try {
      var v = localStorage.getItem(VERSION_KEY);
      return (v === 'a' || v === 'b') ? v : null; // null = no explicit choice yet
    } catch (err) { return null; } // localStorage can throw (privacy mode etc.)
  }

  var VERSION_EXPLICIT = storedVersion() !== null;
  var CURRENT_VERSION = storedVersion() || (systemPrefersDark() ? 'b' : 'a');

  // Sets the data-v attribute a page's own CSS keys off of, and — for a
  // loaded content page, not the landing page itself — swaps its <title>
  // from the matching <meta name="title-a/b">, so the pop-up bar and the
  // browser tab (were this page opened directly) both stay in sync.
  function applyVersion(doc, isContentFrame) {
    if (!doc || !doc.documentElement) return;
    doc.documentElement.setAttribute('data-v', CURRENT_VERSION);
    if (isContentFrame) {
      var meta = doc.querySelector('meta[name="title-' + CURRENT_VERSION + '"]');
      if (meta) doc.title = meta.content;
      refreshOpenNotes(doc); // any highlight note already open re-fetches in the new version
    }
  }

  // A highlight note that's already open when the toggle flips would
  // otherwise keep showing whichever version it was opened in — refetch
  // (or re-read data-note) for every currently-open TOP-LEVEL one so it
  // catches up (a note nested inside another open note is handled as
  // part of its parent's refresh, below, since replacing the parent's
  // content would otherwise silently destroy it).
  function refreshOpenNotes(doc) {
    var opens = Array.prototype.slice.call(doc.querySelectorAll('.expand.open'));
    opens.filter(function (t) { return !t.closest('.inline-box'); })
         .forEach(refreshOneNote);
  }

  // Replacing a note's body wholesale (fresh HTML for the new version)
  // would otherwise discard any nested note the visitor had drilled into
  // inside it — remember which of THIS note's own .expand children were
  // open by position, then re-click the equivalent ones in the fresh
  // content once it's in. That re-click goes through the normal
  // delegated handler, so it recurses into any further nesting on its
  // own (one level of nested-inside-nested state is preserved this way;
  // deeper than that just reopens fresh, which is a fine trade-off for
  // how rare it'd be).
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

  // A button's "active" state can depend on the version, the flow view,
  // or (for a combined button like Proposition/Field Notes) both at
  // once — active only when every attribute it carries matches current
  // state, so a view-only button (Glossary/Reference) never lights up
  // just because its unrelated register happens to match, and vice versa.
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

  // ---------- flow views (landing-page-only, separate from the version toggle) ----------

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

  // Re-applies CURRENT_VERSION to every open surface at once: the
  // landing page, every loaded pop-up (root and every extended panel),
  // each pop-up's title bar, and any highlight note currently open.
  // Nothing has to be reloaded — shared by an explicit toggle click and
  // by the system theme listener below.
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

  // Called only from an explicit toggle click — this is what makes the
  // choice "explicit" from now on, so the system listener below backs off.
  function setVersion(v) {
    if (v !== 'a' && v !== 'b') return;
    CURRENT_VERSION = v;
    VERSION_EXPLICIT = true;
    try { localStorage.setItem(VERSION_KEY, v); } catch (err) { /* best-effort */ }
    refreshAllSurfaces();
  }

  // Live: if the visitor's OS theme changes while the page is open and
  // they've never clicked the toggle themselves, follow it — same as the
  // --paper/--ink custom properties already do via the CSS media query.
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (VERSION_EXPLICIT) return; // an explicit choice always wins over the system
      CURRENT_VERSION = e.matches ? 'b' : 'a';
      refreshAllSurfaces();
    });
  } catch (err) { /* matchMedia/addEventListener unsupported — initial system default still applies */ }

  // A .ctx link's fallback title (shown until the loaded page's own
  // title resolves) should reflect whichever version is active — plain
  // link.textContent would run both versions together, since CSS
  // display:none doesn't remove text from it.
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

  // How big does a loaded page want its panel to be?
  //   1. the page says so:  <meta name="popup-size" content="520x680">
  //   2. the page is one image: fit the image's natural size
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

  // Same rule content pages get from popup-system.css on the landing
  // page, injected here since a loaded content page doesn't link that
  // stylesheet itself.
  var VERSION_CSS =
    'html [data-v] { display: none; }' + // descendant combinator, not bare [data-v] — see popup-system.css
    'html[data-v="a"] [data-v="a"] { display: revert; }' +
    'html[data-v="b"] [data-v="b"] { display: revert; }';

  // Minimal link styling for a .ctx a found inside loaded content — just
  // enough to mark "this pops out", not the landing page's ambient-
  // opacity behavior (that's a visitor-count effect specific to the
  // landing page itself, and wouldn't make sense inside a pop-up).
  var CTX_CSS =
    '.ctx a { color: inherit; text-decoration: underline dotted; text-underline-offset: 3px; cursor: pointer; }' +
    '.ctx a:hover { text-decoration-style: solid; }';

  function closeNote(box) {
    if (!box) return;
    if (box._trigger) { box._trigger.classList.remove('open'); box._trigger._box = null; }
    box.remove();
  }

  // Content for a note: a version-specific data-note-a/data-note-b if
  // given, else a plain data-note (inline text, no fetch either way);
  // otherwise fetch data-href and use that page's <body>.
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
    // Same version-specific-first-then-plain pattern for the fetched
    // case: data-href-a/data-href-b let the two versions point at
    // entirely different annotation files, not just different text.
    var href = trigger.dataset['href' + (CURRENT_VERSION === 'b' ? 'B' : 'A')] || trigger.dataset.href;
    if (href) {
      // data-* attributes have no resolved-URL property like <a>.href or
      // <link>.href, so a relative path here must be resolved by hand —
      // against the trigger's OWN document (trigger.baseURI), not the
      // top page fetch() would otherwise resolve it against.
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

  // Opens a .ctx link as its own new pop-up cluster — used identically
  // whether the link is on the landing page or inside any loaded page's
  // content (a highlight note's fetched HTML included, since that's
  // just more DOM in an already-adopted document).
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
  // the resolved URL (openCluster loads it into a new iframe by URL),
  // not fetched HTML.
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

  // Context pages are same-origin iframes, so style + wire them from
  // here instead of repeating EXPAND_CSS/wireExpanders in every one.
  function adoptFrame(doc) {
    applyVersion(doc, true); // every (re)load reflects whichever version is currently active
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

  // Virtual (col, row) — signed, root is (0, 0) — get remapped to real
  // (always-positive) CSS grid lines here, from scratch, every time this
  // runs: colOffset/rowOffset shift so the current leftmost column sits
  // on line 1 and the current topmost content row sits on line 2 (line 1
  // is permanently the title bar). Recomputing the offset on every call
  // rather than mutating stored coordinates is what lets a cluster grow
  // left or up after the fact without renumbering anything by hand —
  // extend() only ever adds ±1 to a panel's own virtual coordinate, and
  // this is the one place that turns the whole tree's current shape into
  // actual grid positions.
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

  // col/row are VIRTUAL coordinates (may be negative) — relayout() is
  // what turns them into real grid-column/grid-row values, so this
  // function doesn't need to touch that CSS itself at all.
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
    // Append INTO .panel-body (don't replace it) — its padding is what
    // reserves the blank gutter the extend arrows live in, so the iframe
    // needs to stay nested inside that padded box, not take its place.
    panel.querySelector('.panel-body').appendChild(frame);
    frame.src = url;
    return frame;
  }

  function extend(cluster, from, dCol, dRow, href) {
    if (!href) return; // this direction has nothing declared
    var col = from._col + dCol, row = from._row + dRow;
    if (cluster._cells.has(col + ',' + row)) return; // another branch already owns this cell
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

  // An arrow shows only if that direction was declared, its cell is
  // free, AND there's still budget left.
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

      bar.setPointerCapture(e.pointerId); // keeps events coming even over the iframe
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

    var root = makePanel(cluster, 0, 0, { root: true }); // virtual origin — relayout() maps this to grid line (1, 2)
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
    // Independent, not else-if: a combined button (data-set-version AND
    // data-set-view, e.g. "Field Notes") needs both actions to fire.
    var versionBtn = e.target.closest('[data-set-version]');
    if (versionBtn) setVersion(versionBtn.getAttribute('data-set-version'));
    var viewBtn = e.target.closest('[data-set-view]');
    if (viewBtn) setFlowView(viewBtn.getAttribute('data-set-view'));
  });

  window.addEventListener('resize', function () {
    document.querySelectorAll('.cluster').forEach(clampIntoView);
  });

  // Landing page itself gets the current version applied on load, same
  // as every content iframe does when adopted; the toggle (if the page
  // has one) starts in sync with whatever was last chosen.
  applyVersion(document, false);
  refreshToggleButtons();
})();
