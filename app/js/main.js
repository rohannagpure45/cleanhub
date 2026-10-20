// Wires settings, the TV's app list and the remote together.
(function (root) {
  'use strict';
  const CH = root.CleanHub;
  const doc = root.document;
  const VERSION = '0.1.0';

  const state = {
    settings: null,
    all: [], // every launchable app on the TV, normalised
    home: [], // apps shown on the home screen, in order
    loaded: false,
    error: null,
    screen: 'home', // 'home' | 'settings' | 'apps'
    homeIndex: 0,
    settingsIndex: 0,
    appsIndex: 0,
    moving: -1, // index in the apps sheet of the app being moved
    movingFrom: null, // order before the move, for Back = cancel
    confirmReset: false
  };

  function storage() {
    try {
      return root.localStorage;
    } catch (e) {
      return null;
    }
  }

  function save() {
    const s = storage();
    if (!s || !CH.store.save(s, state.settings)) {
      CH.ui.toast('Couldn’t save settings on this TV');
    }
  }

  function homeIds() {
    return state.home.map(function (e) { return e.id; });
  }

  // The saved list, made explicit the first time the viewer edits it.
  function chosenIds() {
    return Array.isArray(state.settings.apps) ? state.settings.apps.slice() : homeIds();
  }

  function arrangeHome() {
    state.home = CH.apps.arrange(state.all, state.settings.apps, CH.defaultOrder, CH.defaultLimit);
  }

  // ---- Home ----------------------------------------------------------------

  function homeNote() {
    if (!state.loaded) return '';
    if (state.error) return 'Couldn’t read this TV’s apps. Settings still works.';
    if (!state.home.length) return 'No apps on Home yet. Pick some in Settings.';
    return '';
  }

  function renderHome(keepId) {
    const container = doc.getElementById('home');
    CH.ui.renderHome(container, state.home, state.settings, homeNote());
    let index = state.homeIndex;
    if (keepId) {
      const found = homeIds().indexOf(keepId);
      if (found !== -1) index = found;
    }
    state.homeIndex = Math.max(0, Math.min(state.home.length, index));
    CH.ui.focusHome(state.homeIndex, true);
    tick();
  }

  function focusedHomeId() {
    const e = state.home[state.homeIndex];
    return e ? e.id : null;
  }

  function onHomeKey(key) {
    const count = state.home.length + 1; // apps + Settings
    if (key === 'ok') {
      if (state.homeIndex === state.home.length) {
        openSettings();
        return;
      }
      launch(state.home[state.homeIndex]);
      return;
    }
    const d = CH.focus.delta(state.settings.layout, key);
    if (d) {
      const next = CH.focus.step(state.homeIndex, count, d);
      if (next !== state.homeIndex) {
        state.homeIndex = next;
        CH.ui.focusHome(next);
      }
    }
    // Back on Home does nothing: this is the home screen.
  }

  function launch(entry) {
    CH.ui.pressHome(state.homeIndex);
    CH.platform.launch(entry.id).catch(function () {
      CH.ui.toast('Couldn’t open ' + entry.name);
    });
  }

  // ---- Settings --------------------------------------------------------------

  const SETTING_ROWS = ['apps', 'layout', 'theme', 'font', 'focus', 'icons', 'clock', 'reset'];

  function renderSettings() {
    CH.ui.renderSettings(state.settings, {
      version: VERSION,
      homeCount: state.home.length,
      confirmReset: state.confirmReset
    });
    CH.ui.focusSheet(state.settingsIndex, true);
  }

  function openSettings() {
    state.screen = 'settings';
    state.settingsIndex = 0;
    state.confirmReset = false;
    renderSettings();
    CH.ui.openSheet(true);
  }

  function closeSettings() {
    state.screen = 'home';
    state.confirmReset = false;
    CH.ui.openSheet(false);
    CH.ui.focusHome(state.homeIndex);
  }

  // Applies a settings change everywhere it shows.
  function changeSettings(next) {
    const keepId = focusedHomeId();
    const layoutChanged = next.layout !== state.settings.layout || next.clock !== state.settings.clock ||
      next.icons !== state.settings.icons;
    state.settings = next;
    save();
    CH.ui.applyLook(next);
    if (layoutChanged) renderHome(keepId);
  }

  function onSettingsKey(key) {
    const row = SETTING_ROWS[state.settingsIndex];
    if (key === 'back') {
      closeSettings();
      return;
    }
    if (key === 'up' || key === 'down') {
      state.settingsIndex = CH.focus.step(state.settingsIndex, SETTING_ROWS.length, key === 'down' ? 1 : -1);
      if (state.confirmReset) {
        state.confirmReset = false;
        renderSettings();
      } else {
        CH.ui.focusSheet(state.settingsIndex);
      }
      return;
    }
    if (row === 'apps') {
      if (key === 'ok' || key === 'right') openApps();
      return;
    }
    if (row === 'reset') {
      if (key !== 'ok') return;
      if (!state.confirmReset) {
        state.confirmReset = true;
      } else {
        state.confirmReset = false;
        changeSettings(CH.store.defaults());
        arrangeHome();
        renderHome(null);
        CH.ui.toast('Settings reset');
      }
      renderSettings();
      return;
    }
    const dir = key === 'left' ? -1 : (key === 'right' || key === 'ok') ? 1 : 0;
    if (!dir) return;
    changeSettings(CH.store.cycle(state.settings, row, dir));
    renderSettings();
  }

  // ---- Apps on Home ------------------------------------------------------------

  // Chosen apps first, in their order, then everything else by name.
  function appRows() {
    const ids = chosenIds();
    const byId = {};
    state.all.forEach(function (e) { byId[e.id] = e; });
    const rows = [];
    let order = 0;
    ids.forEach(function (id) {
      if (byId[id]) rows.push({ entry: byId[id], on: true, order: order++ });
    });
    state.all.forEach(function (e) {
      if (ids.indexOf(e.id) === -1) rows.push({ entry: e, on: false, order: -1 });
    });
    return rows;
  }

  function renderApps() {
    const rows = appRows();
    state.appsIndex = Math.max(0, Math.min(rows.length - 1, state.appsIndex));
    CH.ui.renderAppsSheet(rows, state.moving, state.appsIndex);
    CH.ui.focusSheet(state.appsIndex, true);
    return rows;
  }

  function openApps() {
    state.screen = 'apps';
    state.appsIndex = 0;
    state.moving = -1;
    renderApps();
    refreshApps();
  }

  // Saves a new chosen list. Ids of apps not currently installed are kept at
  // the end, so an app that is updated or briefly missing keeps its place.
  function setChosen(visibleIds) {
    const installed = {};
    state.all.forEach(function (e) { installed[e.id] = true; });
    const missing = chosenIds().filter(function (id) { return !installed[id]; });
    const next = Object.assign({}, state.settings, { apps: visibleIds.concat(missing) });
    state.settings = CH.store.sanitize(next);
    save();
    arrangeHome();
  }

  function visibleChosen(rows) {
    return rows.filter(function (r) { return r.on; }).map(function (r) { return r.entry.id; });
  }

  function onAppsKey(key) {
    const rows = appRows();
    const row = rows[state.appsIndex];

    if (state.moving !== -1) {
      if (key === 'up' || key === 'down') {
        const ids = visibleChosen(rows);
        const to = CH.focus.step(state.moving, ids.length, key === 'down' ? 1 : -1);
        if (to === state.moving) return;
        setChosen(CH.apps.move(ids, state.moving, to));
        state.moving = to;
        state.appsIndex = to;
        renderApps();
      } else if (key === 'ok') {
        state.moving = -1;
        state.movingFrom = null;
        renderApps();
      } else if (key === 'back') {
        setChosen(state.movingFrom);
        state.appsIndex = state.movingFrom.indexOf(rows[state.moving].entry.id);
        state.moving = -1;
        state.movingFrom = null;
        renderApps();
      }
      return;
    }

    if (key === 'back') {
      state.screen = 'settings';
      renderHome(focusedHomeId());
      renderSettings();
      return;
    }
    if (key === 'up' || key === 'down') {
      const next = CH.focus.step(state.appsIndex, rows.length, key === 'down' ? 1 : -1);
      if (next !== state.appsIndex) {
        state.appsIndex = next;
        CH.ui.focusSheet(next);
        CH.ui.updateAppsHint(rows, state.moving, next);
      }
      return;
    }
    if (!row) return;
    if (key === 'ok' && !row.on) {
      const ids = visibleChosen(rows).concat([row.entry.id]);
      setChosen(ids);
      state.appsIndex = ids.length - 1;
      renderApps();
    } else if (key === 'ok' && row.on) {
      state.moving = state.appsIndex;
      state.movingFrom = visibleChosen(rows);
      renderApps();
    } else if (key === 'left' && row.on) {
      setChosen(CH.apps.toggle(visibleChosen(rows), row.entry.id));
      renderApps();
    }
  }

  // ---- Data ------------------------------------------------------------------

  function refreshApps() {
    return CH.platform.listApps().then(function (infos) {
      state.error = null;
      state.all = CH.apps.normalize(infos, CH.catalog);
    }, function (err) {
      state.error = err;
      state.all = [];
    }).then(function () {
      const keepId = focusedHomeId();
      state.loaded = true;
      arrangeHome();
      if (state.screen === 'home') {
        renderHome(keepId);
      } else if (state.screen === 'apps') {
        renderHome(keepId);
        renderApps();
      }
    });
  }

  // ---- Clock -------------------------------------------------------------------

  let clockTimer = null;

  function tick() {
    root.clearTimeout(clockTimer);
    if (state.settings.clock === 'off') return;
    const now = CH.platform.now();
    CH.ui.updateClock(now, state.settings.clock);
    // Wake just after the next minute starts.
    clockTimer = root.setTimeout(tick, (60 - now.getSeconds()) * 1000 + 50);
  }

  // ---- Input -------------------------------------------------------------------

  function onKey(event) {
    const key = CH.platform.keyName(event);
    if (!key) return;
    event.preventDefault();
    if (state.screen === 'home') onHomeKey(key);
    else if (state.screen === 'settings') onSettingsKey(key);
    else if (state.screen === 'apps') onAppsKey(key);
  }

  // Coming back from another app: the app list may have changed, and timers
  // were paused while hidden.
  function onVisibility() {
    if (doc.hidden) return;
    tick();
    refreshApps();
  }

  function start() {
    const s = storage();
    state.settings = s ? CH.store.load(s) : CH.store.defaults();
    CH.ui.init();
    CH.ui.applyLook(state.settings);
    renderHome(null);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('visibilitychange', onVisibility);
    refreshApps();
  }

  CH.main = { state: state, start: start, version: VERSION };
  start();
})(window);
