// Apps, Terrestrial TV, HDMI inputs and the Home-button watcher.
(function (TH) {
  'use strict';

  var tz = TH.tz;

  // Preinstalled streamers are known to the TV's local API by store id; the watcher polls that API.
  var STORE_IDS = {
    'org.tizen.netflix-app': '3201907018807',
    'rJeHak5zRg.Spotify': '3201606009684',
    'org.tizen.browser': '3202010022079'
  };
  var YOUTUBE_STORE_ID = '111299001912';
  var INPUTS = 'tvhome.inputs.v1';
  var HIDDEN = /service|emanual|companion|dummy|widget|klyq|DclHome001|TvHome0001|GoogleDuo|SecurityCenter|IewQEY143t|J9fZJDMi1v|h6D3hH79er|primevideo|DisneyPlus|aria-video|AwJZqXfE51/i;
  var ORDER = ['youtube', 'spotify', 'live tv', 'netflix', 'movy', 'internet', 'browser'];

  var BRAND = {
    youtube: { key: 'youtube', sub: 'Video', color: '#101216', fg: '#f1efe9', logo: 'youtube' },
    spotify: { key: 'spotify', sub: 'Music', color: '#101216', fg: '#f1efe9', logo: 'spotify' },
    'live tv': { key: 'tv', sub: 'Terrestrial', color: '#101216', fg: '#f1efe9', logo: 'tv' },
    netflix: { key: 'netflix', sub: 'Cinema', color: '#101216', fg: '#f1efe9', logo: 'netflix' },
    movy: { key: 'movy', sub: 'Brave · movy.sx', color: '#101216', fg: '#f1efe9', logo: 'brave' },
    internet: { key: 'movy', sub: 'Brave · movy.sx', color: '#101216', fg: '#f1efe9', logo: 'brave' },
    browser: { key: 'movy', sub: 'Brave · movy.sx', color: '#101216', fg: '#f1efe9', logo: 'brave' }
  };

  TH.SYSTEM_APPS = {
    settings: 'com.samsung.tv.coba.setting',
    inputs: 'org.tizen.SMSourceAPP',
    channels: 'org.tizen.channel-list',
    guide: 'com.samsung.tv.coba.epg',
    scan: 'org.tizen.channel-search'
  };

  function brandFor(name) {
    var lower = String(name || '').toLowerCase();
    for (var prefix in BRAND) {
      if (lower.indexOf(prefix) === 0) { return BRAND[prefix]; }
    }
    return { key: 'other', sub: 'App', color: '#101216', fg: '#f1efe9' };
  }

  function rank(name) {
    var lower = String(name || '').toLowerCase();
    for (var i = 0; i < ORDER.length; i++) {
      if (lower.indexOf(ORDER[i]) === 0) { return i; }
    }
    return ORDER.length;
  }

  function normalizeName(id, name) {
    if (id === 'rJeHak5zRg.Spotify' || /^spotify/i.test(name || '')) { return 'Spotify'; }
    if (id === 'org.tizen.browser' || /^(internet|browser)$/i.test(name || '')) { return 'Movy'; }
    return name;
  }

  function appEntry(id, name, icon) {
    var displayName = normalizeName(id, name);
    var b = brandFor(displayName);
    var storeId = STORE_IDS[id] || (id === '9Ur5IzDKqV.TizenYouTube' ? YOUTUBE_STORE_ID : null);
    var sub = id === 'tUb3Xq7Lm9.Tube' ? 'Ad-Free' : (b.sub || 'App');
    var entry = {
      kind: 'app', id: id, storeId: storeId, name: displayName, sub: sub,
      icon: icon || '', key: b.key, color: b.color, fg: b.fg, logo: b.logo
    };
    if (displayName === 'Movy') { entry.url = 'https://www.movy.sx/'; }
    return entry;
  }

  function formatChannel(ch) {
    if (!ch) { return ''; }
    var num = ch.major ? (ch.minor ? ch.major + '-' + ch.minor : String(ch.major)) : '';
    var title = ch.channelName ? String(ch.channelName).trim() : '';
    if (num && title) { return 'Ch ' + num + ' · ' + title; }
    if (num) { return 'Channel ' + num; }
    return title;
  }

  TH.getChannelInfo = function () {
    try {
      if (tz && tz.tvchannel && typeof tz.tvchannel.getCurrentChannel === 'function') {
        var ch = tz.tvchannel.getCurrentChannel();
        if (ch && (ch.major || ch.channelName)) {
          return {
            major: ch.major || 0,
            minor: ch.minor || 0,
            channelName: ch.channelName || '',
            label: formatChannel(ch)
          };
        }
      }
    } catch (e) {}
    return null;
  };

  function tvEntry(source, chInfo) {
    return {
      kind: 'tv', id: 'tv1', name: 'Live TV',
      sub: (chInfo && chInfo.label) ? chInfo.label : 'Terrestrial',
      raw: source || { type: 'TV', number: 1 },
      key: 'tv', color: '#101216', fg: '#f1efe9', logo: 'tv'
    };
  }

  function hdmiEntry(source) {
    var name = source.editName || ('HDMI ' + source.number);
    return {
      kind: 'hdmi', id: 'hdmi' + source.number, name: name, sub: 'HDMI ' + source.number,
      raw: source, key: 'hdmi', color: '#101216', fg: '#f1efe9'
    };
  }

  TH.loadEntries = function (done) {
    if (!tz || !tz.application) {
      var demo = [
        appEntry('tUb3Xq7Lm9.Tube', 'YouTube', ''),
        appEntry('rJeHak5zRg.Spotify', 'Spotify', ''),
        tvEntry({ type: 'TV', number: 1 }, { label: 'Ch 7 · GMA' }),
        appEntry('org.tizen.netflix-app', 'Netflix', ''),
        appEntry('org.tizen.browser', 'Internet', ''),
        hdmiEntry({ type: 'HDMI', number: 1, editName: 'Fire TV' })
      ];
      done(demo);
      return;
    }

    var apps = [];
    function withInputs() {
      var seen = TH.load(INPUTS, []);
      function finish(connected, allSources) {
        var tvSrc = allSources.filter(function (s) { return s.type === 'TV'; })[0];
        if (!tvSrc) {
          try {
            var m = tz.tvwindow.getSource('MAIN');
            if (m && m.type === 'TV') { tvSrc = m; }
          } catch (e) {}
        }
        apps.push(tvEntry(tvSrc || { type: 'TV', number: 1 }, TH.getChannelInfo()));
        apps.sort(function (a, b) { return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name); });

        connected.forEach(function (s) {
          seen = seen.filter(function (o) { return o.number !== s.number; }).concat([{ number: s.number, editName: s.editName }]);
        });
        TH.save(INPUTS, seen);
        seen.sort(function (a, b) { return a.number - b.number; }).forEach(function (o) {
          var live = connected.filter(function (s) { return s.number === o.number; })[0];
          apps.push(hdmiEntry(live || { type: 'HDMI', number: o.number, editName: o.editName }));
        });
        done(apps);
      }
      try {
        tz.systeminfo.getPropertyValue('VIDEOSOURCE', function (info) {
          var conn = info.connected || [];
          var all = conn.concat(info.disconnected || []);
          finish(conn.filter(function (s) { return s.type === 'HDMI'; }), all);
        }, function () { finish([], []); });
      } catch (e) { finish([], []); }
    }

    try {
      tz.application.getAppsInfo(function (list) {
        var hasAdFreeYT = list.some(function (a) { return a.packageId === 'tUb3Xq7Lm9'; });
        list.forEach(function (a) {
          if (hasAdFreeYT && a.packageId === '9Ur5IzDKqV') { return; }
          if (a.show === false || !a.name || HIDDEN.test(a.id)) { return; }
          if (!/^[A-Za-z0-9]{10}$/.test(a.packageId || '') && !STORE_IDS[a.id]) { return; }
          apps.push(appEntry(a.id, a.name, a.iconPath));
        });
        apps.sort(function (a, b) { return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name); });
        TH.tell('/apps?ids=' + apps.map(function (a) { return encodeURIComponent(a.storeId || a.id); }).join(','));
        withInputs();
      }, withInputs);
    } catch (e) { withInputs(); }
  };

  // ---- watcher bridge ----
  TH.tell = function (path, ok, failed) {
    if (!tz) { return; }
    var x = new XMLHttpRequest();
    x.open('GET', TH.SERVICE_URL + path);
    x.timeout = 1500;
    x.onload = function () { if (x.status === 200) { if (ok) { ok(); } } else if (failed) { failed(); } };
    x.onerror = x.ontimeout = function () { if (failed) { failed(); } else { TH.startWatcher(); } };
    x.send();
  };
  TH.startWatcher = function () {
    if (!tz) { return; }
    try {
      tz.application.launchAppControl(new tz.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
        TH.SERVICE_ID, null, null);
    } catch (e) { /* without the service, Home goes to Samsung's screen */ }
  };

  // ---- launching ----
  TH.openUrl = function (url) {
    var target = url || 'https://www.movy.sx/';
    TH.toast('Opening Movy · Tip: Profile icon → Turn off "Show ads"');
    if (!tz || !tz.application) { return; }
    var storeId = STORE_IDS['org.tizen.browser'];
    function fallback() {
      TH.tell('/watch?id=' + encodeURIComponent(storeId));
      try {
        tz.application.launch('org.tizen.browser', null, function () {
          TH.tell('/home');
          TH.toast('Could not open browser');
        });
      } catch (e) {
        TH.tell('/home');
        TH.toast('Could not open browser');
      }
    }
    TH.tell('/watch?id=' + encodeURIComponent(storeId));
    try {
      var ac = new tz.ApplicationControl('http://tizen.org/appcontrol/operation/view', target);
      tz.application.launchAppControl(ac, null, null, fallback);
    } catch (e) {
      fallback();
    }
  };

  TH.launch = function (entry) {
    if (entry.kind === 'hdmi' || entry.kind === 'tv') { return showInput(entry); }
    if (entry.kind === 'samsung') { return TH.openSamsungHome(); }
    if (entry.url) { return TH.openUrl(entry.url); }
    if (!tz || !tz.application) { return TH.toast('Opening ' + entry.name); }
    function failed() { TH.tell('/home'); TH.toast('Could not open ' + entry.name); }
    if (entry.storeId === YOUTUBE_STORE_ID) {
      TH.tell('/leave', function () {
        try { tz.application.launch(entry.id, null, failed); } catch (e) { failed(); }
      }, failed);
      return;
    }
    TH.tell('/watch?id=' + encodeURIComponent(entry.storeId || entry.id));
    try { tz.application.launch(entry.id, null, failed); } catch (e) { failed(); }
  };

  TH.openSamsungHome = function () {
    if (!tz || !tz.application) { return TH.toast('Samsung Home'); }
    TH.tell('/leave', function () {
      try { tz.application.launch('com.samsung.tv.csfs', null, function () { TH.tell('/home'); }); }
      catch (e) { TH.tell('/home'); }
    }, function () { TH.toast('Samsung Home is unavailable'); });
  };

  TH.openSystem = function (which) {
    if (!tz || !tz.application) { return TH.toast('Opening ' + which); }
    var appId = TH.SYSTEM_APPS[which];
    if (!appId) { return; }
    try { tz.application.launch(appId, null, function () { TH.toast('Could not open ' + which); }); }
    catch (e) { TH.toast('Could not open ' + which); }
  };
  TH.openTvApp = TH.openSystem;

  // Wi-Fi strength 0..1, or null when wired, offline or unknown.
  TH.wifi = function (done) {
    if (!tz || !tz.systeminfo) { return done(0.8); }
    try {
      tz.systeminfo.getPropertyValue('NETWORK', function (n) {
        if (n.networkType !== 'WIFI') { return done(n.networkType === 'NONE' ? 0 : null); }
        tz.systeminfo.getPropertyValue('WIFI_NETWORK', function (w) { done(w.signalStrength); }, function () { done(null); });
      }, function () { done(null); });
    } catch (e) { done(null); }
  };

  // ---- live TV & HDMI window ----
  var watchingInput = false;
  var bannerTimer = 0;

  TH.showInputBanner = function (text) {
    var box = document.getElementById('hdmi');
    if (!box) { return; }
    box.textContent = text;
    box.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { box.hidden = true; }, 3000);
  };

  function sourceFor(entry, done) {
    tz.systeminfo.getPropertyValue('VIDEOSOURCE', function (info) {
      var all = (info.connected || []).concat(info.disconnected || []);
      var live = all.filter(function (s) {
        return s.type === entry.raw.type && s.number === entry.raw.number;
      })[0];
      var main = null;
      try { main = tz.tvwindow.getSource('MAIN'); } catch (e) {}
      var matchMain = (main && main.type === entry.raw.type && main.number === entry.raw.number) ? main : null;
      done(live || matchMain || (entry.kind === 'tv' ? entry.raw : null));
    }, function () { done(entry.kind === 'tv' ? entry.raw : null); });
  }

  function showInput(entry) {
    if (!tz || !tz.tvwindow) { return TH.toast('Opening ' + entry.name); }
    try {
      sourceFor(entry, function (source) {
        if (!source) { return TH.toast(entry.name + ' is asleep. Wake it with its own remote.'); }
        switchTo(entry, source);
      });
    } catch (e) { TH.toast('Could not switch input'); }
  }

  function switchTo(entry, source) {
    try {
      tz.tvwindow.setSource(source, function () {
        tz.tvwindow.show(function () {
          watchingInput = entry.kind;
          document.body.classList.add('input');
          var ch = entry.kind === 'tv' ? TH.getChannelInfo() : null;
          var msg = entry.kind === 'tv'
            ? ((ch && ch.label ? ch.label : 'Live Terrestrial TV') + ' · CH+/CH- tune · Back home')
            : (entry.name + ' · Back home');
          TH.showInputBanner(msg);
        }, function () { TH.toast('Could not show ' + entry.name); }, ['0px', '0px', '1920px', '1080px'], 'MAIN');
      }, function () { TH.toast('Could not switch input'); }, 'MAIN');
    } catch (e) { TH.toast('Could not switch input'); }
  }

  TH.tuneChannel = function (dir) {
    if (!tz || !tz.tvchannel) { return TH.openSystem('channels'); }
    var fn = dir > 0 ? tz.tvchannel.tuneUp : tz.tvchannel.tuneDown;
    if (typeof fn !== 'function') { return TH.openSystem('channels'); }
    function afterTune() {
      var ch = TH.getChannelInfo();
      TH.showInputBanner((ch && ch.label) ? ch.label : ('Channel ' + (dir > 0 ? '+' : '-')));
    }
    try {
      fn.call(tz.tvchannel, afterTune, function () { TH.openSystem('channels'); }, 'MAIN');
    } catch (e) {
      TH.openSystem('channels');
    }
  };

  TH.watchingInput = function () { return watchingInput; };
  TH.leaveInput = function () {
    watchingInput = false;
    clearTimeout(bannerTimer);
    document.body.classList.remove('input');
    var box = document.getElementById('hdmi');
    if (box) { box.hidden = true; }
    try { tz.tvwindow.hide(function () {}, function () {}, 'MAIN'); } catch (e) { /* already hidden */ }
  };
})(window.TH);
