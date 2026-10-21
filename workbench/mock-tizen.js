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
  // Slow or dead TVs: ?hang=1 never answers getAppsInfo, ?delay=<ms> answers
  // late, ?hold=1 waits for __mock.release(). ?launchHang=1 never calls back.
  var hang = params.get('hang') === '1';
  var delay = Number(params.get('delay') || 30);
  var hold = params.get('hold') === '1';
  var launchHang = params.get('launchHang') === '1';
  var held = [];
  APPS.many = APPS.typical.concat(APPS.many);

  var launches = [];
  var failList = (params.get('fail') || '').split(',');

  function info(a) {
    return { id: a.id, name: a.name, iconPath: a.iconPath || '', show: a.show !== false, version: '1.0.0' };
  }

  window.__mock = {
    launches: launches,
    appControls: [], // what the page asked the Fire TV service, as { id, data }
    ports: {}, // local message port listeners, by name
    sources: [],
    hidden: 0,
    inputQueries: 0,
    apps: APPS[scenario] || APPS.typical,
    listFails: params.get('listFail') === '1',
    // Simulates another app taking the screen, and the viewer coming back.
    goHidden: function () {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    },
    returnFromApp: function () {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    },
    // With ?hold=1: answers every pending getAppsInfo call now.
    release: function () {
      var pending = held.splice(0);
      pending.forEach(function (fn) { fn(); });
    },
    // Plays the Fire TV service's answer, e.g. { package, state: 'unreachable' }.
    fireTvAnswer: function (result) {
      var listener = window.__mock.ports.firetv;
      if (listener) listener([{ key: 'result', value: JSON.stringify(result) }]);
    }
  };

  window.tizen = {
    ApplicationControl: function (operation, uri, mime, category, data) {
      this.operation = operation;
      this.data = data || [];
    },
    ApplicationControlData: function (key, value) {
      this.key = key;
      this.value = value;
    },
    // ?fireTvFail=1: the Fire TV service won't start.
    messageport: {
      requestLocalMessagePort: function (name) {
        return {
          addMessagePortListener: function (fn) {
            window.__mock.ports[name] = fn;
            return 1;
          }
        };
      }
    },
    application: {
      launchAppControl: function (control, id, ok, fail) {
        setTimeout(function () {
          if (params.get('fireTvFail') === '1') {
            fail({ name: 'NotFoundError', message: 'No such app' });
            return;
          }
          var data = {};
          control.data.forEach(function (d) { data[d.key] = d.value; });
          window.__mock.appControls.push({ id: id, operation: control.operation, data: data });
          ok();
        }, 10);
      },
      getAppsInfo: function (ok, fail) {
        if (hang) return;
        function answer() {
          if (window.__mock.listFails) {
            fail({ name: 'SecurityError', message: 'Permission denied' });
            return;
          }
          ok(window.__mock.apps.map(info));
        }
        if (hold) held.push(answer);
        else setTimeout(answer, delay);
      },
      launch: function (id, ok, fail) {
        if (launchHang) {
          launches.push(id);
          return;
        }
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
        return {
          exit: function () {},
          hide: function () { window.__mock.hidden++; }
        };
      }
    },
    // Inputs as the QN85B reported them: devices on HDMI 2 and HDMI 4.
    systeminfo: {
      getPropertyValue: function (prop, ok, fail) {
        if (params.get('inputHang') === '1') return;
        setTimeout(function () {
          if (prop !== 'VIDEOSOURCE') { fail({ name: 'NotSupportedError', message: prop }); return; }
          window.__mock.inputQueries++;
          const src = function (type, number) { return { type: type, number: number, __fromTV: true }; };
          ok({
            connected: [src('TV', 1), src('HDMI', 2), src('HDMI', 4)],
            disconnected: [src('HDMI', 1), src('HDMI', 3)]
          });
        }, Number(params.get('inputDelay') || 10)); // the QN85B takes ~3300 ms
      }
    },
    tvwindow: {
      setSource: function (source, ok, fail) {
        if (params.get('sourceHang') === '1') return;
        // Like the TV, only its own input objects are accepted.
        if (!source || !source.__fromTV) throw new TypeError('TypeMismatchError: Cannot convert to SystemInfoVideoSourceInfo');
        setTimeout(function () {
          if (params.get('sourceFail') === '1') { fail({ name: 'SecurityError', message: 'Permission denied' }); return; }
          window.__mock.sources.push(source.type + ' ' + source.number);
          ok(source, 'MAIN');
        }, 10);
      }
    },
    tvinputdevice: {
      registerKey: function () {},
      getSupportedKeys: function () { return []; }
    }
  };
})();
