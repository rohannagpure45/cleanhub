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

  // Plain copies of what we use, so nothing downstream holds Tizen objects.
  function listApps() {
    return new Promise(function (resolve, reject) {
      if (!onTV()) {
        reject(new Error('Not running on a TV'));
        return;
      }
      try {
        tizen().application.getAppsInfo(function (infos) {
          resolve((infos || []).map(function (info) {
            return {
              id: info.id,
              name: info.name,
              iconPath: info.iconPath,
              show: info.show
            };
          }));
        }, function (err) {
          reject(new Error(err && err.message ? err.message : 'getAppsInfo failed'));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function launch(appId) {
    return new Promise(function (resolve, reject) {
      if (!onTV()) {
        reject(new Error('Not running on a TV'));
        return;
      }
      try {
        tizen().application.launch(appId, function () {
          resolve();
        }, function (err) {
          reject(new Error(err && err.message ? err.message : 'launch failed'));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Tizen hands back plain filesystem paths for icons.
  function iconUrl(path) {
    if (!path) return null;
    if (/^(file|https?|data):/i.test(path)) return path;
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
    onTV: onTV,
    keyName: keyName,
    listApps: listApps,
    launch: launch,
    iconUrl: iconUrl,
    now: now
  };
})(typeof window !== 'undefined' ? window : globalThis);
