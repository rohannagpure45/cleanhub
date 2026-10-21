// Wires settings, the TV's app list and the remote together.
(function (root) {
  'use strict';
  const CH = root.CleanHub;
  const doc = root.document;
  const VERSION = '0.1.0';
  const SWITCH = '\u0000switch'; // focus key of the apps sheet's last row

  const state = {
    settings: null,
    raw: [], // the TV's app list as last read (plain objects)
    all: [], // apps on the TV after filtering, normalised
    home: [], // apps shown on the home screen, in order
    loaded: false, // some app list (cached or live) is showing
    fresh: false, // the TV has answered (or failed) at least once
    error: null,
    screen: 'home', // 'home' | 'settings' | 'apps' | 'music' | 'ambient'
    homeIndex: 0, // the focused (or, on Settings, last focused) app
    homeOnGear: false, // Settings button has focus
    settingsIndex: 0,
    musicIndex: 0, // focused genre in the Ambient music sheet
    appsIndex: 0,
    appsFocus: null, // id of the focused apps-sheet row (or SWITCH); survives re-sorting
    rows: [], // apps-sheet rows as last drawn
    showEverything: false, // apps sheet lists every entry the TV reports
    moving: -1, // index in the apps sheet of the app being moved
    movingId: null,
    movingSaved: null, // settings.apps before the move, for Back = cancel
    confirmReset: false,
    controlsShown: false // Ambient's overlay
  };

  const APPS_CACHE = 'cleanhub.apps';
  const AMBIENT_STATE = 'cleanhub.ambient';

  // Ambient sits first on Home (unless hidden in Settings). It isn't a TV app:
  // it never goes in the saved app list.
  const AMBIENT = {
    id: 'cleanhub:ambient',
    name: 'Ambient',
    key: 'ambient',
    builtin: 'ambient',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    bg: '#16110D',
    fg: '#E3B97A'
  };

  // Switches the TV to the HDMI input picked in Settings ('Fire TV on Home').
  const INPUT = {
    id: 'cleanhub:input',
    name: 'Fire TV',
    key: 'input',
    builtin: 'input',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    bg: '#14181F',
    fg: '#FF9900'
  };

  function storage() {
    try {
      return root.localStorage;
    } catch (e) {
      return null;
    }
  }

  // The last app list, so Home can draw at once while the TV (slowly)
  // produces a fresh one.
  function readCache() {
    try {
      const list = JSON.parse(storage().getItem(APPS_CACHE));
      return Array.isArray(list) ? list : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(raw) {
    try {
      storage().setItem(APPS_CACHE, JSON.stringify(raw));
    } catch (e) {
      // Only a speed-up; nothing to tell the viewer.
    }
  }

  function save() {
    const s = storage();
    if (!s || !CH.store.save(s, state.settings)) {
      CH.ui.toast('Couldn’t save settings on this TV');
    }
  }

  function setApps(apps) {
    state.settings = CH.store.sanitize(Object.assign({}, state.settings, { apps: apps }));
    save();
  }

  function homeIds() {
    return state.home.map(function (e) { return e.id; });
  }

  // What Home shows: Ambient, then the apps.
  // What Home shows: Ambient, the Fire TV input, then the apps.
  function homeItems() {
    const builtins = [];
    if (state.settings.ambient === 'on') builtins.push(AMBIENT);
    if (state.settings.input !== 'off') builtins.push(INPUT);
    return builtins.concat(state.home);
  }

  // The saved list, made explicit the first time the viewer edits it.
  function chosenIds() {
    return Array.isArray(state.settings.apps) ? state.settings.apps.slice() : homeIds();
  }

  // Filtered apps, plus any entry the filters hide that the viewer put on
  // Home on purpose (from "Show everything the TV lists").
  function homePool() {
    const ids = Array.isArray(state.settings.apps) ? state.settings.apps : [];
    const known = {};
    state.all.forEach(function (e) { known[e.id] = true; });
    const wanted = ids.filter(function (id) { return !known[id]; });
    if (!wanted.length) return state.all;
    return state.all.concat(CH.apps.normalize(state.raw, CH.catalog, true).filter(function (e) {
      return wanted.indexOf(e.id) !== -1;
    }));
  }

  function arrangeHome() {
    state.home = CH.apps.arrange(homePool(), state.settings.apps, CH.defaultOrder, CH.defaultLimit);
  }

  // ---- Home ----------------------------------------------------------------

  function homeNote() {
    if (!state.loaded) return 'Loading your apps…';
    if (state.error) return 'Couldn’t read this TV’s apps. Settings (top right) still works.';
    if (!state.home.length) return 'No apps on Home yet. Pick some in Settings, top right.';
    return '';
  }

  // Settings has focus while a sheet is open (sheets open from it), or when
  // the viewer put it there, or when there is nothing else.
  function onGear() {
    return (state.screen !== 'home' && state.screen !== 'ambient') || state.homeOnGear || !homeItems().length;
  }

  function renderHome(keepId) {
    const items = homeItems();
    let index = state.homeIndex;
    if (keepId) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === keepId) index = i;
      }
    }
    state.homeIndex = Math.max(0, Math.min(items.length - 1, index));
    CH.ui.renderHome(doc.getElementById('home'), items, state.settings, homeNote(),
      { index: state.homeIndex, gear: onGear() });
    tick();
  }

  function focusedHomeId() {
    if (onGear()) return null;
    const e = homeItems()[state.homeIndex];
    return e ? e.id : null;
  }

  // List: Up/Down move, Right goes to Settings. Dock: Left/Right move, Up goes
  // to Settings. From Settings, the opposite key or Back returns.
  function onHomeKey(key) {
    const dock = state.settings.layout === 'dock';
    if (key === 'ok') {
      const item = homeItems()[state.homeIndex];
      if (onGear()) openSettings();
      else if (item && item.builtin === 'ambient') openAmbient();
      else if (item && item.builtin === 'input') showInput();
      else launch(item);
      return;
    }
    if (onGear()) {
      const back = key === 'back' || (dock ? key === 'down' : key === 'left' || key === 'down');
      if (back && homeItems().length) {
        state.homeOnGear = false;
        CH.ui.focusHome(state.homeIndex, false);
      }
      return;
    }
    if (key === (dock ? 'up' : 'right')) {
      state.homeOnGear = true;
      CH.ui.focusHome(state.homeIndex, true);
      return;
    }
    const d = CH.focus.delta(state.settings.layout, key);
    if (!d) return; // Back on Home does nothing: this is the home screen.
    const next = CH.focus.step(state.homeIndex, homeItems().length, d);
    if (next !== state.homeIndex) {
      state.homeIndex = next;
      CH.ui.focusHome(next, false);
    }
  }

  function launch(entry) {
    if (!entry) return;
    cancelSwitch();
    CH.ui.pressHome(state.homeIndex);
    CH.platform.launch(entry.id).catch(function () {
      CH.ui.toast('Couldn’t open ' + entry.name);
    });
  }

  // ---- Settings --------------------------------------------------------------

  const SETTING_ROWS = CH.settingRows.map(function (r) { return r.id; });

  function renderSettings() {
    CH.ui.renderSettings(state.settings, {
      version: VERSION,
      homeCount: state.home.length,
      musicLabel: CH.store.musicLabel(state.settings.music),
      confirmReset: state.confirmReset
    }, state.settingsIndex);
  }

  function openSettings() {
    cancelSwitch();
    state.screen = 'settings';
    state.homeOnGear = true;
    state.settingsIndex = 0;
    state.confirmReset = false;
    renderSettings();
    CH.ui.openSheet(true);
    CH.ui.warmImages(settingsImages());
  }

  // Pictures the Settings sheet can switch to: each theme's background and
  // swatch, and each wallpaper's swatch.
  function settingsImages() {
    const names = [];
    CH.options.theme.forEach(function (t) {
      names.push('bg-' + t.id, 'bg-' + t.id + '-blur', 'thumb-' + t.id);
    });
    CH.options.wallpaper.forEach(function (w) { names.push('thumb-wall-' + w.id); });
    return names;
  }

  function closeSettings() {
    state.screen = 'home';
    state.confirmReset = false;
    CH.ui.openSheet(false);
    CH.ui.focusHome(state.homeIndex, onGear());
  }

  // Applies a settings change everywhere it shows.
  function changeSettings(next) {
    const prev = state.settings;
    const relayout = next.layout !== prev.layout || next.clock !== prev.clock ||
      next.icons !== prev.icons || next.ambient !== prev.ambient || next.input !== prev.input;
    // Remember the app by id: showing or hiding Ambient shifts every index.
    const remembered = homeItems()[state.homeIndex];
    state.settings = next;
    save();
    CH.ui.applyLook(next);
    if (relayout) renderHome(remembered ? remembered.id : null);
    if (next.music.join() !== prev.music.join() || next.brainrot !== prev.brainrot) changeMusic();
    if (next.input !== prev.input) cancelSwitch();
    if (next.wallpaper !== prev.wallpaper || next.motion !== prev.motion) {
      CH.ui.showWall(wallNow(), state.screen !== 'ambient', wallMoves());
    }
    // The input list covers every input, so one fetch serves any choice.
    if (next.input !== 'off' && (prev.input === 'off' || !inputs)) prefetchInputs();
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
    if (row === 'music') {
      if (key === 'ok' || key === 'right') openMusic();
      return;
    }
    if (row === 'reset') {
      if (key !== 'ok') return;
      if (!state.confirmReset) {
        state.confirmReset = true;
        renderSettings();
        return;
      }
      state.confirmReset = false;
      changeSettings(CH.store.defaults());
      arrangeHome();
      renderHome(null);
      renderSettings();
      CH.ui.toast('Settings reset');
      return;
    }
    const dir = key === 'left' ? -1 : (key === 'right' || key === 'ok') ? 1 : 0;
    if (!dir) return;
    changeSettings(CH.store.cycle(state.settings, row, dir));
    renderSettings();
  }

  // ---- Apps on Home ------------------------------------------------------------

  // Chosen apps first, in their order, then everything else by name.
  // `showEverything` adds what the filters hide, for apps they get wrong.
  function appRows() {
    const ids = chosenIds();
    const pool = homePool().slice();
    if (state.showEverything) {
      const known = {};
      pool.forEach(function (e) { known[e.id] = true; });
      CH.apps.normalize(state.raw, CH.catalog, true).forEach(function (e) {
        if (!known[e.id]) pool.push(e);
      });
    }
    const byId = {};
    pool.forEach(function (e) { byId[e.id] = e; });
    const rows = [];
    let order = 0;
    ids.forEach(function (id) {
      if (byId[id]) rows.push({ entry: byId[id], on: true, order: order++ });
    });
    pool.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (e) {
      if (ids.indexOf(e.id) === -1) rows.push({ entry: e, on: false, order: -1 });
    });
    return rows;
  }

  function visibleChosen(rows) {
    return rows.filter(function (r) { return r.on; }).map(function (r) { return r.entry.id; });
  }

  function keyAt(rows, index) {
    return rows[index] ? rows[index].entry.id : SWITCH;
  }

  function endMove() {
    state.moving = -1;
    state.movingId = null;
    state.movingSaved = null;
  }

  // Redraws the apps sheet. Focus and the moving app are tracked by id, so a
  // refresh or a re-sort can't leave them on the wrong row.
  function renderApps() {
    const rows = appRows();
    state.rows = rows;
    if (state.moving !== -1) {
      const at = visibleChosen(rows).indexOf(state.movingId);
      if (at === -1) endMove();
      else state.moving = at;
    }
    let index = state.appsFocus === SWITCH ? rows.length : -1;
    for (let i = 0; i < rows.length && index === -1; i++) {
      if (rows[i].entry.id === state.appsFocus) index = i;
    }
    if (state.moving !== -1) index = state.moving;
    state.appsIndex = index === -1 ? Math.max(0, Math.min(rows.length, state.appsIndex)) : index;
    state.appsFocus = keyAt(rows, state.appsIndex);
    CH.ui.renderAppsSheet(rows, state.moving, state.appsIndex, {
      everything: state.showEverything,
      failed: !!state.error,
      full: visibleChosen(rows).length >= CH.store.MAX_APPS
    });
  }

  function openApps() {
    state.screen = 'apps';
    state.appsIndex = 0;
    state.appsFocus = null;
    state.showEverything = false;
    endMove();
    renderApps();
    refreshApps();
  }

  // Saves the edited order of the visible apps, keeping the slots of saved
  // apps the TV doesn't list right now.
  function setChosen(visibleIds) {
    const present = {};
    state.raw.forEach(function (info) { if (info && info.id) present[info.id] = true; });
    setApps(CH.apps.mergeChosen(chosenIds(), visibleIds, present, CH.store.MAX_APPS));
    arrangeHome();
  }

  function onAppsKey(key) {
    const rows = state.rows;
    const row = rows[state.appsIndex];

    if (state.moving !== -1) {
      if (key === 'up' || key === 'down') {
        const ids = visibleChosen(rows);
        const from = state.moving;
        const to = CH.focus.step(from, ids.length, key === 'down' ? 1 : -1);
        if (to === from) return;
        setChosen(CH.apps.move(ids, from, to));
        state.moving = to;
        state.appsIndex = to;
        CH.ui.moveAppsRow(from, to); // in place: rebuilding per step lags on a TV
      } else if (key === 'ok') {
        endMove();
        renderApps();
      } else if (key === 'back') {
        // Cancel: put back exactly what was saved, including "not chosen yet".
        if (state.settings.apps !== state.movingSaved) {
          setApps(state.movingSaved);
          arrangeHome();
        }
        state.appsFocus = state.movingId;
        endMove();
        renderApps();
      }
      return;
    }

    if (key === 'back') {
      state.screen = 'settings';
      renderHome(null);
      renderSettings();
      return;
    }
    if (key === 'up' || key === 'down') {
      const next = CH.focus.step(state.appsIndex, rows.length + 1, key === 'down' ? 1 : -1);
      if (next !== state.appsIndex) {
        state.appsIndex = next;
        state.appsFocus = keyAt(rows, next);
        CH.ui.focusSheet(next);
        CH.ui.updateAppsHint(next);
      }
      return;
    }
    if (!row) {
      if (key === 'ok') {
        state.showEverything = !state.showEverything;
        state.appsFocus = SWITCH;
        renderApps();
      }
      return;
    }
    const visible = visibleChosen(rows);
    if (key === 'ok' && !row.on) {
      if (visible.length >= CH.store.MAX_APPS) {
        CH.ui.toast('Home holds up to ' + CH.store.MAX_APPS + ' apps. Remove one first.');
        return;
      }
      setChosen(visible.concat([row.entry.id]));
      state.appsFocus = row.entry.id;
      renderApps();
    } else if (key === 'ok' && row.on) {
      state.moving = state.appsIndex;
      state.movingId = row.entry.id;
      state.movingSaved = state.settings.apps;
      renderApps();
    } else if (key === 'left' && row.on) {
      setChosen(CH.apps.toggle(visible, row.entry.id));
      state.appsFocus = row.entry.id; // follow it, so OK puts it straight back
      renderApps();
    }
  }

  // ---- Ambient music -------------------------------------------------------------

  // A checklist of genres: OK ticks or unticks the focused one, and Ambient
  // plays every ticked genre (none: no music).
  function renderMusic() {
    CH.ui.renderMusicSheet(CH.genres, state.settings.music, state.musicIndex);
  }

  function openMusic() {
    state.screen = 'music';
    state.musicIndex = 0;
    renderMusic();
  }

  function onMusicKey(key) {
    if (key === 'back') {
      state.screen = 'settings';
      renderSettings();
      return;
    }
    if (key === 'up' || key === 'down') {
      const next = CH.focus.step(state.musicIndex, CH.genres.length, key === 'down' ? 1 : -1);
      if (next !== state.musicIndex) {
        state.musicIndex = next;
        CH.ui.focusSheet(next);
        CH.ui.updateMusicHint(CH.genres, state.settings.music, next);
      }
      return;
    }
    if (key === 'ok') {
      changeSettings(CH.store.toggleGenre(state.settings, CH.genres[state.musicIndex].id));
      renderMusic();
    }
  }

  // ---- Fire TV input ------------------------------------------------------------

  // Samsung's full-screen viewer for the TV's main input. Only hiding Clean
  // Hub would leave Smart Hub on top of the picture (seen on the QN85B).
  const TV_VIEWER = 'org.tizen.tv-viewer';

  // Asking the TV for its inputs takes over 3 s on the QN85B, and setSource
  // only accepts the TV's own input objects, so the list is fetched ahead of
  // time (at start and whenever Clean Hub comes back) and OK switches at once.
  let inputs = null;
  let inputsPending = null; // the one query in flight, shared by everyone

  // A late answer (after the platform's deadline) still fills the cache.
  function storeInputs(found) {
    inputs = found;
    return found;
  }

  function loadInputs() {
    if (!inputsPending) {
      inputsPending = CH.platform.listInputs(storeInputs).then(function (found) {
        inputsPending = null;
        return storeInputs(found);
      }, function (err) {
        inputsPending = null;
        throw err;
      });
    }
    return inputsPending;
  }

  function prefetchInputs() {
    if (state.settings.input === 'off') return Promise.resolve(null);
    return loadInputs().catch(function () { return null; });
  }

  // One switch at a time; it's dropped if the viewer moves on meanwhile.
  let switchId = 0;
  let switching = 0;

  function cancelSwitch() {
    switching = 0;
  }

  function stillWanted(id) {
    return switching === id && !doc.hidden && state.screen === 'home' &&
      state.settings.input !== 'off' && focusedHomeId() === INPUT.id;
  }

  // Points the TV at the chosen HDMI input, then hands the screen to the TV
  // viewer so the picture and the remote belong to the device there (the TV
  // shows its own 'No signal' if nothing is plugged in). Clean Hub stays
  // running in the background.
  function showInput() {
    if (switching) return; // a second OK while one is under way does nothing
    const id = ++switchId;
    switching = id;
    const done = function () {
      if (switching === id) switching = 0;
    };
    const number = Number(state.settings.input.replace('hdmi', ''));
    const label = CH.store.label('input', state.settings.input);
    CH.ui.pressHome(state.homeIndex);
    if (!inputs) CH.ui.toast('Switching to ' + label + '…');
    (inputs ? Promise.resolve(inputs) : loadInputs()).then(function (found) {
      if (!stillWanted(id)) return null;
      let source = null;
      found.connected.concat(found.disconnected).forEach(function (s) {
        if (s.type === 'HDMI' && Number(s.number) === number) source = s;
      });
      if (!source) throw new Error(label + ' isn’t on this TV');
      return CH.platform.setSource(source).then(function () {
        if (!stillWanted(id)) return null;
        CH.ui.clearToast();
        return CH.platform.launch(TV_VIEWER).catch(function () {
          if (stillWanted(id)) CH.platform.hide();
        });
      });
    }).catch(function () {
      if (switching === id) CH.ui.toast('Couldn’t switch to ' + label);
    }).then(done, done);
  }

  // ---- Ambient ----------------------------------------------------------------

  // Moves the clock to another corner every few minutes while Ambient shows.
  const AMBIENT_MOVE_MS = 4 * 60 * 1000;
  const CONTROLS_MS = 6000;
  let moveTimer = null;
  let controlsTimer = null;

  // Rotate shows each scene for a quarter of an hour, in order, on the clock
  // (so it changes on the quarter hour, and picks up where the clock is after
  // the TV was off).
  const ROTATE_MS = 15 * 60 * 1000;
  const SCENES = CH.options.wallpaper
    .filter(function (w) { return w.kind === 'scene'; })
    .map(function (w) { return w.id; });

  // The wallpaper on screen now: the one chosen, or Rotate's current scene.
  function wallNow() {
    const id = state.settings.wallpaper;
    if (id !== 'rotate') return id;
    return SCENES[Math.floor(CH.platform.now().getTime() / ROTATE_MS) % SCENES.length];
  }

  function wallMoves() {
    return state.settings.motion !== 'off';
  }

  function wallLabel(id) {
    if (id === 'rotate') return 'Rotate · a new scene every 15 minutes';
    return CH.store.label('wallpaper', id);
  }

  function saveAmbient(open) {
    try {
      const st = CH.player.state();
      // `wanted`, not `playing`: a power-off pauses the audio but not the wish.
      storage().setItem(AMBIENT_STATE, JSON.stringify({
        open: open, track: st.index, file: st.track ? st.track.file : null, paused: !st.wanted
      }));
    } catch (e) {
      // Only means Ambient won't come back by itself after a restart.
    }
  }

  function readAmbient() {
    try {
      return JSON.parse(storage().getItem(AMBIENT_STATE)) || {};
    } catch (e) {
      return {};
    }
  }

  // Where Ambient left off in this list: the saved track if it's still in it,
  // else the top (the Music setting changed since).
  function resumeIndex(tracks, saved) {
    if (!saved.file) return saved.track; // saved before tracks were remembered by file
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].file === saved.file) return i;
    }
    return 0;
  }

  function musicOn() {
    return state.settings.music.length > 0;
  }

  // The tracks of the ticked genres (a track's `set` is its genre id), in
  // playlist order.
  function tracksFor(music) {
    return (CH.playlist || []).filter(function (t) {
      return music.indexOf(t.set) !== -1;
    });
  }

  function brainrotOn() {
    return state.settings.brainrot === 'on';
  }

  // What Ambient plays: in Brainrot mode its own set (nothing with Music off),
  // otherwise the Music setting's tracks, never the brainrot set.
  function ambientTracks() {
    const list = CH.playlist || [];
    if (brainrotOn()) {
      return musicOn() ? list.filter(function (t) { return t.set === 'brainrot'; }) : [];
    }
    return tracksFor(state.settings.music).filter(function (t) { return t.set !== 'brainrot'; });
  }

  // A new Music choice or Brainrot mode: a new playlist, from its start;
  // playing on if Ambient is up.
  function changeMusic() {
    const wasPlaying = CH.player.state().wanted;
    CH.player.pause();
    CH.player.init(ambientTracks(), 0, onPlayer);
    if (state.screen === 'ambient' && musicOn() && wasPlaying) CH.player.play();
    if (state.screen === 'ambient') updateAmbient();
  }

  // Ambient's text, and in Brainrot mode the feed's sound line and hint.
  function updateAmbient() {
    const st = CH.player.state();
    const rot = brainrotOn();
    if (rot) {
      const t = musicOn() && st.count && !st.broken ? st.track : null;
      CH.reel.setSound(t ? t.title + ' · ' + t.artist : null, musicOn() && !!st.count);
    }
    CH.ui.updateAmbient(st, musicOn(), rot ? CH.reel.state() : null);
  }

  function onPlayer() {
    if (state.screen === 'ambient') {
      updateAmbient();
      saveAmbient(true);
    }
  }

  function scheduleMove() {
    root.clearTimeout(moveTimer);
    moveTimer = root.setTimeout(function () {
      if (state.screen !== 'ambient') return;
      CH.ui.moveAmbientText();
      scheduleMove();
    }, AMBIENT_MOVE_MS);
  }

  function showControls() {
    state.controlsShown = true;
    CH.ui.showAmbientControls(true);
    root.clearTimeout(controlsTimer);
    controlsTimer = root.setTimeout(function () {
      state.controlsShown = false;
      CH.ui.showAmbientControls(false);
    }, CONTROLS_MS);
  }

  // play: false when coming back to an Ambient the viewer had paused.
  function openAmbient(play) {
    cancelSwitch();
    state.screen = 'ambient';
    CH.ui.showWall(wallNow(), true, wallMoves());
    CH.ui.openAmbient(true);
    CH.platform.screenSaver(false);
    if (brainrotOn()) CH.reel.start(play === false);
    updateAmbient();
    if (musicOn() && play !== false) CH.player.play();
    saveAmbient(true);
    tick();
    showControls();
    scheduleMove();
  }

  function closeAmbient() {
    state.screen = 'home';
    root.clearTimeout(moveTimer);
    root.clearTimeout(controlsTimer);
    state.controlsShown = false;
    CH.ui.showAmbientControls(false);
    CH.player.pause();
    CH.reel.stop();
    CH.ui.openAmbient(false);
    CH.platform.screenSaver(true);
    saveAmbient(false);
    CH.ui.focusHome(state.homeIndex, onGear());
  }

  // The overlay is hidden most of the time; the first key just shows it.
  function onAmbientKey(key) {
    if (key === 'back') {
      closeAmbient();
      return;
    }
    if (brainrotOn()) {
      onBrainrotKey(key);
      return;
    }
    const wasShown = state.controlsShown;
    const music = musicOn();
    showControls();
    // The first key only wakes the controls, except OK when the status line
    // is asking for it ('Press OK to play').
    if (!wasShown && !(key === 'ok' && music && CH.player.state().blocked)) return;
    if (key === 'ok' && music) CH.player.toggle();
    else if (key === 'right' && music) CH.player.next();
    else if (key === 'left' && music) CH.player.previous();
    else if (key === 'up' || key === 'down') {
      changeSettings(CH.store.cycle(state.settings, 'wallpaper', key === 'down' ? 1 : -1));
      CH.ui.toast(wallLabel(state.settings.wallpaper));
    }
    CH.ui.updateAmbient(CH.player.state(), music);
  }

  // Brainrot mode: the feed is anything but hidden, so keys act at once.
  // OK pauses the feed and its music together; ▲▼ scroll like a phone.
  function onBrainrotKey(key) {
    const music = musicOn();
    showControls();
    if (key === 'ok') {
      if (music && CH.player.state().blocked) {
        CH.player.play(); // 'Press OK to play'
      } else {
        const pause = !CH.reel.state().paused;
        CH.reel.setPaused(pause);
        if (music && pause) CH.player.pause();
        else if (music) CH.player.play();
      }
    } else if (key === 'up' || key === 'down') {
      CH.reel.step(key === 'down' ? 1 : -1); // a new video plays, even after a pause
      if (music && !CH.player.state().wanted) CH.player.play();
    } else if (key === 'right' && music) {
      CH.player.next();
    } else if (key === 'left' && music) {
      CH.player.previous();
    }
    updateAmbient();
  }

  // ---- Data ------------------------------------------------------------------

  function setRaw(raw) {
    state.raw = raw;
    state.all = CH.apps.normalize(raw, CH.catalog);
  }

  // Saved ids follow an app to its new id (HBO Max to Max, and so on).
  function migrateSaved() {
    if (!Array.isArray(state.settings.apps)) return;
    const next = CH.apps.migrateIds(state.settings.apps, state.all, CH.catalog);
    if (next) setApps(next);
  }

  // Requests are numbered so a slow, older answer never replaces a newer one.
  let listSeq = 0;
  let appliedSeq = 0;

  function applyList(seq, infos) {
    if (seq < appliedSeq) return false;
    appliedSeq = seq;
    state.error = null;
    setRaw(infos);
    writeCache(infos);
    migrateSaved();
    return true;
  }

  // Brings every screen in line with a new app list.
  function redraw() {
    const keepId = focusedHomeId();
    state.loaded = true;
    state.fresh = true;
    arrangeHome();
    renderHome(keepId);
    if (state.screen === 'settings') renderSettings();
    else if (state.screen === 'apps') renderApps();
  }

  function refreshApps() {
    const seq = ++listSeq;
    // An answer after the deadline still counts: the TV was only slow.
    const late = function (infos) {
      if (applyList(seq, infos)) redraw();
    };
    return CH.platform.listApps(late).then(function (infos) {
      applyList(seq, infos);
    }, function (err) {
      // Keep showing a cached list if there is one; say so only if not.
      if (seq >= appliedSeq && !state.raw.length) state.error = err;
    }).then(redraw);
  }

  // ---- Clock -------------------------------------------------------------------

  let clockTimer = null;

  function tick() {
    root.clearTimeout(clockTimer);
    // Runs even with Home's clock off: Ambient always shows its clock.
    const now = CH.platform.now();
    CH.ui.updateClock(now, state.settings.clock);
    // Rotate's next scene comes in on the quarter hour (or on coming back).
    if (state.screen === 'ambient') CH.ui.showWall(wallNow(), false, wallMoves());
    // Wake just after the next minute starts.
    clockTimer = root.setTimeout(tick, (60 - now.getSeconds()) * 1000 + 50);
  }

  // ---- Input -------------------------------------------------------------------

  // OK and Back act once per press. Remotes don't all mark auto-repeat, so a
  // keydown with no keyup since the last one also counts as held; the mark
  // expires in case the keyup went to the app we just opened.
  const held = {};

  function isHeld(event) {
    const now = Date.now();
    const last = held[event.keyCode];
    held[event.keyCode] = now;
    return event.repeat || (last !== undefined && now - last < 1000);
  }

  function clearHeld() {
    Object.keys(held).forEach(function (k) { delete held[k]; });
  }

  function onKey(event) {
    const key = CH.platform.keyName(event);
    if (!key) return;
    event.preventDefault();
    if ((key === 'ok' || key === 'back') && isHeld(event)) return;
    if (state.screen === 'home') onHomeKey(key);
    else if (state.screen === 'ambient') onAmbientKey(key);
    else if (state.screen === 'settings') onSettingsKey(key);
    else if (state.screen === 'apps') onAppsKey(key);
    else if (state.screen === 'music') onMusicKey(key);
  }

  function onKeyUp(event) {
    delete held[event.keyCode];
  }

  // Coming back from another app: the app list may have changed, and timers
  // were paused while hidden.
  function onVisibility() {
    clearHeld();
    if (doc.hidden) {
      cancelSwitch();
      CH.player.suspend();
      CH.reel.suspend();
      if (state.screen === 'ambient') CH.platform.screenSaver(true);
      return;
    }
    tick();
    refreshApps();
    prefetchInputs();
    if (state.screen === 'ambient') {
      CH.platform.screenSaver(false);
      CH.player.resume();
      CH.reel.resume();
      scheduleMove();
    }
  }

  function start() {
    const s = storage();
    state.settings = s ? CH.store.load(s) : CH.store.defaults();
    CH.ui.init();
    CH.reel.init(doc.getElementById('ambient'));
    CH.ui.applyLook(state.settings);
    const cached = s ? readCache() : null;
    if (cached) {
      setRaw(cached);
      state.loaded = true;
      arrangeHome();
    }
    renderHome(null);
    const ambient = s ? readAmbient() : {};
    const tracks = ambientTracks();
    CH.player.init(tracks, resumeIndex(tracks, ambient), onPlayer);
    // Left on Ambient (e.g. the TV went off with it showing): come back to it.
    if (ambient.open && state.settings.ambient === 'on') openAmbient(!ambient.paused);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('visibilitychange', onVisibility);
    root.addEventListener('blur', clearHeld);
    // Let the first frame and key presses through before the slow app list.
    root.setTimeout(function () {
      refreshApps();
      prefetchInputs();
    }, cached ? 600 : 0);
  }

  CH.main = { state: state, start: start, version: VERSION };
  start();
})(window);
