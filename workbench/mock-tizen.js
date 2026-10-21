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

  // The Home watcher's side: what the page told it, by app control (or, with
  // ?homeDown=1 for the message port, still by app control).
  function told(cmd) {
    try {
      window.__mock.home.push(JSON.parse(cmd));
    } catch (e) {
      window.__mock.home.push({ garbled: cmd });
    }
  }

  window.__mock = {
    launches: launches,
    appControls: [], // what the page asked the Fire TV service, as { id, data }
    home: [], // commands the page sent the Home watcher, in order
    fireKeys: [], // keys the page passed to the Fire TV service, in order
    tvWindow: null, // the TV picture the page shows, as { rect, type, z }
    source: { type: 'TV', number: 1 }, // the TV's main input
    keys: {}, // remote keys the page registered
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
    // The Home watcher brings Clean Hub back after Home: the page shows again,
    // and if it asks, hears that it was the watcher.
    homeBack: function () {
      window.__mock.returnFromApp();
      var last = window.__mock.home[window.__mock.home.length - 1];
      if (last && last.do === 'shown' && last.ask) window.__mock.homeSays('back', {});
    },
    homeSays: function (key, value) {
      var listener = window.__mock.ports.home;
      if (listener) listener([{ key: key, value: JSON.stringify(value) }]);
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
      requestRemoteMessagePort: function (appId, name) {
        if (appId === 'CleanHub01.FireTv' && name === 'firetv-key' && params.get('fireTvFail') !== '1') {
          return {
            sendMessage: function (data) {
              data.forEach(function (d) { if (d.key === 'key') window.__mock.fireKeys.push(JSON.parse(d.value).name); });
            }
          };
        }
        if (appId !== 'CleanHub01.Home' || name !== 'home' || params.get('homeDown') === '1') {
          throw { name: 'NotFoundError', message: 'No remote port ' + appId + '/' + name };
        }
        return {
          sendMessage: function (data) {
            data.forEach(function (d) { if (d.key === 'cmd') told(d.value); });
          }
        };
      },
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
      // Clean Hub's services get commands and keys this way; they're noted as
      // sent (the TV delivers them a moment later).
      launchAppControl: function (control, id, ok, fail) {
        var data = {};
        control.data.forEach(function (d) { data[d.key] = d.value; });
        if (id === 'CleanHub01.Home') told(data.cmd[0]);
        else if (id === 'CleanHub01.FireTv' && data.key && params.get('fireTvFail') !== '1') {
          window.__mock.fireKeys.push(JSON.parse(data.key[0]).name);
        }
        setTimeout(function () {
          if (params.get('fireTvFail') === '1') {
            fail({ name: 'NotFoundError', message: 'No such app' });
            return;
          }
          if (id !== 'CleanHub01.Home' && !data.key) {
            window.__mock.appControls.push({ id: id, operation: control.operation, data: data });
          }
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
          window.__mock.source = { type: source.type, number: source.number };
          ok(source, 'MAIN');
        }, 10);
      },
      getSource: function () {
        return window.__mock.source;
      },
      // ?windowFail=1: the TV won't show its picture in a window.
      show: function (ok, fail, rect, type, z) {
        setTimeout(function () {
          if (params.get('windowFail') === '1') { fail({ name: 'NotSupportedError', message: 'No window' }); return; }
          window.__mock.tvWindow = { rect: rect, type: type, z: z };
          ok(rect, type);
        }, 10);
      },
      hide: function (ok, fail, type) {
        window.__mock.tvWindow = null;
        if (ok) ok(type);
      }
    },
    tvinputdevice: {
      registerKey: function (name) { window.__mock.keys[name] = true; },
      unregisterKey: function (name) { delete window.__mock.keys[name]; },
      getSupportedKeys: function () { return []; }
    }
  };
})();
