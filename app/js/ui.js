// Builds and updates the DOM. Rendering happens when data or settings change;
// focus moves only touch classes and transforms, so arrow keys stay cheap.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};
  const doc = root.document;

  const ICONS = {
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    check: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 20.5l5.5 5.5L28 15"/></svg>',
    left: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>'
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function h(tag, cls, text) {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
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

  function updateClock(date, mode) {
    const el = doc.querySelector('.clock');
    if (!el || mode === 'off') return;
    const parts = formatClock(date, mode);
    el.querySelector('.clock-time').textContent = parts.time;
    el.querySelector('.clock-ampm').textContent = parts.ampm;
    el.querySelector('.clock-date').textContent = parts.date;
  }

  // ---- Tiles ---------------------------------------------------------------

  function tile(entry) {
    const el = h('span', 'tile');
    el.style.backgroundColor = entry.bg;
    el.style.color = entry.fg;
    el.appendChild(h('span', 'tile-mono', entry.mono));
    const url = CH.platform.iconUrl(entry.icon);
    if (url) {
      const img = doc.createElement('img');
      img.alt = '';
      // Keep the monogram if the TV won't hand over the icon file.
      img.onerror = function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      };
      img.src = url;
      el.appendChild(img);
    }
    return el;
  }

  function settingsTile() {
    const el = h('span', 'tile tile-icon');
    el.innerHTML = ICONS.sliders;
    return el;
  }

  // ---- Home ----------------------------------------------------------------

  const home = {
    root: null,
    items: [],
    track: null,
    view: null,
    pill: null,
    label: null,
    entries: [],
    layout: 'list'
  };

  // entries: apps for the home screen. The last focusable item is always
  // Settings. `note` is shown when there is nothing to list.
  function renderHome(container, entries, settings, note) {
    container.innerHTML = '';
    home.root = container;
    home.entries = entries;
    home.layout = settings.layout;
    home.items = [];
    container.appendChild(clockEl());
    if (settings.layout === 'dock') {
      renderDock(container, entries, note);
    } else {
      renderList(container, entries, note);
    }
  }

  function renderList(container, entries, note) {
    const view = h('div', 'list-view');
    const track = h('div', 'list-track');
    const pill = h('div', 'pill');
    track.appendChild(pill);
    if (note) track.appendChild(h('div', 'empty list-empty', note));
    entries.forEach(function (entry, i) {
      const row = h('div', 'list-row');
      row.setAttribute('data-index', String(i));
      row.setAttribute('data-app', entry.id);
      row.appendChild(h('span', 'mark'));
      row.appendChild(tile(entry));
      row.appendChild(h('span', 'list-name', entry.name));
      track.appendChild(row);
      home.items.push(row);
    });
    const settingsRow = h('div', 'list-row list-row-settings');
    settingsRow.setAttribute('data-index', String(entries.length));
    settingsRow.setAttribute('data-settings', '');
    settingsRow.appendChild(h('span', 'mark'));
    settingsRow.appendChild(settingsTile());
    settingsRow.appendChild(h('span', 'list-name', 'Settings'));
    track.appendChild(settingsRow);
    home.items.push(settingsRow);
    view.appendChild(track);
    container.appendChild(view);
    home.view = view;
    home.track = track;
    home.pill = pill;
    home.label = null;
  }

  function renderDock(container, entries, note) {
    const label = h('div', 'dock-label');
    container.appendChild(label);
    if (note) container.appendChild(h('div', 'empty dock-empty', note));
    const dock = h('div', 'glass dock');
    const view = h('div', 'dock-view');
    const track = h('div', 'dock-track');
    entries.forEach(function (entry, i) {
      const item = h('div', 'dock-item');
      item.setAttribute('data-index', String(i));
      item.setAttribute('data-app', entry.id);
      item.appendChild(tile(entry));
      item.appendChild(h('span', 'dock-ring'));
      track.appendChild(item);
      home.items.push(item);
    });
    if (entries.length) track.appendChild(h('span', 'dock-sep'));
    const gear = h('div', 'dock-item dock-item-settings');
    gear.setAttribute('data-index', String(entries.length));
    gear.setAttribute('data-settings', '');
    gear.appendChild(settingsTile());
    gear.appendChild(h('span', 'dock-ring'));
    track.appendChild(gear);
    home.items.push(gear);
    view.appendChild(track);
    dock.appendChild(view);
    container.appendChild(dock);
    alignGlass(dock);
    home.view = view;
    home.track = track;
    home.pill = null;
    home.label = label;
    if (note) label.style.visibility = 'hidden';
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

  function focusHome(index, instant) {
    home.items.forEach(function (el, i) {
      el.classList.toggle('is-focused', i === index);
    });
    const el = home.items[index];
    if (!el) return;
    if (home.layout === 'dock') {
      const isSettings = index === home.entries.length;
      home.label.textContent = isSettings ? 'Settings' : home.entries[index].name;
      const offset = scrollOffset(el.offsetLeft, el.offsetWidth, home.view.offsetWidth, home.track.scrollWidth);
      place(home.track, 'translateX(' + (-offset) + 'px)', instant);
    } else {
      home.pill.style.height = el.offsetHeight + 'px';
      place(home.pill, 'translateY(' + el.offsetTop + 'px)', instant);
      const offset = scrollOffset(el.offsetTop, el.offsetHeight, home.view.offsetHeight, home.track.offsetHeight);
      place(home.track, 'translateY(' + (-offset) + 'px)', instant);
    }
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
    pill: null
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

  function hint(parts) {
    return fillHint(h('div', 'sheet-hint'), parts);
  }

  function sheetFrame(title, sub) {
    const el = sheet.el;
    el.innerHTML = '';
    const inner = h('div', 'sheet-inner');
    inner.appendChild(h('h1', 'sheet-title', title));
    if (sub) inner.appendChild(h('div', 'sheet-sub', sub));
    const view = h('div', 'sheet-view');
    const track = h('div', 'sheet-track');
    const pill = h('div', 'pill');
    track.appendChild(pill);
    view.appendChild(track);
    inner.appendChild(view);
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

  function addRow(row) {
    sheet.track.appendChild(row);
    sheet.rows.push(row);
  }

  // Main settings. `ctx` carries counts and the reset confirmation state.
  function renderSettings(settings, ctx) {
    const inner = sheetFrame('Settings', ctx.version ? 'Clean Hub ' + ctx.version : '');
    const count = ctx.homeCount === 1 ? '1 app' : ctx.homeCount + ' apps';
    addRow(actionRow('apps', 'Apps on Home', count));
    addRow(optionRow('layout', 'Layout', settings));
    addRow(optionRow('theme', 'Background', settings));
    addRow(optionRow('font', 'Font', settings));
    addRow(optionRow('focus', 'Focus style', settings));
    addRow(optionRow('icons', 'Icons in list', settings));
    addRow(optionRow('clock', 'Clock', settings));
    addRow(actionRow('reset', ctx.confirmReset ? 'Press OK again to reset everything' : 'Reset to defaults', '', true));
    inner.appendChild(hint([['◀ ▶', 'Change'], ['OK', 'Open'], ['Back', 'Close']]));
    alignGlass(sheet.el);
  }

  function appsHint(rows, moving, focusIndex) {
    const focused = rows[focusIndex];
    if (moving !== -1) return [['▲ ▼', 'Move'], ['OK', 'Done'], ['Back', 'Cancel']];
    if (!focused) return [['OK', 'Switch'], ['Back', 'Settings']];
    if (focused.on) return [['OK', 'Move'], ['◀', 'Remove'], ['Back', 'Settings']];
    return [['OK', 'Add to Home'], ['Back', 'Settings']];
  }

  // Focus moved in the apps sheet: only the hint line depends on it.
  function updateAppsHint(rows, moving, focusIndex) {
    const el = sheet.el.querySelector('.sheet-hint');
    if (el) fillHint(el, appsHint(rows, moving, focusIndex));
  }

  // rows: [{ entry, on, order }]; moving: index of the row being moved, or -1.
  // The last focusable row switches between apps only and every TV entry.
  function renderAppsSheet(rows, moving, focusIndex, everything) {
    const onCount = rows.filter(function (r) { return r.on; }).length;
    const inner = sheetFrame('Apps on Home', onCount + ' on Home');
    let lastOn = null;
    rows.forEach(function (r, i) {
      if (lastOn !== r.on) {
        sheet.track.appendChild(h('div', 'sheet-section', r.on ? 'On Home' : (everything ? 'Everything the TV lists' : 'Not on Home')));
        lastOn = r.on;
      }
      const row = h('div', 'sheet-row' + (r.on ? ' is-on' : '') + (i === moving ? ' is-moving' : ''));
      row.setAttribute('data-app', r.entry.id);
      const check = h('span', 'check');
      check.innerHTML = ICONS.check;
      row.appendChild(check);
      row.appendChild(tile(r.entry));
      row.appendChild(h('span', 'sheet-label', r.entry.name));
      row.appendChild(h('span', 'order', r.on ? (i === moving ? '↕' : String(r.order + 1)) : ''));
      addRow(row);
    });
    if (!rows.length) {
      sheet.track.appendChild(h('div', 'empty sheet-section', 'No apps found on this TV.'));
    }
    sheet.track.appendChild(h('div', 'sheet-section', 'Missing an app?'));
    const toggle = actionRow('everything', everything ? 'Show only recognised apps' : 'Show everything the TV lists', '');
    addRow(toggle);
    inner.appendChild(hint(appsHint(rows, moving, focusIndex)));
    alignGlass(sheet.el);
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
    const offset = scrollOffset(el.offsetTop, el.offsetHeight, sheet.view.offsetHeight, sheet.track.offsetHeight);
    place(sheet.track, 'translateY(' + (-offset) + 'px)', instant);
  }

  function openSheet(open) {
    sheet.el.classList.toggle('is-open', open);
    dimHome(open);
  }

  // ---- Toast -----------------------------------------------------------------

  let toastTimer = null;

  function toast(message) {
    const el = doc.getElementById('toast');
    el.innerHTML = '';
    el.appendChild(h('span', null, message));
    el.classList.add('is-shown');
    root.clearTimeout(toastTimer);
    toastTimer = root.setTimeout(function () {
      el.classList.remove('is-shown');
    }, 3200);
  }

  function init() {
    sheet.el = doc.getElementById('sheet');
  }

  CH.ui = {
    init: init,
    applyLook: applyLook,
    formatClock: formatClock,
    updateClock: updateClock,
    renderHome: renderHome,
    focusHome: focusHome,
    pressHome: pressHome,
    renderSettings: renderSettings,
    renderAppsSheet: renderAppsSheet,
    updateAppsHint: updateAppsHint,
    focusSheet: focusSheet,
    openSheet: openSheet,
    toast: toast,
    scrollOffset: scrollOffset
  };
})(typeof window !== 'undefined' ? window : globalThis);
