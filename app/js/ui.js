// Builds and updates the DOM. Rendering happens when data or settings change;
// focus moves only touch classes and transforms, so arrow keys stay cheap.
// Renders take the focused index and set it while building, before anything
// reads layout, so a re-render never replays focus transitions.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};
  const doc = root.document;

  const ICONS = {
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    check: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 20.5l5.5 5.5L28 15"/></svg>',
    move: '<svg class="move-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/></svg>',
    left: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>'
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Geometry the scroll maths relies on; app.css uses the same numbers.
  const LIST_PITCH = 104;
  const DOCK_MAX_WIDTH = 1696;
  const DOCK_GUTTER = 20; // between the dock's edge and its clip box: room for the cues and the focus ring

  function h(tag, cls, text) {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function svg(cls, markup) {
    const el = h('span', cls);
    el.innerHTML = markup;
    return el;
  }

  // ---- Look --------------------------------------------------------------

  function applyLook(settings) {
    const html = doc.documentElement;
    html.setAttribute('data-theme', settings.theme);
    html.setAttribute('data-font', settings.font);
    html.setAttribute('data-layout', settings.layout);
    html.setAttribute('data-focus', settings.focus);
    html.setAttribute('data-icons', settings.icons);
    html.setAttribute('data-clock', settings.clock);
    html.setAttribute('data-wallpaper', settings.wallpaper);
  }

  // Lines the pre-blurred background up with a panel, so the panel reads as
  // frosted glass over the real background. offsetLeft/Top ignore transforms,
  // so this is right even mid-animation.
  function alignGlass(el) {
    let x = 0;
    let y = 0;
    let node = el;
    while (node) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    el.style.backgroundPosition = (-x) + 'px ' + (-y) + 'px';
  }

  // Keeps the theme images decoded-ready, so switching themes never flashes
  // black while a 1920x1080 JPEG loads. Holding the Image objects keeps them
  // in the memory cache.
  const warmed = [];

  function warmThemes(themes) {
    if (warmed.length) return;
    themes.forEach(function (t) {
      ['bg-' + t, 'bg-' + t + '-blur', 'thumb-' + t].forEach(function (name) {
        const img = new root.Image();
        img.src = 'img/' + name + '.jpg';
        warmed.push(img);
      });
    });
  }

  // ---- Clock ---------------------------------------------------------------

  function formatClock(date, mode) {
    const hours = date.getHours();
    const mins = date.getMinutes();
    const mm = (mins < 10 ? '0' : '') + mins;
    const day = DAYS[date.getDay()] + ', ' + MONTHS[date.getMonth()] + ' ' + date.getDate();
    if (mode === '24') {
      return { time: (hours < 10 ? '0' : '') + hours + ':' + mm, ampm: '', date: day };
    }
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return { time: h12 + ':' + mm, ampm: hours < 12 ? 'AM' : 'PM', date: day };
  }

  function clockEl() {
    const el = h('header', 'clock');
    const line = h('div', 'clock-line');
    line.appendChild(h('span', 'clock-time'));
    line.appendChild(h('span', 'clock-ampm'));
    el.appendChild(line);
    el.appendChild(h('div', 'clock-date'));
    return el;
  }

  // Home's clock and the Ambient screen's clock.
  function updateClock(date, mode) {
    const parts = formatClock(date, mode === 'off' ? '12' : mode);
    Array.prototype.forEach.call(doc.querySelectorAll('.clock'), function (el) {
      el.querySelector('.clock-time').textContent = parts.time;
      el.querySelector('.clock-ampm').textContent = parts.ampm;
      el.querySelector('.clock-date').textContent = parts.date;
    });
  }

  // ---- Tiles ---------------------------------------------------------------

  // Monogram first; the TV's own icon goes on top only once it has loaded,
  // so a transparent logo never shows the letters through it.
  function tile(entry) {
    const el = h('span', 'tile');
    el.style.backgroundColor = entry.bg;
    el.style.color = entry.fg;
    if (entry.svg) {
      el.className += ' tile-glyph';
      el.innerHTML = entry.svg;
      return el;
    }
    el.appendChild(h('span', 'tile-mono', entry.mono));
    const url = CH.platform.iconUrl(entry.icon);
    if (url) {
      const img = doc.createElement('img');
      img.alt = '';
      img.onload = function () {
        if (img.naturalWidth) el.classList.add('has-icon');
      };
      img.onerror = function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      };
      img.src = url;
      el.appendChild(img);
    }
    return el;
  }

  // ---- Home ----------------------------------------------------------------

  const home = {
    root: null,
    items: [], // app items, in order
    gear: null, // Settings, fixed top right
    track: null,
    view: null,
    pill: null,
    label: null,
    dock: null,
    cueBefore: null,
    cueAfter: null,
    entries: [],
    layout: 'list',
    first: 0 // first fully visible list row
  };

  function gearEl(focused) {
    const el = h('div', 'gear' + (focused ? ' is-focused' : ''));
    el.setAttribute('data-settings', '');
    el.appendChild(svg('gear-icon', ICONS.sliders));
    el.appendChild(h('span', 'gear-label', 'Settings'));
    return el;
  }

  // entries: apps for the home screen. Settings is a fixed button top right,
  // reached with Right (list) or Up (dock). `focus` is { index, gear }.
  // `note` is shown when there is nothing to list.
  function renderHome(container, entries, settings, note, focus) {
    container.innerHTML = '';
    home.root = container;
    home.entries = entries;
    home.layout = settings.layout;
    home.items = [];
    home.first = 0;
    container.appendChild(clockEl());
    home.gear = gearEl(focus.gear);
    container.appendChild(home.gear);
    if (settings.layout === 'dock') {
      renderDock(container, entries, note, focus);
    } else {
      renderList(container, entries, note, focus);
    }
    focusHome(focus.index, focus.gear, true);
  }

  function cue(cls, icon) {
    return svg('cue ' + cls, icon);
  }

  function renderList(container, entries, note, focus) {
    const view = h('div', 'list-view');
    const track = h('div', 'list-track');
    const pill = h('div', 'pill');
    track.appendChild(pill);
    // With nothing to list the note takes the list's place; otherwise (only
    // Ambient, say) it sits under the rows.
    if (note && !entries.length) container.appendChild(h('div', 'empty list-empty', note));
    entries.forEach(function (entry, i) {
      const row = h('div', 'list-row' + (!focus.gear && i === focus.index ? ' is-focused' : ''));
      row.setAttribute('data-index', String(i));
      row.setAttribute('data-app', entry.id);
      row.appendChild(h('span', 'mark'));
      row.appendChild(tile(entry));
      row.appendChild(h('span', 'list-name', entry.name));
      track.appendChild(row);
      home.items.push(row);
    });
    if (note && entries.length) track.appendChild(h('div', 'empty list-note', note));
    view.appendChild(track);
    container.appendChild(view);
    home.cueBefore = cue('cue-list cue-up', ICONS.up);
    home.cueAfter = cue('cue-list cue-down', ICONS.down);
    container.appendChild(home.cueBefore);
    container.appendChild(home.cueAfter);
    home.view = view;
    home.track = track;
    home.pill = pill;
    home.label = null;
    home.dock = null;
    if (!entries.length) pill.style.visibility = 'hidden';
  }

  function renderDock(container, entries, note, focus) {
    const label = h('div', 'dock-label');
    container.appendChild(label);
    home.label = label;
    home.pill = null;
    if (note) container.appendChild(h('div', 'empty dock-empty', note));
    if (!entries.length) {
      home.dock = home.view = home.track = home.cueBefore = home.cueAfter = null;
      return;
    }
    const dock = h('div', 'glass dock');
    const view = h('div', 'dock-view');
    const track = h('div', 'dock-track');
    entries.forEach(function (entry, i) {
      const item = h('div', 'dock-item' + (!focus.gear && i === focus.index ? ' is-focused' : ''));
      item.setAttribute('data-index', String(i));
      item.setAttribute('data-app', entry.id);
      item.appendChild(tile(entry));
      item.appendChild(h('span', 'dock-ring'));
      track.appendChild(item);
      home.items.push(item);
    });
    view.appendChild(track);
    dock.appendChild(view);
    home.cueBefore = cue('cue-dock cue-left', ICONS.left);
    home.cueAfter = cue('cue-dock cue-right', ICONS.right);
    dock.appendChild(home.cueBefore);
    dock.appendChild(home.cueAfter);
    container.appendChild(dock);
    // Size the dock to its apps (centred), up to the safe width.
    const width = Math.min(DOCK_MAX_WIDTH, track.scrollWidth + 2 * DOCK_GUTTER);
    dock.style.width = width + 'px';
    dock.style.left = Math.round((1920 - width) / 2) + 'px';
    view.style.width = (width - 2 * DOCK_GUTTER) + 'px';
    label.style.left = (Math.round((1920 - width) / 2) + 2 * DOCK_GUTTER) + 'px';
    alignGlass(dock);
    home.dock = dock;
    home.view = view;
    home.track = track;
  }

  // Sets a transform, skipping the transition when `instant` (after a re-render,
  // so things don't fly in from the top).
  function place(el, transform, instant) {
    if (!instant) {
      el.style.transform = transform;
      return;
    }
    el.style.transition = 'none';
    el.style.transform = transform;
    void el.offsetHeight; // commit the jump before transitions come back
    el.style.transition = '';
  }

  // Keeps the focused item inside its viewport, centring it where possible.
  function scrollOffset(itemStart, itemSize, viewSize, trackSize) {
    const maxOffset = Math.max(0, trackSize - viewSize);
    const centred = itemStart - (viewSize - itemSize) / 2;
    return Math.max(0, Math.min(maxOffset, centred));
  }

  // List scrolling by whole rows: the window moves only when focus would reach
  // its first or last row, so no row is ever cut in half.
  function listFirst(first, index, count, visible) {
    const maxFirst = Math.max(0, count - visible);
    let f = Math.min(first, index - 1);
    f = Math.max(f, index - visible + 2);
    return Math.max(0, Math.min(maxFirst, f));
  }

  function showCues(before, after) {
    if (home.cueBefore) home.cueBefore.classList.toggle('is-shown', before);
    if (home.cueAfter) home.cueAfter.classList.toggle('is-shown', after);
  }

  // index: the remembered app; gear: Settings has focus instead.
  function focusHome(index, gear, instant) {
    const onGear = gear || !home.items.length;
    home.items.forEach(function (el, i) {
      el.classList.toggle('is-focused', !onGear && i === index);
    });
    home.gear.classList.toggle('is-focused', onGear);
    const el = home.items[index];
    if (home.layout === 'dock') {
      if (home.label) home.label.textContent = onGear || !el ? '' : home.entries[index].name;
      if (!el) return;
      const offset = scrollOffset(el.offsetLeft, el.offsetWidth, home.view.offsetWidth, home.track.scrollWidth);
      place(home.track, 'translateX(' + (-offset) + 'px)', instant);
      showCues(offset > 0.5, offset < home.track.scrollWidth - home.view.offsetWidth - 0.5);
      return;
    }
    if (!el) {
      showCues(false, false);
      return;
    }
    home.pill.style.visibility = onGear ? 'hidden' : '';
    place(home.pill, 'translateY(' + el.offsetTop + 'px)', instant);
    const visible = Math.floor(home.view.offsetHeight / LIST_PITCH);
    home.first = listFirst(home.first, index, home.items.length, visible);
    place(home.track, 'translateY(' + (-home.first * LIST_PITCH) + 'px)', instant);
    showCues(home.first > 0, home.first + visible < home.items.length);
  }

  function pressHome(index) {
    const el = home.items[index];
    if (!el) return;
    el.style.opacity = '0.6';
    root.setTimeout(function () { el.style.opacity = ''; }, 160);
  }

  function dimHome(dimmed) {
    if (home.root) home.root.classList.toggle('is-dimmed', dimmed);
  }

  // ---- Settings sheet --------------------------------------------------------

  const sheet = {
    el: null,
    rows: [],
    track: null,
    view: null,
    pill: null,
    hint: null,
    cueBefore: null,
    cueAfter: null,
    title: '',
    offset: 0, // current scroll of the sheet's rows
    hintSaved: [] // the hint's keys while a message stands in for them
  };

  function fillHint(el, parts) {
    el.innerHTML = '';
    parts.forEach(function (p, i) {
      if (i) el.appendChild(h('span', 'hint-gap'));
      el.appendChild(h('span', 'key', p[0]));
      el.appendChild(doc.createTextNode(p[1]));
    });
    return el;
  }

  // A re-render of the same sheet keeps its scroll; a different sheet starts at the top.
  function sheetFrame(title, sub, keys) {
    const el = sheet.el;
    el.innerHTML = '';
    if (sheet.title !== title) sheet.offset = 0;
    sheet.title = title;
    const inner = h('div', 'sheet-inner');
    inner.appendChild(h('h1', 'sheet-title', title));
    if (sub) inner.appendChild(h('div', 'sheet-sub', sub));
    const view = h('div', 'sheet-view');
    const track = h('div', 'sheet-track');
    const pill = h('div', 'pill');
    track.appendChild(pill);
    view.appendChild(track);
    inner.appendChild(view);
    sheet.cueBefore = svg('cue cue-sheet cue-up', ICONS.up);
    sheet.cueAfter = svg('cue cue-sheet cue-down', ICONS.down);
    inner.appendChild(sheet.cueBefore);
    inner.appendChild(sheet.cueAfter);
    sheet.hint = fillHint(h('div', 'sheet-hint'), keys);
    inner.appendChild(sheet.hint);
    el.appendChild(inner);
    sheet.rows = [];
    sheet.view = view;
    sheet.track = track;
    sheet.pill = pill;
    return inner;
  }

  function optionRow(name, label, settings) {
    const row = h('div', 'sheet-row');
    row.setAttribute('data-option', name);
    row.appendChild(h('span', 'sheet-label', label));
    const value = h('span', 'sheet-value');
    value.insertAdjacentHTML('beforeend', ICONS.left);
    if (name === 'theme') {
      const sw = h('span', 'swatch');
      sw.style.backgroundImage = 'url(img/thumb-' + settings.theme + '.jpg)';
      value.appendChild(sw);
    }
    const text = h('span', 'sheet-value-text', CH.store.label(name, settings[name]));
    if (name === 'font') {
      text.style.fontFamily = { manrope: 'Manrope', fraunces: 'Fraunces', grotesk: 'Space Grotesk' }[settings.font];
    }
    value.appendChild(text);
    value.insertAdjacentHTML('beforeend', ICONS.right);
    row.appendChild(value);
    return row;
  }

  function actionRow(kind, label, value, danger) {
    const row = h('div', 'sheet-row' + (danger ? ' sheet-row-danger' : ''));
    row.setAttribute('data-action', kind);
    row.appendChild(h('span', 'sheet-label', label));
    if (value) {
      const v = h('span', 'sheet-value', value);
      v.insertAdjacentHTML('beforeend', ICONS.right);
      row.appendChild(v);
    }
    return row;
  }

  function addRow(row, focused) {
    if (focused) row.classList.add('is-focused');
    sheet.track.appendChild(row);
    sheet.rows.push(row);
  }

  // Main settings. `ctx` carries counts and the reset confirmation state.
  function renderSettings(settings, ctx, focusIndex) {
    sheetFrame('Settings', ctx.version ? 'Clean Hub ' + ctx.version : '',
      [['◀ ▶', 'Change'], ['OK', 'Open'], ['Back', 'Close']]);
    const count = ctx.homeCount === 1 ? '1 app' : ctx.homeCount + ' apps';
    CH.settingRows.forEach(function (r, i) {
      let row;
      if (r.id === 'apps') row = actionRow('apps', r.label, count);
      else if (r.id === 'reset') row = actionRow('reset', ctx.confirmReset ? 'Press OK again to reset everything' : r.label, '', true);
      else row = optionRow(r.id, r.label, settings);
      addRow(row, i === focusIndex);
    });
    alignGlass(sheet.el);
    focusSheet(focusIndex, true);
  }

  function appsHint(rows, moving, focusIndex, full) {
    const focused = rows[focusIndex];
    if (moving !== -1) return [['▲ ▼', 'Move'], ['OK', 'Done'], ['Back', 'Cancel']];
    if (!focused) return [['OK', 'Switch'], ['Back', 'Settings']];
    if (focused.on) return [['OK', 'Move'], ['◀', 'Remove'], ['Back', 'Settings']];
    if (full) return [['Back', 'Settings']];
    return [['OK', 'Add to Home'], ['Back', 'Settings']];
  }

  const appsCtx = { rows: [], moving: -1, full: false };

  // Focus moved in the apps sheet: only the hint line depends on it.
  function updateAppsHint(focusIndex) {
    if (sheet.hint) fillHint(sheet.hint, appsHint(appsCtx.rows, appsCtx.moving, focusIndex, appsCtx.full));
  }

  // rows: [{ entry, on, order }]; moving: index of the row being moved, or -1.
  // The last focusable row switches between apps only and every TV entry.
  // opts: { everything, failed, full }.
  function renderAppsSheet(rows, moving, focusIndex, opts) {
    const onCount = rows.filter(function (r) { return r.on; }).length;
    appsCtx.rows = rows;
    appsCtx.moving = moving;
    appsCtx.full = !!opts.full;
    sheetFrame('Apps on Home', onCount + ' on Home' + (opts.full ? ' · full' : ''),
      appsHint(rows, moving, focusIndex, opts.full));
    sheet.pill.className = 'pill' + (moving !== -1 ? ' is-moving' : '');
    let lastOn = null;
    rows.forEach(function (r, i) {
      if (lastOn !== r.on) {
        sheet.track.appendChild(h('div', 'sheet-section', r.on ? 'On Home' : (opts.everything ? 'Everything the TV lists' : 'Not on Home')));
        lastOn = r.on;
      }
      const row = h('div', 'sheet-row' + (r.on ? ' is-on' : '') + (i === moving ? ' is-moving' : ''));
      row.setAttribute('data-app', r.entry.id);
      row.appendChild(svg('check', ICONS.check));
      row.appendChild(tile(r.entry));
      row.appendChild(h('span', 'sheet-label', r.entry.name));
      row.appendChild(orderEl(r, i === moving));
      addRow(row, i === focusIndex);
    });
    if (!rows.length) {
      sheet.track.appendChild(h('div', 'empty sheet-empty',
        opts.failed ? 'Couldn’t read this TV’s app list. Try again in a moment.' : 'No apps found on this TV.'));
    }
    sheet.track.appendChild(h('div', 'sheet-section', 'Missing an app?'));
    addRow(actionRow('everything', opts.everything ? 'Show only recognised apps' : 'Show everything the TV lists', ''),
      focusIndex === rows.length);
    alignGlass(sheet.el);
    focusSheet(focusIndex, true);
  }

  function orderEl(r, moving) {
    if (moving) return svg('order', ICONS.move);
    return h('span', 'order', r.on ? String(r.order + 1) : '');
  }

  // One step of a move: swap the row with its neighbour in place instead of
  // rebuilding the sheet (which is slow with "Show everything" on a TV).
  function moveAppsRow(from, to) {
    const el = sheet.rows[from];
    const other = sheet.rows[to];
    if (!el || !other || from === to) return;
    if (to < from) sheet.track.insertBefore(el, other);
    else sheet.track.insertBefore(el, other.nextSibling);
    sheet.rows.splice(from, 1);
    sheet.rows.splice(to, 0, el);
    const r = appsCtx.rows.splice(from, 1)[0];
    appsCtx.rows.splice(to, 0, r);
    appsCtx.moving = to;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let i = lo; i <= hi; i++) {
      if (i !== to) sheet.rows[i].querySelector('.order').textContent = String(i + 1);
    }
    focusSheet(to);
  }

  // Scrolls so the focused row and one neighbour are visible, then snaps the
  // window to the top of a row or section, so nothing sits half-cut under the
  // title.
  function sheetOffset(el) {
    const view = sheet.view.offsetHeight;
    const max = Math.max(0, sheet.track.offsetHeight - view);
    const current = sheet.offset || 0;
    const margin = el.offsetHeight;
    let offset = current;
    if (el.offsetTop - margin < offset) offset = el.offsetTop - margin;
    if (el.offsetTop + el.offsetHeight + margin > offset + view) offset = el.offsetTop + el.offsetHeight + margin - view;
    offset = Math.max(0, Math.min(max, offset));
    let snapped = 0;
    const kids = sheet.track.children;
    for (let i = 0; i < kids.length; i++) {
      const top = kids[i].offsetTop;
      if (kids[i] !== sheet.pill && top <= offset + 0.5 && top > snapped) snapped = top;
    }
    return snapped;
  }

  function focusSheet(index, instant) {
    sheet.rows.forEach(function (el, i) {
      el.classList.toggle('is-focused', i === index);
    });
    const el = sheet.rows[index];
    sheet.pill.style.visibility = el ? '' : 'hidden';
    if (!el) return;
    sheet.pill.style.height = el.offsetHeight + 'px';
    place(sheet.pill, 'translateY(' + el.offsetTop + 'px)', instant);
    sheet.offset = sheetOffset(el);
    place(sheet.track, 'translateY(' + (-sheet.offset) + 'px)', instant);
    const max = sheet.track.offsetHeight - sheet.view.offsetHeight;
    sheet.cueBefore.classList.toggle('is-shown', sheet.offset > 0.5);
    sheet.cueAfter.classList.toggle('is-shown', sheet.offset < max - 0.5);
  }

  function openSheet(open) {
    sheet.el.classList.toggle('is-open', open);
    dimHome(open);
  }

  // ---- Ambient -------------------------------------------------------------------

  // A near-black wallpaper with a small, dim clock and the track name. Nothing
  // animates: the text block moves to another corner every few minutes (so no
  // spot stays lit all day) and the clock changes once a minute.
  const AMBIENT_SPOTS = ['spot-bl', 'spot-br', 'spot-tr', 'spot-tl'];

  const amb = {
    el: null,
    text: null,
    title: null,
    status: null,
    controls: null,
    controlsTitle: null,
    controlsArtist: null,
    hint: null,
    spot: 0
  };

  function renderAmbient() {
    const el = amb.el;
    el.innerHTML = '';
    el.appendChild(h('div', 'ambient-wall'));
    const text = h('div', 'ambient-text ' + AMBIENT_SPOTS[amb.spot]);
    text.appendChild(clockEl());
    const now = h('div', 'ambient-now');
    amb.title = h('span', 'ambient-title');
    amb.status = h('span', 'ambient-status');
    now.appendChild(amb.title);
    now.appendChild(amb.status);
    text.appendChild(now);
    el.appendChild(text);
    const controls = h('div', 'ambient-controls');
    amb.controlsTitle = h('div', 'ambient-controls-title');
    amb.controlsArtist = h('div', 'ambient-controls-artist');
    amb.hint = h('div', 'ambient-hint');
    controls.appendChild(amb.controlsTitle);
    controls.appendChild(amb.controlsArtist);
    controls.appendChild(amb.hint);
    el.appendChild(controls);
    amb.text = text;
    amb.controls = controls;
  }

  function openAmbient(open) {
    amb.el.classList.toggle('is-open', open);
  }

  // st: CH.player.state(); musicOn: the Ambient music setting.
  function updateAmbient(st, musicOn) {
    const t = st.track;
    let status = '';
    if (!musicOn) status = 'Music off';
    else if (!st.count) status = 'No music bundled';
    else if (st.broken) status = 'Music can’t play on this TV';
    else if (st.blocked) status = 'Press OK to play';
    else if (!st.playing) status = 'Paused';
    amb.title.textContent = musicOn && t ? t.title : '';
    amb.status.textContent = status;
    amb.controlsTitle.textContent = musicOn && t ? t.title : 'Ambient';
    amb.controlsArtist.textContent = musicOn && t ? [t.artist, t.year].filter(Boolean).join(' · ') : status;
    const keys = musicOn && st.count
      ? [['OK', st.playing ? 'Pause' : 'Play'], ['◀ ▶', 'Track'], ['▲ ▼', 'Wallpaper'], ['Back', 'Home']]
      : [['▲ ▼', 'Wallpaper'], ['Back', 'Home']];
    fillHint(amb.hint, keys);
  }

  function showAmbientControls(show) {
    amb.controls.classList.toggle('is-shown', show);
  }

  // Fades the text out, moves it to the next corner, fades it back in.
  function moveAmbientText() {
    const text = amb.text;
    text.classList.add('is-moving');
    root.setTimeout(function () {
      text.classList.remove(AMBIENT_SPOTS[amb.spot]);
      amb.spot = (amb.spot + 1) % AMBIENT_SPOTS.length;
      text.classList.add(AMBIENT_SPOTS[amb.spot]);
      text.classList.remove('is-moving');
    }, 1600);
  }

  // ---- Messages --------------------------------------------------------------

  let toastTimer = null;

  // A short message. With the sheet open it replaces the sheet's hint line
  // (the toast would sit on top of it); otherwise it shows as a toast.
  function toast(message) {
    root.clearTimeout(toastTimer);
    if (sheet.el.classList.contains('is-open') && sheet.hint) {
      const hintEl = sheet.hint;
      const showing = hintEl.firstChild && hintEl.firstChild.className === 'hint-message';
      // A second message in a row restores the original keys, not the first message.
      const saved = showing ? sheet.hintSaved : Array.prototype.slice.call(hintEl.childNodes);
      sheet.hintSaved = saved;
      hintEl.innerHTML = '';
      const msg = h('span', 'hint-message', message);
      hintEl.appendChild(msg);
      toastTimer = root.setTimeout(function () {
        if (msg.parentNode !== hintEl) return; // the hint was redrawn meanwhile
        hintEl.innerHTML = '';
        saved.forEach(function (n) { hintEl.appendChild(n); });
      }, 3200);
      return;
    }
    const el = doc.getElementById('toast');
    el.innerHTML = '';
    el.appendChild(h('span', null, message));
    el.classList.add('is-shown');
    toastTimer = root.setTimeout(function () {
      el.classList.remove('is-shown');
    }, 3200);
  }

  function init() {
    sheet.el = doc.getElementById('sheet');
    amb.el = doc.getElementById('ambient');
    renderAmbient();
  }

  CH.ui = {
    init: init,
    applyLook: applyLook,
    warmThemes: warmThemes,
    formatClock: formatClock,
    updateClock: updateClock,
    renderHome: renderHome,
    focusHome: focusHome,
    pressHome: pressHome,
    renderSettings: renderSettings,
    renderAppsSheet: renderAppsSheet,
    updateAppsHint: updateAppsHint,
    moveAppsRow: moveAppsRow,
    focusSheet: focusSheet,
    openSheet: openSheet,
    openAmbient: openAmbient,
    updateAmbient: updateAmbient,
    showAmbientControls: showAmbientControls,
    moveAmbientText: moveAmbientText,
    toast: toast,
    scrollOffset: scrollOffset,
    listFirst: listFirst
  };
})(typeof window !== 'undefined' ? window : globalThis);
