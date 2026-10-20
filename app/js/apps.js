// Turns the TV's installed-app list into launcher entries, and keeps the
// viewer's chosen order. Pure functions: no DOM, no Tizen calls.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  // Entries Tizen reports as visible that are still plumbing, not apps.
  // Ids alone can't be trusted further than this: Prime Video, for one, ships
  // under an org.tizen.* id.
  const NOISE = [
    /(^|[.\-_])(service|svc|daemon|agent|widget|plugin|helper|provider)s?$/i
  ];

  // Our own id, so the launcher never lists itself.
  CH.selfIdPrefix = 'CleanHub01.';

  function isNoise(info) {
    if (!info || typeof info.id !== 'string' || !info.id) return true;
    if (info.id.indexOf(CH.selfIdPrefix) === 0) return true;
    if (info.show === false) return true;
    const name = typeof info.name === 'string' ? info.name.trim() : '';
    if (!name) return true;
    for (let i = 0; i < NOISE.length; i++) {
      if (NOISE[i].test(info.id)) return true;
    }
    return false;
  }

  function findCatalog(info, catalog) {
    const name = info.name.trim();
    for (let i = 0; i < catalog.length; i++) {
      const c = catalog[i];
      if (c.ids && c.ids.indexOf(info.id) !== -1) return c;
    }
    for (let i = 0; i < catalog.length; i++) {
      if (catalog[i].match.test(name)) return catalog[i];
    }
    return null;
  }

  function monogram(name) {
    const words = name.replace(/[^A-Za-z0-9+ ]/g, ' ').trim().split(/\s+/);
    if (!words[0]) return '?';
    if (words.length === 1) return words[0].slice(0, 2);
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  // Stable fallback color from the app id, so unknown apps keep their color.
  function hashColor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 42%, 34%)';
  }

  // Returns [{ id, name, key, icon, mono, bg, fg }] sorted by name.
  // When two installed entries map to the same catalog app, the first wins.
  function normalize(infos, catalog) {
    const list = [];
    const seenIds = {};
    const seenKeys = {};
    (infos || []).forEach(function (info) {
      if (isNoise(info) || seenIds[info.id]) return;
      seenIds[info.id] = true;
      const c = findCatalog(info, catalog || []);
      if (c) {
        if (seenKeys[c.key]) return;
        seenKeys[c.key] = true;
      }
      list.push({
        id: info.id,
        name: c ? c.name : info.name.trim(),
        key: c ? c.key : null,
        icon: typeof info.iconPath === 'string' && info.iconPath ? info.iconPath : null,
        mono: c ? c.mono : monogram(info.name.trim()),
        bg: c ? c.bg : hashColor(info.id),
        fg: c ? c.fg : '#FFFFFF'
      });
    });
    list.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  // First-run selection: recognised apps in our preferred order.
  function pickDefault(entries, order, limit) {
    const byKey = {};
    entries.forEach(function (e) {
      if (e.key) byKey[e.key] = e;
    });
    const ids = [];
    order.forEach(function (key) {
      if (byKey[key] && ids.length < limit) ids.push(byKey[key].id);
    });
    if (ids.length === 0) {
      return entries.slice(0, limit).map(function (e) { return e.id; });
    }
    return ids;
  }

  // Entries for the home screen, in the saved order. Saved ids that are no
  // longer installed are skipped (but kept in settings, in case they return).
  function arrange(entries, savedIds, order, limit) {
    const ids = Array.isArray(savedIds) ? savedIds : pickDefault(entries, order, limit);
    const byId = {};
    entries.forEach(function (e) { byId[e.id] = e; });
    const out = [];
    ids.forEach(function (id) {
      if (byId[id]) out.push(byId[id]);
    });
    return out;
  }

  function move(ids, from, to) {
    const out = ids.slice();
    if (from < 0 || from >= out.length) return out;
    const clamped = Math.max(0, Math.min(out.length - 1, to));
    const item = out.splice(from, 1)[0];
    out.splice(clamped, 0, item);
    return out;
  }

  function toggle(ids, id) {
    const i = ids.indexOf(id);
    if (i === -1) return ids.concat([id]);
    return ids.slice(0, i).concat(ids.slice(i + 1));
  }

  CH.apps = {
    isNoise: isNoise,
    normalize: normalize,
    pickDefault: pickDefault,
    arrange: arrange,
    move: move,
    toggle: toggle,
    monogram: monogram
  };
})(typeof window !== 'undefined' ? window : globalThis);
