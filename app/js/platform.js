// The only file that talks to the TV. Everything else gets plain data and
// promises from here, so the browser workbench can stand in a fake `tizen`.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  // Remote keys by keyCode. 10009 is the Samsung remote's Back key; Escape and
  // Backspace stand in for it in a desktop browser.
  const KEYS = {
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
  function listInputs() {
    return new Promise(function (resolve, reject) {
      if (!onTV() || !tizen().systeminfo) {
        reject(new Error('Not running on a TV'));
        return;
      }
      try {
        tizen().systeminfo.getPropertyValue('VIDEOSOURCE', function (v) {
          resolve({ connected: v.connected || [], disconnected: v.disconnected || [] });
        }, function (err) {
          reject(new Error(err && err.message ? err.message : 'VIDEOSOURCE failed'));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Points the TV's main picture at an input (tv.window privilege).
  function setSource(source) {
    return new Promise(function (resolve, reject) {
      try {
        tizen().tvwindow.setSource(source, function () { resolve(); }, function (err) {
          reject(new Error(err && err.message ? err.message : 'setSource failed'));
        });
      } catch (e) {
        reject(e);
      }
    });
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
    hide: hide,
    screenSaver: screenSaver,
    iconUrl: iconUrl,
    now: now
  };
})(typeof window !== 'undefined' ? window : globalThis);
