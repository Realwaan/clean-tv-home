// Show art & scraped show metadata.
// With a TMDB key: US trending shows. Without one: keyless live 1080p show art, ratings,
// genres, synopses & cast via TVMaze (12 h cache). Offline fallback: Art Institute of Chicago (CC0).
(function (TH) {
  'use strict';

  var API = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';
  var TVMAZE = 'https://api.tvmaze.com';
  var KEY = window.TVHOME_TMDB_KEY || '';
  var CACHE = KEY ? 'tvhome.tmdb.v3' : 'tvhome.live.v2';
  var TTL = 12 * 3600 * 1000;

  var SOURCES = {
    netflix: { provider: 8, network: 213 },
    youtube: { trending: 'all/week' },
    spotify: { trending: 'tv/day' },
    hdmi: { trending: 'movie/week' },
    other: { trending: 'tv/day' }
  };

  var TV_CARDS = [
    {
      id: 'tv-watch',
      media: 'tv',
      action: 'watch',
      title: 'Live Terrestrial Broadcast',
      sub: 'Antenna · Full Screen',
      rating: 'DTV',
      genres: 'Over the Air',
      synopsis: 'Switch to the live terrestrial television tuner. Use CH+/CH- or Up/Down to change channels, or press Enter for the channel list.',
      backdrop: 'art/train.jpg',
      card: 'art/train.jpg',
      poster: 'art/train.jpg'
    },
    {
      id: 'tv-channels',
      media: 'tv',
      action: 'channels',
      title: 'Channel List',
      sub: 'Terrestrial Directory',
      rating: 'EPG',
      genres: 'Digital Channels',
      synopsis: 'Browse all tuned local digital and analog terrestrial television channels.',
      backdrop: 'art/beach.jpg',
      card: 'art/beach.jpg',
      poster: 'art/beach.jpg'
    },
    {
      id: 'tv-guide',
      media: 'tv',
      action: 'guide',
      title: 'Broadcast Guide',
      sub: 'On Air Schedule',
      rating: 'Schedule',
      genres: 'Program Guide',
      synopsis: 'Open the electronic program guide (EPG) for local broadcast stations.',
      backdrop: 'art/lilies.jpg',
      card: 'art/lilies.jpg',
      poster: 'art/lilies.jpg'
    },
    {
      id: 'tv-scan',
      media: 'tv',
      action: 'scan',
      title: 'Channel Tuning',
      sub: 'Auto Scan',
      rating: 'Tuner',
      genres: 'Antenna Setup',
      synopsis: 'Scan or manage local over-the-air terrestrial antenna channels.',
      backdrop: 'art/wave.jpg',
      card: 'art/wave.jpg',
      poster: 'art/wave.jpg'
    }
  ];

  var MOVY_CARDS = [
    {
      id: 'movy-home',
      media: 'movie',
      url: 'https://www.movy.sx/',
      title: 'Movy Featured',
      sub: 'movy.sx · Instant Play',
      rating: 'HD',
      genres: 'Free Cinema',
      synopsis: 'Open movy.sx directly. For zero ads: click the top-right Profile icon on movy.sx and toggle "Show ads" OFF, or set TV DNS to 94.140.14.14.',
      backdrop: 'art/rain.jpg',
      card: 'art/rain.jpg',
      poster: 'art/rain.jpg'
    },
    {
      id: 'movy-movies',
      media: 'movie',
      url: 'https://www.movy.sx/browse/movie',
      title: 'Movies Catalog',
      sub: 'movy.sx/browse/movie',
      rating: 'Films',
      genres: '4K & HD Films',
      synopsis: 'Browse the full Movy movie library including 4K and newly released films.',
      backdrop: 'art/jatte.jpg',
      card: 'art/jatte.jpg',
      poster: 'art/jatte.jpg'
    },
    {
      id: 'movy-tv',
      media: 'tv',
      url: 'https://www.movy.sx/browse/tv',
      title: 'TV Series',
      sub: 'movy.sx/browse/tv',
      rating: 'Series',
      genres: 'Full Seasons',
      synopsis: 'Stream full seasons and trending television series directly on movy.sx.',
      backdrop: 'art/bedroom.jpg',
      card: 'art/bedroom.jpg',
      poster: 'art/bedroom.jpg'
    },
    {
      id: 'movy-anime',
      media: 'tv',
      url: 'https://www.movy.sx/browse/anime',
      title: 'Anime Collection',
      sub: 'movy.sx/browse/anime',
      rating: 'Anime',
      genres: 'Sub & Dub',
      synopsis: 'Open the Movy anime directory for subbed and dubbed anime series and films.',
      backdrop: 'art/pond.jpg',
      card: 'art/pond.jpg',
      poster: 'art/pond.jpg'
    }
  ];

  // Verified TVMaze flagship shows per app key, merged with live TVMaze schedule shows.
  var SEEDS = {
    youtube: [46562, 49041, 37336, 44933],
    spotify: [44458, 41007, 17861, 35951],
    netflix: [2993, 53647, 43687, 55138, 17861],
    movy: [38052, 37336, 43031, 52341],
    hdmi: [38963, 52341, 43031, 15299],
    other: [38052, 37336, 43031, 52341]
  };

  var PAINTINGS = [
    ['rain', 'Paris Street; Rainy Day', 'Gustave Caillebotte, 1877'],
    ['wave', 'Under the Wave off Kanagawa', 'Katsushika Hokusai, about 1830'],
    ['jatte', 'A Sunday on La Grande Jatte', 'Georges Seurat, 1884'],
    ['bedroom', 'The Bedroom', 'Vincent van Gogh, 1889'],
    ['train', 'Arrival of the Normandy Train', 'Claude Monet, 1877'],
    ['beach', 'The Beach at Sainte-Adresse', 'Claude Monet, 1867'],
    ['wheat', 'Stacks of Wheat', 'Claude Monet, 1890'],
    ['acrobats', 'Acrobats at the Cirque Fernando', 'Pierre-Auguste Renoir, 1879'],
    ['lilies', 'Water Lilies', 'Claude Monet, 1906'],
    ['pond', 'Water Lily Pond', 'Claude Monet, 1900']
  ];
  var FALLBACK_CAST = { name: 'Vincent van Gogh', character: '', note: 'Self-Portrait, 1887', profile: 'art/selfie.jpg' };

  var data = TH.load(CACHE, null);
  var art = TH.art = { live: !!(data && data.items && Object.keys(data.items).length) };

  function cleanText(html, maxLen) {
    if (!html) { return ''; }
    var txt = String(html)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;|&rsquo;|&lsquo;/g, "'")
      .replace(/&ldquo;|&rdquo;/g, '"')
      .replace(/&ndash;|&mdash;/g, '-')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (txt.normalize) { try { txt = txt.normalize('NFKC'); } catch (e) {} }
    if (maxLen && txt.length > maxLen) {
      txt = txt.slice(0, maxLen - 3).replace(/\s+\S*$/, '') + '...';
    }
    return txt;
  }
  TH.cleanText = cleanText;

  function fallback(index) {
    var items = [];
    for (var i = 0; i < 4; i++) {
      var p = PAINTINGS[(index * 3 + i) % PAINTINGS.length];
      items.push({
        id: 'art-' + p[0],
        title: p[1],
        sub: p[2],
        rating: 'CC0',
        genres: 'Fine Art',
        synopsis: 'Public-domain artwork from the Art Institute of Chicago collection.',
        backdrop: 'art/' + p[0] + '.jpg',
        card: 'art/' + p[0] + '.jpg',
        poster: 'art/' + p[0] + '.jpg'
      });
    }
    return items;
  }

  art.items = function (entry, index) {
    if (entry && entry.kind === 'tv') {
      var ch = TH.getChannelInfo && TH.getChannelInfo();
      return TV_CARDS.map(function (c, i) {
        if (i === 0 && ch && ch.label) {
          return {
            id: c.id, media: c.media, action: c.action,
            title: ch.label,
            sub: 'Terrestrial · Full Screen',
            rating: c.rating, genres: c.genres, synopsis: c.synopsis,
            backdrop: c.backdrop, card: c.card, poster: c.poster
          };
        }
        return c;
      });
    }
    if (entry && entry.key === 'movy') {
      var bgList = (data && data.items && (data.items.movy || data.items.other)) || [];
      return MOVY_CARDS.map(function (c, i) {
        var pic = bgList[i];
        if (!pic) { return c; }
        return {
          id: c.id, media: c.media, url: c.url,
          title: c.title, sub: c.sub, rating: c.rating, genres: c.genres, synopsis: c.synopsis,
          backdrop: pic.backdrop || c.backdrop,
          card: pic.card || c.card,
          poster: pic.poster || c.poster
        };
      });
    }
    var list = data && data.items && data.items[entry.key];
    return list && list.length ? list : fallback(index || 0);
  };

  function getJson(url, headers, timeoutMs, done) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    if (headers) {
      for (var k in headers) { x.setRequestHeader(k, headers[k]); }
    }
    x.timeout = timeoutMs || 8000;
    x.onload = function () {
      if (x.status !== 200) { return done(null); }
      try { done(JSON.parse(x.responseText)); } catch (e) { done(null); }
    };
    x.onerror = x.ontimeout = function () { done(null); };
    x.send();
  }
  TH.getJson = getJson;

  function get(path, done) {
    var bearer = KEY.indexOf('eyJ') === 0;
    var url = API + path + (bearer ? '' : (path.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + encodeURIComponent(KEY));
    getJson(url, bearer ? { Authorization: 'Bearer ' + KEY } : null, 8000, done);
  }

  function toItem(r, media) {
    if (!r.backdrop_path || !r.poster_path) { return null; }
    var year = (r.first_air_date || r.release_date || '').slice(0, 4);
    var type = (r.media_type || media) === 'tv' ? 'Series' : 'Movie';
    return {
      id: r.id, media: r.media_type || media, title: r.name || r.title,
      sub: type + (year ? ' · ' + year : ''),
      rating: r.vote_average ? Number(r.vote_average).toFixed(1) : '8.0',
      genres: 'Trending',
      synopsis: cleanText(r.overview || '', 220),
      popularity: r.popularity || 0,
      backdrop: IMG + 'w1280' + r.backdrop_path, card: IMG + 'w300' + r.backdrop_path,
      poster: IMG + 'w342' + r.poster_path
    };
  }

  function daysAgo(n) { return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); }

  function rotate(list, count) {
    if (!list.length) { return []; }
    var start = Math.floor(Date.now() / 864e5) * 3 % list.length;
    return list.slice(start).concat(list.slice(0, start)).slice(0, count);
  }

  function fetchSource(source, done) {
    var calls = source.provider ? [
      ['tv', '/discover/tv?sort_by=popularity.desc&air_date.gte=' + daysAgo(60) + '&with_networks=' + source.network],
      ['movie', '/discover/movie?watch_region=US&sort_by=popularity.desc&include_adult=false' +
        '&with_watch_monetization_types=flatrate&vote_count.gte=50&primary_release_date.gte=' + daysAgo(365) +
        '&with_watch_providers=' + source.provider]
    ] : [[null, '/trending/' + source.trending]];
    var left = calls.length, all = [];
    calls.forEach(function (c) {
      get(c[1], function (res) {
        ((res && res.results) || []).forEach(function (r) {
          var item = toItem(r, c[0] || r.media_type);
          if (item && (item.media === 'tv' || item.media === 'movie')) { all.push(item); }
        });
        if (--left === 0) {
          all.sort(function (a, b) { return b.popularity - a.popularity; });
          done(rotate(all.slice(0, 16), 8));
        }
      });
    });
  }

  function channelKey(show) {
    var wc = ((show.webChannel && show.webChannel.name) || (show.network && show.network.name) || '').toLowerCase();
    if (wc.indexOf('netflix') >= 0) { return 'netflix'; }
    if (wc.indexOf('youtube') >= 0) { return 'youtube'; }
    return 'other';
  }

  function toTvMazeItem(show) {
    var emb = show._embedded || {};
    var imgs = emb.images || [];
    var bgs = imgs.filter(function (im) { return im.type === 'background' && im.resolutions && im.resolutions.original; });
    var posterUrl = (show.image && (show.image.medium || show.image.original)) || '';
    if (!bgs.length) { return null; }
    var bgUrl = bgs[0].resolutions.original.url;
    var cardUrl = (bgs[0].resolutions.medium && bgs[0].resolutions.medium.url) || bgUrl;
    var castList = (emb.cast || []).filter(function (c) { return c.person && c.person.image && (c.person.image.original || c.person.image.medium); });
    var lead = castList.length ? {
      name: castList[0].person.name,
      character: (castList[0].character && castList[0].character.name) || '',
      profile: castList[0].person.image.original || castList[0].person.image.medium
    } : null;
    var year = (show.premiered || '').slice(0, 4);
    var chan = (show.webChannel && show.webChannel.name) || (show.network && show.network.name) || 'Series';
    var rating = (show.rating && show.rating.average) ? Number(show.rating.average).toFixed(1) : '8.5';
    var genres = (show.genres && show.genres.length) ? show.genres.slice(0, 2).join(' · ') : 'Trending';
    var synopsis = cleanText(show.summary || '', 220) || ('Streaming series on ' + chan + (year ? ' (' + year + ')' : '') + '.');
    return {
      id: show.id, media: 'tv', title: show.name,
      sub: chan + (year ? ' · ' + year : ''),
      rating: rating,
      genres: genres,
      synopsis: synopsis,
      status: show.status || 'Running',
      popularity: show.weight || 0,
      backdrop: bgUrl, card: cardUrl, poster: posterUrl || cardUrl,
      cast: lead
    };
  }

  function fetchLiveTvMaze(keys, done) {
    var sched = { netflix: [], youtube: [], other: [] };
    var left = 2;
    function collect(ep) {
      var sh = (ep._embedded && ep._embedded.show) || ep.show;
      if (!sh || !sh.id || !sh.image) { return; }
      var k = channelKey(sh);
      if (sched[k] && sched[k].indexOf(sh.id) < 0) { sched[k].push(sh.id); }
      if ((sh.weight || 0) >= 85 && sched.other.indexOf(sh.id) < 0) { sched.other.push(sh.id); }
    }
    function buildPlan() {
      var plan = {}, unique = [];
      keys.forEach(function (k) {
        var combined = (sched[k] || []).slice(0, 2).concat(SEEDS[k] || SEEDS.other);
        var ids = [];
        combined.forEach(function (id) {
          if (ids.indexOf(id) < 0 && ids.length < 6) {
            ids.push(id);
            if (unique.indexOf(id) < 0) { unique.push(id); }
          }
        });
        plan[k] = ids;
      });
      var fetched = {}, idx = 0, active = 0, finished = 0;
      if (!unique.length) { return done(null); }
      function finishAll() {
        var next = { at: Date.now(), items: {} }, got = 0;
        keys.forEach(function (k) {
          var list = [];
          plan[k].forEach(function (id) { if (fetched[id]) { list.push(fetched[id]); } });
          if (list.length) {
            next.items[k] = rotate(list, 6);
            got++;
          }
        });
        done(got ? next : null);
      }
      function pump() {
        while (active < 3 && idx < unique.length) {
          (function (showId) {
            active++;
            getJson(TVMAZE + '/shows/' + showId + '?embed[]=images&embed[]=cast', null, 8000, function (show) {
              active--;
              finished++;
              if (show && show.id) {
                var item = toTvMazeItem(show);
                if (item) { fetched[showId] = item; }
              }
              if (finished === unique.length) { finishAll(); }
              else { setTimeout(pump, 120); }
            });
          })(unique[idx++]);
        }
      }
      pump();
    }
    getJson(TVMAZE + '/schedule/web', null, 8000, function (res) {
      if (Array.isArray(res)) { res.forEach(collect); }
      if (--left === 0) { buildPlan(); }
    });
    getJson(TVMAZE + '/schedule?country=US', null, 8000, function (res) {
      if (Array.isArray(res)) { res.slice(0, 30).forEach(collect); }
      if (--left === 0) { buildPlan(); }
    });
  }

  var busy = false;
  art.refresh = function (entries, done) {
    if (busy) { return done(false); }
    if (data && Date.now() - data.at < TTL) {
      art.live = !!(data.items && Object.keys(data.items).length);
      return done(false);
    }
    busy = true;
    var keys = [];
    entries.forEach(function (e) { if (e.kind !== 'tv' && keys.indexOf(e.key) < 0) { keys.push(e.key); } });
    if (!KEY) {
      fetchLiveTvMaze(keys, function (next) {
        busy = false;
        if (!next) { return done(false); }
        data = next;
        art.live = true;
        TH.save(CACHE, data);
        done(true);
      });
      return;
    }
    var next = { at: Date.now(), items: {} }, left = keys.length, got = 0;
    keys.forEach(function (k) {
      fetchSource(SOURCES[k] || SOURCES.other, function (items) {
        if (items.length) { next.items[k] = items; got++; }
        if (--left === 0) {
          busy = false;
          if (!got) { return done(false); }
          data = next;
          art.live = true;
          TH.save(CACHE, data);
          done(true);
        }
      });
    });
  };

  art.preload = function (entries) {
    entries.forEach(function (e, i) { new Image().src = art.items(e, i)[0].backdrop; });
  };

  art.cast = function (item, done) {
    if (item.cast) { return done(item.cast); }
    if (!KEY || !item.id) { return done(FALLBACK_CAST); }
    get('/' + item.media + '/' + item.id + '/credits', function (res) {
      var people = ((res && res.cast) || []).filter(function (p) { return p.profile_path; });
      if (!people.length) { return done(null); }
      var p = people[0];
      item.cast = { name: p.name, character: p.character || '', profile: IMG + 'w500' + p.profile_path };
      TH.save(CACHE, data);
      done(item.cast);
    });
  };

  art.credit = function () {
    if (KEY) { return 'Imagery via TMDB'; }
    return art.live
      ? 'Show imagery via TVMaze (CC BY-SA)'
      : 'Art Institute of Chicago (CC0)';
  };
})(window.TH);
