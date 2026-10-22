// The only file that talks to the TV. Everything else gets plain data and
// promises from here, so the browser workbench can stand in a fake `tizen`.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  // Remote keys by keyCode. 10009 is the Samsung remote's Back key; Escape and
  // Backspace stand in for it in a desktop browser. The media keys only arrive
  // while registered (takeMediaKeys), for the Fire TV picture.
  const KEYS = {
    10252: 'play', // MediaPlayPause
    415: 'play', // MediaPlay
    19: 'play', // MediaPause
    37: 'left',
    38: 'up',
    39: 'right',
    40: 'down',
    13: 'ok',
    10009: 'back',
    27: 'back',
    8: 'back'
  };

  function tizen() {
    return root.tizen;
  }

  function onTV() {
    return !!(tizen() && tizen().application);
  }

  function keyName(event) {
    return KEYS[event.keyCode] || null;
  }

  // Tizen callbacks sometimes never arrive, so every call gets a deadline.
  const TIMEOUT_MS = 8000;

  // Plain copies of what we use, so nothing downstream holds Tizen objects.
  // Rejects at the deadline; if the TV answers after that, `onLate` gets the
  // list instead (the TV was slow, not broken).
  function listApps(onLate) {
    return new Promise(function (resolve, reject) {
      if (!onTV()) {
        reject(new Error('Not running on a TV'));
        return;
      }
      let late = false;
      const timer = root.setTimeout(function () {
        late = true;
        reject(new Error('The TV did not return its app list'));
      }, TIMEOUT_MS);
      try {
        tizen().application.getAppsInfo(function (infos) {
          root.clearTimeout(timer);
          const list = (infos || []).map(function (info) {
            return {
              id: info.id,
              name: info.name,
              iconPath: info.iconPath,
              show: info.show
            };
          });
          if (!late) resolve(list);
          else if (onLate) onLate(list);
        }, function (err) {
          root.clearTimeout(timer);
          reject(new Error(err && err.message ? err.message : 'getAppsInfo failed'));
        });
      } catch (e) {
        root.clearTimeout(timer);
        reject(e);
      }
    });
  }

  // Resolves once the other app is opening. Going to the background counts as
  // opened even if Tizen never calls back; only an error, or the deadline with
  // us still on screen the whole time, counts as failed. (Our timers pause
  // while another app is in front, so the deadline alone can't tell.)
  function launch(appId) {
    return new Promise(function (resolve, reject) {
      if (!onTV()) {
        reject(new Error('Not running on a TV'));
        return;
      }
      const doc = root.document;
      let timer = null;
      function done(err) {
        root.clearTimeout(timer);
        doc.removeEventListener('visibilitychange', onHidden);
        if (err) reject(err);
        else resolve();
      }
      function onHidden() {
        if (doc.hidden) done();
      }
      doc.addEventListener('visibilitychange', onHidden);
      timer = root.setTimeout(function () {
        done(doc.hidden ? null : new Error('The app did not open'));
      }, TIMEOUT_MS);
      try {
        tizen().application.launch(appId, function () {
          done();
        }, function (err) {
          done(new Error(err && err.message ? err.message : 'launch failed'));
        });
      } catch (e) {
        done(e);
      }
    });
  }

  // The TV's inputs, e.g. connected: [{ type: 'HDMI', number: 2 }]. Needs no
  // privilege. Keeps Tizen's own objects so setSource gets what it expects.
  // Takes ~3.3 s on the QN85B. Like listApps, a deadline rejects it, and an
  // answer after that goes to `onLate`.
  function listInputs(onLate) {
    return new Promise(function (resolve, reject) {
      if (!onTV() || !tizen().systeminfo) {
        reject(new Error('Not running on a TV'));
        return;
      }
      let late = false;
      const timer = root.setTimeout(function () {
        late = true;
        reject(new Error('The TV did not list its inputs'));
      }, TIMEOUT_MS);
      try {
        tizen().systeminfo.getPropertyValue('VIDEOSOURCE', function (v) {
          root.clearTimeout(timer);
          const found = { connected: v.connected || [], disconnected: v.disconnected || [] };
          if (!late) resolve(found);
          else if (onLate) onLate(found);
        }, function (err) {
          root.clearTimeout(timer);
          reject(new Error(err && err.message ? err.message : 'VIDEOSOURCE failed'));
        });
      } catch (e) {
        root.clearTimeout(timer);
        reject(e);
      }
    });
  }

  // Points the TV's main picture at an input (tv.window privilege).
  function setSource(source) {
    return new Promise(function (resolve, reject) {
      const timer = root.setTimeout(function () {
        reject(new Error('The TV did not switch input'));
      }, TIMEOUT_MS);
      try {
        tizen().tvwindow.setSource(source, function () {
          root.clearTimeout(timer);
          resolve();
        }, function (err) {
          root.clearTimeout(timer);
          reject(new Error(err && err.message ? err.message : 'setSource failed'));
        });
      } catch (e) {
        root.clearTimeout(timer);
        reject(e);
      }
    });
  }

  // Clean Hub's background service (service/firetv.js), which opens apps on
  // the Fire TV Stick. The page can't reach the stick itself: its API is HTTPS
  // behind Amazon's private certificate, which the browser engine refuses.
  const FIRETV_SERVICE = 'CleanHub01.FireTv';
  const FIRETV_PORT = 'firetv';

  // What the page tells its services is numbered (see tellService).
  const RUN = Date.now();
  let sent = 0;

  // The request to open an app that the Fire TV service hasn't answered yet.
  // It goes again with every key sent to the service until then: the TV can
  // hand a service the newest app control in place of an older one, and in
  // the Fire TV picture a key (the wake ahead of the first) follows at once.
  // The service runs each request once. Dropped when the service would have
  // given up anyway (30 s).
  const OPEN_MS = 35000;
  let opening = null; // { request, data: [{ key, value }], until }

  function stillOpening() {
    if (opening && Date.now() > opening.until) opening = null;
    return opening ? opening.data : null;
  }

  // Hands the service the package to open. Resolves once it has the request;
  // how it went arrives later through onFireTv.
  function openOnFireTv(pkg) {
    return new Promise(function (resolve, reject) {
      const t = tizen();
      if (!onTV() || !t.ApplicationControl || !t.application.launchAppControl) {
        reject(new Error('Not running on a TV'));
        return;
      }
      const request = RUN + '-' + (++sent);
      const mine = {
        request: request,
        data: [{ key: 'package', value: pkg }, { key: 'request', value: request }],
        until: Date.now() + OPEN_MS
      };
      opening = mine;
      function failed(err) {
        root.clearTimeout(timer);
        if (opening === mine) opening = null; // the page says it couldn't: it mustn't open later
        reject(err);
      }
      const timer = root.setTimeout(function () {
        failed(new Error('The Fire TV service did not start'));
      }, TIMEOUT_MS);
      try {
        const control = new t.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null,
          mine.data.map(function (d) { return new t.ApplicationControlData(d.key, [d.value]); }));
        t.application.launchAppControl(control, FIRETV_SERVICE, function () {
          root.clearTimeout(timer);
          resolve();
        }, function (err) {
          failed(new Error(err && err.message ? err.message : 'launchAppControl failed'));
        });
      } catch (e) {
        failed(e);
      }
    });
  }

  // Calls `listener` with each result the Fire TV service sends back, e.g.
  // { package, request, state: 'opened' | 'unpaired' | 'unreachable', detail }.
  function onFireTv(listener) {
    try {
      tizen().messageport.requestLocalMessagePort(FIRETV_PORT).addMessagePortListener(function (data) {
        (data || []).forEach(function (d) {
          if (d.key !== 'result') return;
          try {
            const result = JSON.parse(d.value);
            if (opening && result && result.request === opening.request) opening = null;
            listener(result);
          } catch (e) {
            // Not ours, or garbled: nothing useful to show.
          }
        });
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Fire TV picture in Clean Hub --------------------------------------------

  const FIRETV_KEY_PORT = 'firetv-key';
  const MEDIA_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause'];

  // Tells one of Clean Hub's services something, starting it if need be, by
  // app control: on the QN85B that reaches a service in 25-150 ms, where a
  // message port takes 0.3-1.9 s. (Never so to the page itself: an app
  // control relaunch reloads it.) A message port is the fallback. Messages
  // are numbered: the TV can hand a service the newest app control twice in
  // place of an older one. `along`: more { key, value } for the app control.
  function tellService(service, port, key, message, along) {
    const t = tizen();
    if (!onTV()) return false;
    const value = JSON.stringify(Object.assign({ run: RUN, seq: ++sent }, message));
    try {
      const data = [{ key: key, value: value }].concat(along || []).map(function (d) {
        return new t.ApplicationControlData(d.key, [d.value]);
      });
      const control = new t.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, data);
      t.application.launchAppControl(control, service, function () {}, function () {});
      return true;
    } catch (e) {
      // No app controls here: try the port.
    }
    try {
      t.messageport.requestRemoteMessagePort(service, port).sendMessage([{ key: key, value: value }]);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Passes a remote key ('up', 'ok', 'play', …, or 'wake' ahead of the first)
  // to the Fire TV service, which sends it on to the stick.
  function fireTvKey(name) {
    return tellService(FIRETV_SERVICE, FIRETV_KEY_PORT, 'key', { name: name, at: Date.now() }, stillOpening());
  }

  // Shows the TV's main picture (the input setSource chose) full screen,
  // behind the page, which must be see-through there.
  function showTvWindow() {
    return new Promise(function (resolve, reject) {
      const timer = root.setTimeout(function () {
        reject(new Error('The TV did not show the picture'));
      }, TIMEOUT_MS);
      try {
        tizen().tvwindow.show(function () {
          root.clearTimeout(timer);
          resolve();
        }, function (err) {
          root.clearTimeout(timer);
          reject(new Error(err && err.message ? err.message : 'tvwindow.show failed'));
        }, ['0px', '0px', '1920px', '1080px'], 'MAIN', 'BEHIND');
      } catch (e) {
        root.clearTimeout(timer);
        reject(e);
      }
    });
  }

  function hideTvWindow() {
    try {
      tizen().tvwindow.hide(function () {}, function () {}, 'MAIN');
      return true;
    } catch (e) {
      return false;
    }
  }

  // The TV's current main input, e.g. 'HDMI 4'; null where it can't say.
  function sourceNow() {
    try {
      const s = tizen().tvwindow.getSource();
      return s ? s.type + ' ' + s.number : null;
    } catch (e) {
      return null;
    }
  }

  // Play/pause only reaches the page while registered.
  function takeMediaKeys(on) {
    try {
      const input = tizen().tvinputdevice;
      MEDIA_KEYS.forEach(function (name) {
        try {
          if (on) input.registerKey(name);
          else input.unregisterKey(name);
        } catch (e) {
          // This TV doesn't have that key.
        }
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Clean Hub's Home watcher (service/home.js), which brings Clean Hub back
  // when the remote's Home button opens Samsung's Smart Hub. The TV also
  // starts it when it boots (config.xml, on-boot).
  const HOME_SERVICE = 'CleanHub01.Home';
  const HOME_PORT = 'home';

  // Tells the Home watcher something (starting it if need be).
  function tellHome(cmd) {
    return tellService(HOME_SERVICE, HOME_PORT, 'cmd', cmd);
  }

  // Calls `listener(key, value)` for each message from the Home watcher:
  // 'back' (it just brought Clean Hub back after Home) or 'report' (its state
  // and recent decisions, for tv-inspect.mjs).
  function onHome(listener) {
    try {
      tizen().messageport.requestLocalMessagePort(HOME_PORT).addMessagePortListener(function (data) {
        (data || []).forEach(function (d) {
          let value;
          try {
            value = JSON.parse(d.value);
          } catch (e) {
            return; // garbled: nothing to act on
          }
          listener(d.key, value);
        });
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Steps aside so the TV shows its main picture (and the remote reaches the
  // device on it); Clean Hub keeps running in the background.
  function hide() {
    try {
      tizen().application.getCurrentApplication().hide();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Samsung's screensaver kicks in over a still picture after a while
  // without remote input; Ambient turns it off while it shows. Quietly does
  // nothing where webapis.js isn't available.
  function screenSaver(on) {
    try {
      const ac = root.webapis && root.webapis.appcommon;
      if (!ac || !ac.setScreenSaver) return false;
      const states = ac.AppCommonScreenSaverState;
      ac.setScreenSaver(on ? states.SCREEN_SAVER_ON : states.SCREEN_SAVER_OFF, function () {}, function () {});
      return true;
    } catch (e) {
      return false;
    }
  }

  // Tizen hands back plain filesystem paths for icons.
  function iconUrl(path) {
    if (!path) return null;
    if (/^(file|wgt-package):/i.test(path)) return path;
    if (path.charAt(0) === '/') return 'file://' + path;
    return null;
  }

  // The TV's own clock when available; Date otherwise.
  function now() {
    try {
      if (tizen() && tizen().time) {
        const t = tizen().time.getCurrentDateTime();
        return new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds());
      }
    } catch (e) {
      // Fall through to the browser clock.
    }
    return new Date();
  }

  CH.platform = {
    TIMEOUT_MS: TIMEOUT_MS,
    onTV: onTV,
    keyName: keyName,
    listApps: listApps,
    launch: launch,
    listInputs: listInputs,
    setSource: setSource,
    openOnFireTv: openOnFireTv,
    onFireTv: onFireTv,
    fireTvKey: fireTvKey,
    showTvWindow: showTvWindow,
    hideTvWindow: hideTvWindow,
    sourceNow: sourceNow,
    takeMediaKeys: takeMediaKeys,
    tellHome: tellHome,
    onHome: onHome,
    hide: hide,
    screenSaver: screenSaver,
    iconUrl: iconUrl,
    now: now
  };
})(typeof window !== 'undefined' ? window : globalThis);
