// Stand-in for the TV's $WEBAPIS/webapis/webapis.js (screensaver control).
(function () {
  'use strict';
  window.webapis = window.webapis || {};
  window.webapis.appcommon = {
    AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 },
    setScreenSaver: function (state, ok) {
      (window.__screenSaver = window.__screenSaver || []).push(state);
      if (ok) setTimeout(ok, 0);
    }
  };
})();
