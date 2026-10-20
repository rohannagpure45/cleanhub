// A stand-in for the TV's `tizen` object, for previewing in a desktop browser.
// Loaded before the app's own scripts by workbench/server.mjs.
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var scenario = params.get('apps') || 'typical';

  var APPS = {
    // Ids as 2022 Samsung sets report them, noise included.
    typical: [
      { id: 'org.tizen.netflix-app', name: 'Netflix' },
      { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube' },
      { id: 'com.samsung.tv.cobalt-yt', name: 'YouTube' },
      { id: 'org.tizen.primevideo', name: 'Prime Video' },
      { id: 'org.tizen.primevideo-dummy', name: 'Prime Video' },
      { id: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+' },
      { id: 'MCmYXNxgcu.DisneyPlusService', name: 'Disney+' },
      { id: '5b8c3eb16b.BeamCTVDev', name: 'Max' },
      { id: '3KA0pm7a7V.TubiTV', name: 'Tubi' },
      { id: 'kIciSQlYEM.plex', name: 'Plex' },
      { id: 'rJeHak5zRg.Spotify', name: 'Spotify' },
      { id: 'rJeHak5zRg.SpotifyService', name: 'Spotify' },
      { id: 'org.tizen.browser', name: 'Internet' },
      { id: 'abc123defg.WeatherNow', name: 'Weather Now' },
      { id: 'com.samsung.tv.store', name: 'Apps' },
      { id: 'com.samsung.tv.csfs', name: 'Smart Hub', show: false },
      { id: 'adplatform.ADPlayer', name: 'ADPlayer' },
      { id: '25emanual3.emanual', name: 'e-Manual' },
      { id: 'org.tizen.voice-service', name: 'Voice' },
      { id: 'CleanHub01.Launcher', name: 'Clean Hub' }
    ],
    many: [],
    none: [],
    unknown: [
      { id: 'aaaaaaaaaa.One', name: 'Alpha Radio' },
      { id: 'bbbbbbbbbb.Two', name: 'Beta News' }
    ]
  };
  for (var i = 0; i < 30; i++) {
    APPS.many.push({ id: 'many' + ('000000' + i).slice(-6) + '.App', name: 'Channel ' + (i + 1) });
  }
  // A dead callback, as some TVs do: ?hang=1 never answers getAppsInfo.
  var hang = params.get('hang') === '1';
  APPS.many = APPS.typical.concat(APPS.many);

  var launches = [];
  var failList = (params.get('fail') || '').split(',');

  function info(a) {
    return { id: a.id, name: a.name, iconPath: a.iconPath || '', show: a.show !== false, version: '1.0.0' };
  }

  window.__mock = {
    launches: launches,
    apps: APPS[scenario] || APPS.typical,
    listFails: params.get('listFail') === '1',
    // Simulates the viewer coming back to the launcher from another app.
    returnFromApp: function () {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  };

  window.tizen = {
    application: {
      getAppsInfo: function (ok, fail) {
        if (hang) return;
        setTimeout(function () {
          if (window.__mock.listFails) {
            fail({ name: 'SecurityError', message: 'Permission denied' });
            return;
          }
          ok(window.__mock.apps.map(info));
        }, 30);
      },
      launch: function (id, ok, fail) {
        setTimeout(function () {
          if (failList.indexOf(id) !== -1) {
            fail({ name: 'NotFoundError', message: 'No such app' });
            return;
          }
          launches.push(id);
          ok();
        }, 20);
      },
      getCurrentApplication: function () {
        return { exit: function () {}, hide: function () {} };
      }
    },
    tvinputdevice: {
      registerKey: function () {},
      getSupportedKeys: function () { return []; }
    }
  };
})();
