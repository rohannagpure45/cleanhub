// Settings: defaults, validation and persistence in localStorage.
// Anything unreadable falls back to defaults rather than breaking the home screen.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  const KEY = 'cleanhub.settings';
  const MAX_APPS = 40;

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
    music: 'all',
    input: 'off', // which HDMI input the Home 'Fire TV' item switches to
    brainrot: 'off', // Ambient shows the brainrot feed instead of the wallpaper
    apps: null // null = not chosen yet; the home screen picks recognised apps
  };

  function ids(name) {
    return CH.options[name].map(function (o) { return o.id; });
  }

  function sanitize(raw) {
    const out = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return out;
    if (raw.music === 'on') raw = Object.assign({}, raw, { music: 'all' }); // before the 1920s set
    Object.keys(CH.options).forEach(function (name) {
      if (ids(name).indexOf(raw[name]) !== -1) out[name] = raw[name];
    });
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

  CH.store = {
    KEY: KEY,
    MAX_APPS: MAX_APPS,
    defaults: function () { return Object.assign({}, DEFAULTS); },
    sanitize: sanitize,
    load: load,
    save: save,
    cycle: cycle,
    label: label
  };
})(typeof window !== 'undefined' ? window : globalThis);
