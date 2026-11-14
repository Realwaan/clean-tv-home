// Clean editorial home styles (1-5):
//   1 Cinema, 2 Guide, 3 Editorial, 4 Gallery, 5 Lounge.
// Builds DOM once per view switch; debounces 1080p backdrop decode on key repeat.
(function (TH) {
  'use strict';

  var el = TH.el;
  var bg = { front: null, back: null, url: '', timer: 0 };

  function showArt(url) {
    if (!bg.front) {
      bg.front = document.getElementById('bgA');
      bg.back = document.getElementById('bgB');
    }
    if (!url || url === bg.url) { return; }
    clearTimeout(bg.timer);
    bg.timer = setTimeout(function () {
      bg.url = url;
      var img = new Image();
      img.onload = function () {
        if (bg.url !== url) { return; }
        bg.back.style.backgroundImage = 'url("' + url + '")';
        bg.back.classList.add('on');
        bg.front.classList.remove('on');
        var t = bg.front; bg.front = bg.back; bg.back = t;
      };
      img.src = url;
    }, 80);
  }
  TH.hideArt = function () {
    clearTimeout(bg.timer);
    bg.url = '';
    if (bg.front) { bg.front.classList.remove('on'); }
    if (bg.back) { bg.back.classList.remove('on'); }
  };

  function tile(entry) {
    var t = el('div', 'tile');
    var head = el('div', 't-head');
    if (entry.logo && TH.LOGOS[entry.logo]) {
      var mark = el('span', 't-icon');
      mark.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="' + TH.LOGOS[entry.logo] + '"/></svg>';
      head.appendChild(mark);
    } else if (entry.icon) {
      var img = el('img', 't-icon-img');
      img.src = entry.icon;
      img.onerror = function () { img.remove(); };
      head.appendChild(img);
    } else if (entry.kind === 'hdmi') {
      var hdmiMark = el('span', 't-icon');
      hdmiMark.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="' + TH.LOGOS.tv + '"/></svg>';
      head.appendChild(hdmiMark);
    }
    var foot = el('div', 't-foot');
    foot.appendChild(el('span', 'name', entry.name));
    if (entry.sub) { foot.appendChild(el('span', 'sub', entry.sub)); }
    t.appendChild(head);
    t.appendChild(foot);
    return t;
  }

  function current(st) {
    var items = TH.art.items(st.entries[st.app], st.app);
    return items[st.item % items.length];
  }

  function copyBlock(includeSynopsis) {
    var box = el('div', 'copy');
    box.appendChild(el('span', 'kicker'));
    box.appendChild(el('p', 'big'));
    box.appendChild(el('span', includeSynopsis ? 'synopsis' : 'meta'));
    return box;
  }
  function fillCopy(box, kicker, title, detail) {
    box.children[0].textContent = kicker;
    box.children[1].textContent = title;
    box.children[2].textContent = detail;
  }

  // ---------- 1 Cinema ----------
  var cinema = {
    name: 'Cinema',
    rows: function (st) { return [st.entries.length]; },
    build: function (st, stage) {
      this.copy = copyBlock(true);
      this.row = el('div', 'row apps');
      this.tiles = st.entries.map(function (e) {
        var t = tile(e);
        this.row.appendChild(t);
        return t;
      }, this);
      stage.appendChild(this.copy);
      stage.appendChild(this.row);
    },
    focus: function (st) {
      var entry = st.entries[st.app], it = current(st);
      this.tiles.forEach(function (t, i) { t.classList.toggle('on', st.row === 1 && i === st.app); });
      var kicker = entry.name + (entry.sub ? ' · ' + entry.sub : '');
      var detail = entry.kind === 'tv' ? (it.synopsis || it.sub) : (it.sub + (it.genres ? ' · ' + it.genres : ''));
      fillCopy(this.copy, kicker, it.title, detail);
      showArt(it.backdrop);
    },
    activate: function (st) { return st.entries[st.app]; }
  };

  // ---------- 2 Guide ----------
  var guide = {
    name: 'Guide',
    rows: function (st) { return [st.entries.length, TH.art.items(st.entries[st.app], st.app).length]; },
    build: function (st, stage) {
      this.copy = copyBlock(false);
      var band = el('div', 'band');
      this.appRow = el('div', 'row apps');
      this.tiles = st.entries.map(function (e) {
        var t = tile(e);
        this.appRow.appendChild(t);
        return t;
      }, this);
      band.appendChild(this.appRow);
      this.trendLabel = el('span', 'label');
      band.appendChild(this.trendLabel);
      this.cardRow = el('div', 'row cards');
      band.appendChild(this.cardRow);
      stage.appendChild(this.copy);
      stage.appendChild(band);
      this.cardsFor = -1;
    },
    focus: function (st) {
      var entry = st.entries[st.app], items = TH.art.items(entry, st.app);
      if (this.cardsFor !== st.app) {
        this.cardsFor = st.app;
        this.cardRow.innerHTML = '';
        this.cards = items.map(function (it) {
          var c = el('div', 'card');
          c.style.backgroundImage = 'url("' + it.card + '")';
          var cap = el('div', 'card-copy');
          cap.appendChild(el('span', 'card-title', it.title));
          cap.appendChild(el('span', 'card-sub', it.genres || it.sub));
          c.appendChild(cap);
          this.cardRow.appendChild(c);
          return c;
        }, this);
        this.trendLabel.textContent = entry.kind === 'tv'
          ? 'Broadcast Tools & Tuner'
          : (entry.key === 'movy' ? 'Direct on movy.sx' : (TH.art.live ? 'Featured on ' + entry.name : 'Selected Works'));
      }
      var it = st.row === 2 ? items[st.col] : current(st);
      this.tiles.forEach(function (t, i) {
        t.classList.toggle('on', st.row === 1 && i === st.app);
        t.classList.toggle('sel', i === st.app);
      });
      this.cards.forEach(function (c, i) { c.classList.toggle('on', st.row === 2 && i === st.col); });
      fillCopy(this.copy, entry.name + (entry.sub ? ' · ' + entry.sub : ''), it.title, it.synopsis || it.sub);
      showArt(it.backdrop);
    },
    activate: function (st) {
      var entry = st.entries[st.app];
      if (st.row === 2) {
        var items = TH.art.items(entry, st.app);
        var target = items[st.col];
        if (target && target.url) { TH.openUrl(target.url); return null; }
        if (entry.kind === 'tv') {
          if (!target || target.action === 'watch') { return entry; }
          TH.openTvApp(target.action);
          return null;
        }
      }
      return entry;
    }
  };

  // ---------- 3 Editorial ----------
  var editorial = {
    name: 'Editorial',
    rows: function (st) { return st.entries.map(function (e, i) { return TH.art.items(e, i).length; }); },
    build: function (st, stage) {
      TH.hideArt();
      this.list = el('div', 'ed-list');
      this.items = st.entries.map(function (e) {
        var row = el('div', 'ed-item');
        row.appendChild(el('span', 'ed-title', e.name));
        row.appendChild(el('span', 'ed-sub', e.sub || 'Open'));
        this.list.appendChild(row);
        return row;
      }, this);

      this.frame = el('div', 'ed-frame');

      this.caption = el('div', 'ed-caption');
      var capMain = el('div', 'ed-cap-main');
      this.cKicker = el('span', 'kicker');
      this.cTitle = el('span', 'ed-cap-title');
      this.cSyn = el('span', 'ed-cap-syn');
      capMain.appendChild(this.cKicker);
      capMain.appendChild(this.cTitle);
      capMain.appendChild(this.cSyn);
      this.cMeta = el('div', 'ed-cap-meta');
      this.caption.appendChild(capMain);
      this.caption.appendChild(this.cMeta);

      stage.appendChild(this.list);
      stage.appendChild(this.frame);
      stage.appendChild(this.caption);
      this.frameUrl = '';
    },
    focus: function (st) {
      var idx = st.row >= 1 ? Math.min(st.row - 1, st.entries.length - 1) : st.app;
      st.app = idx;
      var entry = st.entries[idx];
      var items = TH.art.items(entry, idx);
      var itemIdx = st.row >= 1 ? (st.col % items.length) : (st.item % items.length);
      var it = items[itemIdx];

      this.items.forEach(function (n, i) { n.classList.toggle('on', st.row >= 1 && i === idx); });
      if (it.backdrop && it.backdrop !== this.frameUrl) {
        this.frameUrl = it.backdrop;
        this.frame.style.backgroundImage = 'url("' + it.backdrop + '")';
      }
      this.cKicker.textContent = entry.name + ' · ' + (it.genres || it.sub);
      this.cTitle.textContent = it.title;
      this.cSyn.textContent = it.synopsis || it.sub;
      this.cMeta.textContent = (itemIdx + 1) + ' / ' + items.length + '\n' + (it.rating ? it.sub + ' · ' + it.rating : it.sub);
    },
    activate: function (st) {
      var entry = st.entries[st.app];
      var items = TH.art.items(entry, st.app);
      var it = items[st.col % items.length];
      if (it && it.url) { TH.openUrl(it.url); return null; }
      if (entry.kind === 'tv' && it && it.action && it.action !== 'watch') {
        TH.openTvApp(it.action);
        return null;
      }
      return entry;
    }
  };

  // ---------- 4 Gallery ----------
  var gallery = {
    name: 'Gallery',
    rows: function (st) { return [st.entries.length]; },
    build: function (st, stage) {
      TH.hideArt();
      var posters = [];
      st.entries.forEach(function (e, i) {
        TH.art.items(e, i).forEach(function (it) {
          if (it.poster && posters.indexOf(it.poster) < 0) { posters.push(it.poster); }
        });
      });
      var wallEl = document.getElementById('wall');
      wallEl.innerHTML = '';
      for (var c = 0; c < 6; c++) {
        var col = el('div', 'col');
        var list = [];
        for (var p = 0; p < 5; p++) { list.push(posters[(c * 5 + p * 7) % posters.length]); }
        list.concat(list).forEach(function (src) {
          var img = el('div', 'poster');
          img.style.backgroundImage = 'url("' + src + '")';
          col.appendChild(img);
        });
        wallEl.appendChild(col);
      }
      var title = el('div', 'gal-title');
      this.day = el('p', 'big');
      this.meta = el('span', 'meta');
      title.appendChild(this.day);
      title.appendChild(this.meta);

      this.dock = el('div', 'row apps gal-dock');
      this.tiles = st.entries.map(function (e) {
        var t = tile(e);
        this.dock.appendChild(t);
        return t;
      }, this);
      stage.appendChild(title);
      stage.appendChild(this.dock);
    },
    focus: function (st) {
      var w = TH.feeds.getWeather();
      this.day.textContent = new Date().toLocaleDateString([], { weekday: 'long' });
      this.meta.textContent = (w.temp && w.temp !== '--')
        ? (w.city + ' · ' + w.temp + '° ' + w.desc)
        : (TH.art.live ? 'Now Playing' : 'Evening Collection');
      this.tiles.forEach(function (t, i) { t.classList.toggle('on', st.row === 1 && i === st.app); });
    },
    activate: function (st) { return st.entries[st.app]; }
  };

  // ---------- 5 Lounge ----------
  var lounge = {
    name: 'Lounge',
    idx: 0,
    rows: function (st) { return [st.entries.length]; },
    build: function (st, stage) {
      TH.hideArt();
      this.shift = el('div', 'lounge-shift');
      var main = el('div', 'lounge-main');
      this.bigClock = el('div', 'lounge-clock');
      this.dateLine = el('div', 'lounge-date');

      var brief = el('div', 'lounge-brief');
      this.bKicker = el('span', 'kicker', 'WORLD BRIEFING');
      this.bHeadline = el('span', 'lounge-headline', '');
      brief.appendChild(this.bKicker);
      brief.appendChild(this.bHeadline);

      main.appendChild(this.bigClock);
      main.appendChild(this.dateLine);
      main.appendChild(brief);

      this.appWrap = el('div', 'lounge-apps');
      this.appRow = el('div', 'row apps');
      this.tiles = st.entries.map(function (e) {
        var t = tile(e);
        this.appRow.appendChild(t);
        return t;
      }, this);
      this.appWrap.appendChild(this.appRow);

      this.shift.appendChild(main);
      this.shift.appendChild(this.appWrap);
      stage.appendChild(this.shift);
    },
    focus: function (st) {
      var now = new Date();
      var w = TH.feeds.getWeather();
      var items = TH.feeds.getPulse();
      var cur = items[this.idx % items.length];

      var mins = now.getMinutes();
      var sx = Math.round(Math.sin(mins * 0.5) * 10);
      var sy = Math.round(Math.cos(mins * 0.5) * 6);
      this.shift.style.transform = 'translate3d(' + sx + 'px, ' + sy + 'px, 0)';

      this.bigClock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      var dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
      this.dateLine.textContent = dateStr + (w.temp && w.temp !== '--' ? ' · ' + w.city.toUpperCase() + ' ' + w.temp + '° ' + w.desc.toUpperCase() : '');
      this.bKicker.textContent = cur.source.toUpperCase() + (cur.meta ? ' · ' + cur.meta.toUpperCase() : '');
      this.bHeadline.textContent = cur.title;

      this.appWrap.classList.toggle('active', st.row === 1);
      this.tiles.forEach(function (t, i) { t.classList.toggle('on', st.row === 1 && i === st.app); });
    },
    activate: function (st) { return st.entries[st.app]; }
  };

  TH.styles = { cinema: cinema, guide: guide, editorial: editorial, gallery: gallery, lounge: lounge };
  TH.styleOrder = ['cinema', 'guide', 'editorial', 'gallery', 'lounge'];
})(window.TH);
