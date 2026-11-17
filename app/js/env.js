// Shared basics: TV platform detection (Samsung Tizen & LG webOS), Luna service bridge,
// remote keys, hardware key registration, storage, toast and clock. (ES5 safe for Chromium 34+)
window.TH = {};
(function (TH) {
  'use strict';

  TH.tz = window.tizen || null;
  TH.webosBridge = window.PalmServiceBridge || window.WebOSServiceBridge || null;
  TH.platform = TH.tz ? 'tizen' : (TH.webosBridge || /Web0S|webOS|NetCast/i.test(navigator.userAgent || '') ? 'webos' : 'demo');

  TH.KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, LG_BACK: 461, ESC: 27,
    CH_UP: 427, CH_DOWN: 428, PG_UP: 33, PG_DOWN: 34,
    CH_LIST: 10073, GUIDE: 458, PREV_CH: 10190, INFO: 457
  };

  TH.isBack = function (k) { return k === 10009 || k === 461 || k === 27; };
  TH.isChUp = function (k) { return k === 427 || k === 33; };
  TH.isChDown = function (k) { return k === 428 || k === 34; };

  TH.SERVICE_URL = 'http://127.0.0.1:47791';
  TH.SERVICE_ID = 'TvHome0001.Watcher';

  TH.luna = function (uri, params, onOk, onErr) {
    var Bridge = TH.webosBridge || window.PalmServiceBridge || window.WebOSServiceBridge;
    if (!Bridge) {
      setTimeout(function () { if (onErr) { onErr({ errorText: 'No PalmServiceBridge' }); } }, 0);
      return;
    }
    var done = false;
    var b = new Bridge();
    var timer = setTimeout(function () {
      if (done) { return; }
      done = true;
      try { if (typeof b.cancel === 'function') { b.cancel(); } } catch (e) {}
      if (onErr) { onErr({ errorText: 'Luna timeout' }); }
    }, 2500);

    b.onservicecallback = function (raw) {
      if (done) { return; }
      done = true;
      clearTimeout(timer);
      var res = null;
      try { res = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {}
      if (res && res.returnValue !== false) {
        if (onOk) { onOk(res); }
      } else if (onErr) {
        onErr(res || { errorText: 'Luna request failed' });
      }
    };

    try {
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        if (onErr) { onErr({ errorText: e && e.message ? e.message : 'Luna call error' }); }
      }
    }
  };

  TH.registerKeys = function () {
    var dev = TH.tz && TH.tz.tvinputdevice;
    if (!dev || typeof dev.registerKey !== 'function') { return; }
    ['0', '1', '2', '3', '4', '5', 'ChannelUp', 'ChannelDown', 'ChannelList', 'Guide', 'PreviousChannel', 'Info'].forEach(function (name) {
      try { dev.registerKey(name); } catch (e) {}
    });
  };

  TH.load = function (key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  };
  TH.save = function (key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage is optional */ }
  };

  var toastTimer = null;
  TH.toast = function (text) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  };

  TH.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  };

  function tick() {
    var now = new Date();
    var time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var day = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    var w = TH.feeds && TH.feeds.getWeather ? TH.feeds.getWeather() : null;
    var sub = day + (w && w.temp && w.temp !== '--' ? ' · ' + w.temp + '° ' + w.city : '');
    var el = document.getElementById('clock');
    if (!el) { return; }
    el.innerHTML = '';
    el.appendChild(TH.el('b', '', time));
    el.appendChild(TH.el('span', '', sub));
  }
  TH.tickClock = tick;
  TH.startClock = function () { tick(); setInterval(tick, 15000); };
})(window.TH);
