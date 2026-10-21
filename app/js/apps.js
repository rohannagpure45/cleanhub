// Turns the TV's installed-app list into launcher entries, and keeps the
// viewer's chosen order. Pure functions: no DOM, no Tizen calls.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  // Our own id, so the launcher never lists itself.
  CH.selfIdPrefix = 'CleanHub01.';

  // A Samsung store app id: ten letters or digits, a dot, then a name.
  const STORE_ID = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/;

  // getAppsInfo lists hundreds of entries on a real TV, and its `show` flag
  // also passes plenty of plumbing. These ids are never apps: placeholder
  // twins (org.tizen.primevideo-dummy), background companions
  // (MCmYXNxgcu.DisneyPlusService, ZmmGjO6VKO.slingtvBgservice), Cobalt
  // runtime copies, and Samsung utilities seen on 2022-2024 sets.
  const NOISE_ID = [
    /dummy/i,
    /(service|svc|daemon|agent|widget|plugin|helper|provider)s?$/i,
    /^com\.samsung\.tv\.cobalt-app-/i,
    /^adplatform\./i,
    /\.(cmsWebApp|emanual|WebAccountExtension|CastSettingsApp|PrivacyChoices|SmartTV|OTApp|SecurityCenter)$/
  ];

  // Names of plumbing that can still arrive with a store-style id.
  const NOISE_NAME = /\b(service|worker|plugin|sdk|factory|daemon|dummy|e-?manual|ad ?player)\b|^ep[ -]/i;

  function valid(info) {
    return !!info && typeof info.id === 'string' && info.id !== '' &&
      typeof info.name === 'string' && info.name.trim() !== '' &&
      info.id.indexOf(CH.selfIdPrefix) !== 0;
  }

  function noiseId(id) {
    for (let i = 0; i < NOISE_ID.length; i++) {
      if (NOISE_ID[i].test(id)) return true;
    }
    return false;
  }

  // The catalog app an entry is, and how sure we are (lower is better):
  // its position in the catalog's id list, then a name match on a store id,
  // then a name match on anything else.
  function recognise(info, catalog) {
    for (let i = 0; i < catalog.length; i++) {
      const at = catalog[i].ids ? catalog[i].ids.indexOf(info.id) : -1;
      if (at !== -1) return { app: catalog[i], rank: at };
    }
    const name = info.name.trim();
    for (let i = 0; i < catalog.length; i++) {
      if (catalog[i].match.test(name)) {
        return { app: catalog[i], rank: STORE_ID.test(info.id) ? 50 : 100 };
      }
    }
    return null;
  }

  // Kept for tests and the "everything" view: is this entry plumbing?
  function isNoise(info) {
    if (!valid(info) || info.show === false) return true;
    if (noiseId(info.id)) return true;
    return !STORE_ID.test(info.id) || NOISE_NAME.test(info.name);
  }

  function monogram(name) {
    const words = name.replace(/[^A-Za-z0-9+ ]/g, ' ').trim().split(/\s+/);
    if (!words[0]) return '?';
    if (words.length === 1) return words[0].slice(0, 2);
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  // Deep fills that keep light text readable, picked by app id so an unknown
  // app keeps its colour across renames.
  const FILLS = ['#56252A', '#154658', '#273F71', '#4C3A6B', '#164C62', '#633C58', '#514931', '#65462B'];

  function fillFor(id) {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return FILLS[h % FILLS.length];
  }

  function entry(info, app) {
    const name = info.name.trim();
    return {
      id: info.id,
      name: app && app.name ? app.name : name, // a catalog entry without a name keeps the TV's
      key: app ? app.key : null,
      icon: typeof info.iconPath === 'string' && info.iconPath ? info.iconPath : null,
      art: app && app.art !== false ? 'img/apps/' + app.key + '.png' : null, // our copy, tried before `icon`
      mono: app ? app.mono : monogram(name),
      bg: app ? app.bg : fillFor(info.id),
      fg: app ? app.fg : '#F4F1EA'
    };
  }

  // Returns [{ id, name, key, icon, art, mono, bg, fg }] sorted by name.
  // Recognised apps are kept even if the TV marks them hidden; when a TV lists
  // one app twice, the better-ranked id wins. Unrecognised entries must look
  // like store apps. With `everything`, only invalid entries are dropped (for
  // finding an app the filters miss).
  function normalize(infos, catalog, everything) {
    const best = {}; // catalog key -> { info, app, rank }
    const others = [];
    const seen = {};
    (Array.isArray(infos) ? infos : []).forEach(function (info) {
      if (!valid(info) || seen[info.id]) return;
      seen[info.id] = true;
      if (everything) {
        if (info.show !== false) others.push(entry(info, null));
        return;
      }
      if (noiseId(info.id)) return;
      const hit = recognise(info, catalog || []);
      if (hit && (hit.rank < 50 || info.show !== false)) {
        const prev = best[hit.app.key];
        if (!prev || hit.rank < prev.rank) best[hit.app.key] = { info: info, app: hit.app, rank: hit.rank };
        return;
      }
      if (!isNoise(info)) others.push(entry(info, null));
    });
    const list = others;
    Object.keys(best).forEach(function (key) {
      list.push(entry(best[key].info, best[key].app));
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

  // The catalog app a Tizen id belongs to (e.g. HBO Max's old and new ids
  // are both 'max'), or null.
  function catalogKey(id, catalog) {
    for (let i = 0; i < catalog.length; i++) {
      if (catalog[i].ids && catalog[i].ids.indexOf(id) !== -1) return catalog[i].key;
    }
    return null;
  }

  // Saved ids rewritten to the id the TV now lists for the same app, when an
  // app moved to a new id (HBO Max to Max, YouTube to its Cobalt build).
  // Returns null when nothing changed.
  function migrateIds(saved, entries, catalog) {
    const present = {};
    const byKey = {};
    entries.forEach(function (e) {
      present[e.id] = true;
      if (e.key) byKey[e.key] = e.id;
    });
    const seen = {};
    const out = [];
    let changed = false;
    saved.forEach(function (id) {
      let to = id;
      if (!present[id]) {
        const key = catalogKey(id, catalog);
        if (key && byKey[key]) to = byKey[key];
      }
      if (to !== id || seen[to]) changed = true;
      if (!seen[to]) {
        seen[to] = true;
        out.push(to);
      }
    });
    return changed ? out : null;
  }

  // The new saved list after the viewer edits what's on Home. `visibleIds` is
  // the edited order of the apps they can see; saved apps that aren't on the
  // TV right now (`present` lacks them) keep their slots, so an app that is
  // briefly missing during an update comes back where it was. Over `max`,
  // missing apps are dropped first, never ones the viewer can see.
  function mergeChosen(prev, visibleIds, present, max) {
    const queue = visibleIds.slice();
    const out = [];
    prev.forEach(function (id) {
      if (!present[id]) out.push(id);
      else if (queue.length) out.push(queue.shift());
    });
    const merged = out.concat(queue);
    for (let i = merged.length - 1; i >= 0 && merged.length > max; i--) {
      if (!present[merged[i]] && visibleIds.indexOf(merged[i]) === -1) merged.splice(i, 1);
    }
    return merged;
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
    catalogKey: catalogKey,
    migrateIds: migrateIds,
    mergeChosen: mergeChosen,
    monogram: monogram,
    fillFor: fillFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
