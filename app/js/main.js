// State, editorial header, remote navigation (arrows, 1-5 view keys, 0 dimmer, TV channel keys) & boot.
(function (TH) {
  'use strict';

  var KEY = TH.KEY, el = TH.el;
  var PREFS = 'tvhome.prefs.v3';
  var prefs = TH.load(PREFS, { style: 'cinema', app: 0 });
  var st = { entries: [], style: TH.styles[prefs.style] ? prefs.style : 'cinema', row: 1, col: 0, app: 0, item: 0 };
  var header = [];
  var dimmed = false;
  var dimmerBtn = null;

  TH.isDimmed = function () { return dimmed; };
  TH.toggleDimmer = function (force) {
    dimmed = typeof force === 'boolean' ? force : !dimmed;
    var overlay = document.getElementById('dimmer');
    if (overlay) { overlay.hidden = !dimmed; }
    if (dimmerBtn) { dimmerBtn.classList.toggle('active', dimmed); }
    TH.toast(dimmed ? 'Night Dimmer On' : 'Night Dimmer Off');
    return dimmed;
  };

  function style() { return TH.styles[st.style] || TH.styles.cinema; }
  function rows() { return [header.length].concat(style().rows(st)); }

  function buildHeader() {
    var nav = document.getElementById('header');
    nav.innerHTML = '';
    header = TH.styleOrder.map(function (key) {
      return { label: TH.styles[key].name, key: key, run: function () { setStyle(key); } };
    });
    header.push({ label: TH.platform === 'webos' ? 'LG Home' : 'Samsung', run: TH.openNativeHome || TH.openSamsungHome });
    header.forEach(function (h, idx) {
      h.node = nav.appendChild(el('span', 'hbtn', h.label));
      h.node.setAttribute('data-nav-row', '0');
      h.node.setAttribute('data-nav-col', String(idx));
    });

    var status = document.getElementById('status');
    status.innerHTML = '<span class="wifi">' + TH.icon('wifi') + '</span>';
    ['dimmer', 'inputs', 'settings'].forEach(function (which) {
      var h = {
        key: null,
        run: which === 'dimmer' ? function () { TH.toggleDimmer(); } : function () { TH.openSystem(which); }
      };
      h.node = status.appendChild(el('span', 'ibtn'));
      h.node.innerHTML = TH.icon(which);
      h.node.setAttribute('data-nav-row', '0');
      h.node.setAttribute('data-nav-col', String(header.length));
      if (which === 'dimmer') {
        dimmerBtn = h.node;
        dimmerBtn.classList.toggle('active', dimmed);
      }
      header.push(h);
    });
  }

  function paintWifi() {
    TH.wifi(function (s) {
      var w = document.querySelector('#status .wifi');
      if (!w) { return; }
      w.hidden = s === null;
      w.setAttribute('data-bars', s === null ? 0 : s > .66 ? 3 : s > .33 ? 2 : s > 0 ? 1 : 0);
    });
  }

  function paintHeader() {
    header.forEach(function (h, i) {
      h.node.classList.toggle('on', st.row === 0 && i === st.col);
      h.node.classList.toggle('sel', h.key === st.style);
    });
  }

  function build() {
    var stage = document.getElementById('stage');
    stage.innerHTML = '';
    document.getElementById('wall').innerHTML = '';
    document.getElementById('field').style.backgroundColor = '';
    document.body.className = 'style-' + st.style + (document.hidden ? ' paused' : '');
    if (st.style === 'editorial' || st.style === 'gallery' || st.style === 'lounge') {
      TH.hideArt();
    }
    style().build(st, stage);
    document.getElementById('credit').textContent = TH.art.credit();
    render();
  }

  function render() {
    var r = rows();
    st.row = Math.max(0, Math.min(st.row, r.length - 1));
    st.col = Math.max(0, Math.min(st.col, r[st.row] - 1));
    if (st.row === 1 && st.style !== 'editorial') { st.app = st.col; }
    if (st.row >= 1 && st.style === 'editorial') {
      st.app = Math.min(st.row - 1, st.entries.length - 1);
      st.item = st.col;
    }
    paintHeader();
    style().focus(st);
  }

  function setStyle(key) {
    if (!TH.styles[key]) { return; }
    st.style = key;
    prefs.style = key;
    TH.save(PREFS, prefs);
    if (st.row > 0) {
      st.row = key === 'editorial' ? Math.min(st.app + 1, st.entries.length) : 1;
      st.col = key === 'editorial' ? 0 : st.app;
    }
    build();
  }

  function move(dRow, dCol) {
    var r = rows();
    if (dRow) {
      var next = st.row + dRow;
      if (next < 0 || next >= r.length) { return; }
      st.row = next;
      if (st.row === 1 && st.style !== 'editorial') { st.col = st.app; }
      else if (st.row === 0) { st.col = Math.max(0, TH.styleOrder.indexOf(st.style)); }
      else if (st.style === 'editorial' && st.row >= 1) { st.col = st.item || 0; }
      else if (st.row >= 2 && st.style === 'guide') { st.col = 0; }
    } else {
      st.col += dCol;
      if (st.col < 0 || st.col >= r[st.row]) { st.col -= dCol; return; }
    }
    if (st.row === 1 && st.style !== 'editorial') { st.item = 0; }
    prefs.app = st.app;
    TH.save(PREFS, prefs);
    render();
  }

  function activate() {
    if (st.row === 0) { header[st.col].run(); return; }
    var entry = style().activate(st);
    if (entry) { TH.launch(entry); }
  }

  function findTvIndex() {
    for (var i = 0; i < st.entries.length; i++) {
      if (st.entries[i].kind === 'tv') { return i; }
    }
    return -1;
  }

  var IDLE_MS = 180000, idleTimer = 0;
  function showIdle() {
    if (document.hidden || TH.watchingInput() || !st.entries.length) { return resetIdle(); }
    var box = document.getElementById('idle'), entry = st.entries[st.app];
    var items = TH.art.items(entry, st.app), it = items[st.item % items.length], now = new Date();
    box.style.backgroundImage = 'url("' + it.backdrop + '")';
    box.children[0].textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
    box.children[1].textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    box.children[2].textContent = (TH.art.live ? 'Featured on ' : '') + entry.name + ' · ' + it.title;
    document.body.classList.add('idle');
    idleTimer = setTimeout(function () { st.item = (st.item + 1) % 8; showIdle(); }, 30000);
  }
  function resetIdle() {
    clearTimeout(idleTimer);
    document.body.classList.remove('idle');
    idleTimer = setTimeout(showIdle, IDLE_MS);
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var wasIdle = document.body.classList.contains('idle');
    resetIdle();
    if (wasIdle) { e.preventDefault(); return; }

    var inputMode = TH.watchingInput();
    if (inputMode) {
      if (TH.isBack(k)) { e.preventDefault(); TH.leaveInput(); return; }
      if (inputMode === 'tv') {
        if (k === KEY.UP || TH.isChUp(k)) { e.preventDefault(); TH.tuneChannel(1); return; }
        if (k === KEY.DOWN || TH.isChDown(k)) { e.preventDefault(); TH.tuneChannel(-1); return; }
        if (k === KEY.ENTER || k === KEY.CH_LIST) { e.preventDefault(); TH.openTvApp('channels'); return; }
        if (k === KEY.GUIDE) { e.preventDefault(); TH.openTvApp('guide'); return; }
        if (k === KEY.INFO) {
          e.preventDefault();
          var ch = TH.getChannelInfo();
          TH.showInputBanner((ch && ch.label ? ch.label : 'Live Terrestrial TV') + ' · CH+/CH- tune · Back home');
          return;
        }
      }
      return;
    }

    if (k === KEY.LEFT) { move(0, -1); }
    else if (k === KEY.RIGHT) { move(0, 1); }
    else if (k === KEY.UP) { move(-1, 0); }
    else if (k === KEY.DOWN) { move(1, 0); }
    else if (k === KEY.ENTER) { activate(); }
    else if (TH.isBack(k)) {
      st.row = st.style === 'editorial' ? Math.min(st.app + 1, st.entries.length) : 1;
      st.col = st.style === 'editorial' ? 0 : st.app;
      render();
    }
    else if (TH.isChUp(k) || TH.isChDown(k)) {
      var tvIdx = findTvIndex();
      if (tvIdx >= 0) {
        st.app = tvIdx;
        prefs.app = tvIdx;
        TH.save(PREFS, prefs);
        render();
        TH.launch(st.entries[tvIdx]);
      }
    }
    else if (k === KEY.CH_LIST) { TH.openTvApp('channels'); }
    else if (k === KEY.GUIDE) { TH.openTvApp('guide'); }
    else if (k >= 49 && k <= 53 && TH.styleOrder[k - 49]) { setStyle(TH.styleOrder[k - 49]); }
    else if (k === 48 || k === 96) { TH.toggleDimmer(); }
    else { return; }
    e.preventDefault();
  });

  // LG Magic Remote pointer hover, click & scroll wheel navigation (Chromium 34+ safe).
  function findNavTarget(target) {
    var node = target;
    while (node && node !== document && node.getAttribute) {
      if (node.getAttribute('data-nav-row') !== null) { return node; }
      node = node.parentNode;
    }
    return null;
  }

  function applyPointerFocus(node) {
    var row = parseInt(node.getAttribute('data-nav-row'), 10);
    var col = parseInt(node.getAttribute('data-nav-col'), 10);
    if (isNaN(row) || isNaN(col)) { return false; }
    if (st.row === row && st.col === col) { return true; }
    st.row = row;
    st.col = col;
    if (row === 1 && st.style !== 'editorial') { st.app = col; st.item = 0; }
    if (row >= 1 && st.style === 'editorial') {
      st.app = Math.min(row - 1, st.entries.length - 1);
      st.item = col;
    }
    prefs.app = st.app;
    TH.save(PREFS, prefs);
    render();
    return true;
  }

  document.addEventListener('mouseover', function (e) {
    if (document.body.classList.contains('idle') || TH.watchingInput()) { return; }
    var nav = findNavTarget(e.target);
    if (nav) { applyPointerFocus(nav); }
  });

  document.addEventListener('click', function (e) {
    if (document.body.classList.contains('idle')) { resetIdle(); return; }
    resetIdle();
    if (TH.watchingInput()) { return; }
    var nav = findNavTarget(e.target);
    if (nav && applyPointerFocus(nav)) { activate(); }
  });

  var lastWheelAt = 0;
  document.addEventListener('mousemove', function () {
    if (document.body.classList.contains('idle')) { resetIdle(); }
  });
  document.addEventListener('wheel', function (e) {
    if (document.body.classList.contains('idle')) { resetIdle(); return; }
    resetIdle();
    if (TH.watchingInput()) { return; }
    var dy = e.deltaY || 0;
    if (Math.abs(dy) <= 8) { return; }
    var now = Date.now();
    if (now - lastWheelAt < 140) { return; }
    lastWheelAt = now;
    if (st.style === 'editorial') {
      move(dy > 0 ? 1 : -1, 0);
    } else {
      move(0, dy > 0 ? 1 : -1);
    }
  });

  function refreshArt() {
    if (!st.entries.length) { return; }
    TH.art.refresh(st.entries, function (changed) {
      if (changed) { build(); }
      TH.art.preload(st.entries);
    });
  }
  function refreshFeeds() {
    if (TH.feeds && st.entries.length) {
      TH.feeds.refreshAll(function () {
        if (TH.tickClock) { TH.tickClock(); }
        if (st.entries.length) { style().focus(st); }
      });
    }
  }
  setInterval(function () { refreshArt(); refreshFeeds(); }, 1800 * 1000);

  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('paused', document.hidden);
    if (!document.hidden) { TH.tell('/home'); refreshArt(); refreshFeeds(); paintWifi(); resetIdle(); }
  });

  setInterval(function () {
    if (document.hidden || !st.entries.length || TH.watchingInput()) { return; }
    if (st.style === 'lounge' && TH.styles.lounge) {
      var list = TH.feeds.getPulse();
      TH.styles.lounge.idx = (TH.styles.lounge.idx + 1) % list.length;
      style().focus(st);
      return;
    }
    if (st.style === 'gallery' || st.style === 'editorial' || (st.style === 'guide' && st.row === 2)) { return; }
    st.item = (st.item + 1) % 4;
    style().focus(st);
  }, 15000);

  TH.registerKeys();
  TH.startWatcher();
  TH.startClock();
  buildHeader();
  paintWifi();
  setInterval(paintWifi, 60000);
  resetIdle();
  TH.loadEntries(function (entries) {
    st.entries = entries.length ? entries : [{ kind: 'nativeHome', name: TH.platform === 'webos' ? 'LG Home' : 'Samsung Home', key: 'other', color: '#101216', fg: '#f1efe9' }];
    st.app = Math.min(prefs.app || 0, st.entries.length - 1);
    st.row = st.style === 'editorial' ? Math.min(st.app + 1, st.entries.length) : 1;
    st.col = st.style === 'editorial' ? 0 : st.app;
    document.body.classList.remove('loading');
    build();
    TH.tell('/home');
    setTimeout(function () { refreshArt(); refreshFeeds(); }, 1200);
  });
})(window.TH);
