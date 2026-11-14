// Local weather (ipwho.is + wttr.in) and world briefing (BBC World RSS), cached for 30 minutes.
(function (TH) {
  'use strict';

  var WEATHER_KEY = 'tvhome.weather.v1';
  var PULSE_KEY = 'tvhome.pulse.v2';
  var TTL = 30 * 60 * 1000;

  var weatherCache = TH.load(WEATHER_KEY, null);
  var pulseCache = TH.load(PULSE_KEY, null);

  var DEFAULT_WEATHER = {
    at: 0,
    city: 'Cebu',
    temp: '--',
    feels: '--',
    humidity: '--',
    desc: '',
    days: []
  };

  var DEFAULT_PULSE = [
    { source: 'BBC World', title: 'World briefing updates automatically once connected.', meta: 'Standby' }
  ];

  function clean(s, maxLen) {
    return TH.cleanText ? TH.cleanText(s, maxLen) : String(s || '').trim();
  }

  function refreshWeather(done) {
    if (weatherCache && Date.now() - weatherCache.at < TTL && weatherCache.temp !== '--') {
      return done && done(false);
    }
    TH.getJson('https://ipwho.is/', null, 6000, function (geo) {
      var city = (geo && geo.city) ? clean(geo.city, 40) : 'Cebu City';
      TH.getJson('https://wttr.in/' + encodeURIComponent(city) + '?format=j1', null, 7000, function (w) {
        var cur = w && w.current_condition && w.current_condition[0];
        if (!cur) { return done && done(false); }
        var days = (w.weather || []).slice(0, 3).map(function (d, idx) {
          var label = idx === 0 ? 'Today' : idx === 1 ? 'Tomorrow' : String(d.date || '').slice(5);
          return {
            label: label,
            max: clean(d.maxtempC, 6),
            min: clean(d.mintempC, 6)
          };
        });
        weatherCache = {
          at: Date.now(),
          city: city,
          temp: clean(cur.temp_C, 6) || '--',
          feels: clean(cur.FeelsLikeC, 6) || '--',
          humidity: clean(cur.humidity, 6) || '--',
          desc: clean((cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value) || 'Clear', 40),
          days: days
        };
        TH.save(WEATHER_KEY, weatherCache);
        if (TH.tickClock) { TH.tickClock(); }
        if (done) { done(true); }
      });
    });
  }

  function refreshPulse(done) {
    if (pulseCache && Date.now() - pulseCache.at < TTL && pulseCache.items && pulseCache.items.length > 0) {
      return done && done(false);
    }
    TH.getJson('https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffeeds.bbci.co.uk%2Fnews%2Fworld%2Frss.xml', null, 7000, function (res) {
      var list = (res && res.items) || [];
      var bbcItems = list.slice(0, 6).map(function (it) {
        return {
          source: 'BBC World',
          title: clean(it.title, 120),
          meta: clean((it.pubDate || '').slice(0, 16), 30),
          url: it.link || ''
        };
      }).filter(function (it) { return it.title; });
      if (!bbcItems.length) { return done && done(false); }
      pulseCache = { at: Date.now(), items: bbcItems };
      TH.save(PULSE_KEY, pulseCache);
      if (done) { done(true); }
    });
  }

  TH.feeds = {
    getWeather: function () {
      return weatherCache || DEFAULT_WEATHER;
    },
    getPulse: function () {
      return (pulseCache && pulseCache.items && pulseCache.items.length) ? pulseCache.items : DEFAULT_PULSE;
    },
    refreshAll: function (onUpdate) {
      var changed = false, left = 2;
      function doneOne(ok) {
        if (ok) { changed = true; }
        if (--left === 0 && changed && onUpdate) { onUpdate(); }
      }
      refreshWeather(doneOne);
      refreshPulse(doneOne);
    }
  };
})(window.TH);
