// Settings: defaults, validation and persistence in localStorage.
// Anything unreadable falls back to defaults rather than breaking the home screen.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  const KEY = 'cleanhub.settings';
  const MAX_APPS = 40;

  function genreIds() {
    return CH.genres.map(function (g) { return g.id; });
  }

  const DEFAULTS = {
    v: 1,
    layout: 'list',
    theme: 'dusk',
    font: 'manrope',
    focus: 'glass',
    icons: 'on',
    clock: '12',
    ambient: 'on',
    wallpaper: 'lamp',
    motion: 'on', // the wallpaper's layers move
    music: genreIds(), // Ambient's genres, ticked in Settings; [] = no music
    shuffle: 'on', // play them in a random order
    input: 'off', // which HDMI input the Home 'Fire TV' item switches to
    brainrot: 'off', // Ambient shows the brainrot feed instead of the wallpaper
    brainrotMusic: 'on', // its soundtrack; the reels' own sounds play either way
    apps: null // null = not chosen yet; the home screen picks recognised apps
  };

  function ids(name) {
    return CH.options[name].map(function (o) { return o.id; });
  }

  // The ticked genres, in CH.genres order. Older saves held one value: 'all'
  // ('on' before there were genres), 'off', or a single genre. A list of
  // genres that no longer exist falls back to all of them.
  function musicList(value) {
    const known = genreIds();
    if (value === 'off') return [];
    if (typeof value !== 'string' && !Array.isArray(value)) return known;
    const list = Array.isArray(value) ? value : [value];
    const ticked = known.filter(function (id) { return list.indexOf(id) !== -1; });
    return ticked.length || !list.length ? ticked : known;
  }

  function defaults() {
    return Object.assign({}, DEFAULTS, { music: DEFAULTS.music.slice() });
  }

  function sanitize(raw) {
    const out = defaults();
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(CH.options).forEach(function (name) {
      if (ids(name).indexOf(raw[name]) !== -1) out[name] = raw[name];
    });
    out.music = musicList(raw.music);
    if (Array.isArray(raw.apps)) {
      const seen = {};
      out.apps = raw.apps.filter(function (id) {
        if (typeof id !== 'string' || !id || seen[id]) return false;
        seen[id] = true;
        return true;
      }).slice(0, MAX_APPS);
    }
    return out;
  }

  function load(storage) {
    try {
      const text = storage.getItem(KEY);
      return sanitize(text ? JSON.parse(text) : null);
    } catch (e) {
      return sanitize(null);
    }
  }

  function save(storage, settings) {
    try {
      storage.setItem(KEY, JSON.stringify(sanitize(settings)));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Next or previous value of one option, wrapping (settings rows cycle).
  function cycle(settings, name, dir) {
    const list = ids(name);
    const i = list.indexOf(settings[name]);
    const next = list[(i + dir + list.length) % list.length];
    const out = Object.assign({}, settings);
    out[name] = next;
    return out;
  }

  function label(name, id) {
    const opts = CH.options[name];
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].id === id) return opts[i].name;
    }
    return id;
  }

  // Ticks or unticks one Ambient genre.
  function toggleGenre(settings, id) {
    const on = settings.music.indexOf(id) !== -1;
    const list = on ? settings.music.filter(function (g) { return g !== id; }) : settings.music.concat([id]);
    return Object.assign({}, settings, { music: musicList(list) });
  }

  // The Ambient music row's value: Off, All, the one genre, or how many.
  function musicLabel(list) {
    if (!list.length) return 'Off';
    if (list.length === CH.genres.length) return 'All';
    if (list.length > 1) return list.length + ' genres';
    for (let i = 0; i < CH.genres.length; i++) {
      if (CH.genres[i].id === list[0]) return CH.genres[i].name;
    }
    return list[0];
  }

  CH.store = {
    KEY: KEY,
    MAX_APPS: MAX_APPS,
    defaults: defaults,
    sanitize: sanitize,
    load: load,
    save: save,
    cycle: cycle,
    label: label,
    toggleGenre: toggleGenre,
    musicLabel: musicLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
