// Drives the real app in Chromium against the workbench's fake `tizen`,
// using only the keys a Samsung remote sends.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { start } from '../../workbench/server.mjs';

let server;
let browser;
let page;
let base;
let errors;

before(async () => {
  server = await start(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  server.close();
});

beforeEach(async () => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
});

const DEFAULT_HOME = ['Netflix', 'YouTube', 'Prime Video', 'Disney+', 'Max', 'Plex', 'Tubi', 'Spotify'];
const S = (o = {}) => Object.assign({ v: 1, layout: 'list', theme: 'dusk', font: 'manrope', focus: 'glass', icons: 'on', clock: '12', apps: null }, o);

async function open(query = '', { settings, wait = true } = {}) {
  if (settings) {
    // Seed once per test; later reloads keep whatever the app saved.
    await page.addInitScript((s) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('cleanhub.settings', JSON.stringify(s));
        sessionStorage.setItem('seeded', '1');
      }
    }, settings);
  }
  await page.goto(base + query);
  if (wait) await page.waitForFunction(() => window.CleanHub.main.state.fresh);
}

async function reload() {
  await page.reload();
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
}

// Saves an explicit Home list and restarts the app with it.
async function seedHome(count) {
  const ids = await page.evaluate((n) => window.CleanHub.main.state.all.slice(0, n).map((e) => e.id), count);
  await page.evaluate((list) => {
    const s = JSON.parse(localStorage.getItem('cleanhub.settings') || '{}');
    localStorage.setItem('cleanhub.settings', JSON.stringify(Object.assign({ v: 1 }, s, { apps: list })));
  }, ids);
  await reload();
  return ids;
}

const press = async (key, times = 1) => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
};
const state = () => page.evaluate(() => {
  const s = window.CleanHub.main.state;
  return {
    screen: s.screen,
    homeIndex: s.homeIndex,
    home: s.home.map((e) => e.name),
    settings: s.settings,
    launches: window.__mock.launches.slice()
  };
});
const homeNames = () => page.$$eval('#home [data-app] .list-name', (els) => els.map((e) => e.textContent));
const focusedHome = () => page.evaluate(() => {
  const el = document.querySelector('#home .is-focused');
  if (!el) return null;
  if (el.hasAttribute('data-settings')) return 'Settings';
  const name = el.querySelector('.list-name');
  return name ? name.textContent : el.getAttribute('data-app');
});
const sheetLabels = () => page.$$eval('#sheet .sheet-row .sheet-label', (els) => els.map((e) => e.textContent));
const focusedSheet = () => page.$eval('#sheet .sheet-row.is-focused .sheet-label', (e) => e.textContent);
const sheetHint = () => page.$eval('#sheet .sheet-hint', (e) => e.textContent);
const toastText = () => page.$eval('#toast', (e) => (e.classList.contains('is-shown') ? e.textContent : ''));

// Settings is the fixed button top right: Right from the list, Up from the dock.
async function openSettings(layout = 'list') {
  await press(layout === 'dock' ? 'ArrowUp' : 'ArrowRight');
  await press('Enter');
  assert.equal((await state()).screen, 'settings');
}

async function openAppsSheet(layout) {
  await openSettings(layout);
  await press('Enter');
  assert.equal((await state()).screen, 'apps');
}

// ---- Home ---------------------------------------------------------------------

test('home lists recognised apps in the preferred order, with Settings top right', async () => {
  await open();
  assert.deepEqual(await homeNames(), DEFAULT_HOME);
  assert.equal(await focusedHome(), 'Netflix');
  const gear = await page.$eval('#home .gear', (e) => {
    const r = e.getBoundingClientRect();
    return { text: e.textContent, right: r.right, top: r.top };
  });
  assert.equal(gear.text, 'Settings');
  assert.ok(gear.right <= 1920 - 96 && gear.top >= 60, 'inside the safe area');
  assert.deepEqual(errors, []);
});

test('arrows move focus and clamp; Right reaches Settings and Left or Back returns', async () => {
  await open();
  await press('ArrowUp');
  assert.equal((await state()).homeIndex, 0);
  await press('ArrowDown', 2);
  assert.equal(await focusedHome(), 'Prime Video');
  await press('ArrowDown', 20);
  assert.equal(await focusedHome(), 'Spotify', 'stops on the last app');
  await press('ArrowRight');
  assert.equal(await focusedHome(), 'Settings');
  await press('ArrowLeft');
  assert.equal(await focusedHome(), 'Spotify', 'back to the remembered app');
  await press('ArrowRight');
  await press('Escape');
  assert.equal(await focusedHome(), 'Spotify');
});

test('OK launches the focused app', async () => {
  await open();
  await press('ArrowDown', 2);
  await press('Enter');
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  assert.deepEqual((await state()).launches, ['org.tizen.primevideo']);
});

test('a failed launch tells the viewer', async () => {
  await open('?fail=org.tizen.netflix-app');
  await press('Enter');
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('is-shown'));
  assert.equal(await toastText(), 'Couldn’t open Netflix');
});

test('a launch Tizen never confirms is fine once the other app took the screen', async () => {
  await page.clock.install();
  await open('?launchHang=1');
  await press('Enter');
  await page.evaluate(() => window.__mock.goHidden());
  await page.clock.runFor(9000);
  await page.evaluate(() => window.__mock.returnFromApp());
  await page.clock.runFor(500);
  assert.equal(await toastText(), '');
});

test('a launch that never happens is reported after the deadline', async () => {
  await page.clock.install();
  await open('?launchHang=1');
  await press('Enter');
  await page.clock.runFor(8500);
  assert.equal(await toastText(), 'Couldn’t open Netflix');
});

test('Back on home does nothing', async () => {
  await open();
  await press('ArrowDown');
  await press('Escape');
  const s = await state();
  assert.equal(s.screen, 'home');
  assert.equal(s.homeIndex, 1);
});

test('holding OK launches once, even if the remote does not flag repeats', async () => {
  await open();
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 13, bubbles: true }));
  });
  await page.waitForTimeout(100);
  assert.equal((await state()).launches.length, 1);
  await press('Enter'); // a fresh press after release works
  await page.waitForTimeout(100);
  assert.equal((await state()).launches.length, 2);
});

test('list rows are never cut in half, and cues show what is off screen', async () => {
  await open('?apps=many');
  await seedHome(20);
  assert.equal((await state()).home.length, 20);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(220);
    const cut = await page.evaluate(() => {
      const v = document.querySelector('.list-view').getBoundingClientRect();
      return [...document.querySelectorAll('.list-row')].some((r) => {
        const b = r.getBoundingClientRect();
        const inside = b.top >= v.top - 1 && b.bottom <= v.bottom + 1;
        const outside = b.bottom <= v.top + 1 || b.top >= v.bottom - 1;
        return !inside && !outside;
      });
    });
    assert.equal(cut, false, 'no half row with focus on row ' + i);
    const cues = await page.$$eval('.cue-list', (els) => els.map((c) => c.classList.contains('is-shown')));
    if (i === 0) assert.deepEqual(cues, [false, true]);
    if (i === 19) assert.deepEqual(cues, [true, false]);
    await press('ArrowDown');
  }
});

// ---- Settings ---------------------------------------------------------------------

test('settings change the layout, and the choice survives a restart', async () => {
  await open();
  await openSettings();
  await press('ArrowDown'); // Layout
  await press('ArrowRight');
  assert.equal((await state()).settings.layout, 'dock');
  assert.equal(await page.getAttribute('html', 'data-layout'), 'dock');
  assert.equal(await page.$$eval('#home .dock-item', (els) => els.length), 8);
  await press('Escape');
  assert.equal((await state()).screen, 'home');
  assert.equal(await focusedHome(), 'Settings', 'focus is back on Settings');
  await reload();
  assert.equal(await page.getAttribute('html', 'data-layout'), 'dock');
  assert.equal(await page.$eval('.dock-label', (e) => e.textContent), 'Netflix');
  await press('ArrowRight', 2);
  assert.equal(await page.$eval('.dock-label', (e) => e.textContent), 'Prime Video');
  await press('ArrowUp');
  assert.equal(await focusedHome(), 'Settings');
  await press('ArrowDown');
  assert.equal(await page.$eval('.dock-label', (e) => e.textContent), 'Prime Video');
});

test('the dock is centred, fits 8 apps, and the first focus ring is not clipped', async () => {
  await open('', { settings: S({ layout: 'dock' }) });
  const g = await page.evaluate(() => {
    const dock = document.querySelector('.dock').getBoundingClientRect();
    const view = document.querySelector('.dock-view').getBoundingClientRect();
    const ring = document.querySelector('.dock-item.is-focused .dock-ring').getBoundingClientRect();
    const track = document.querySelector('.dock-track');
    return { left: dock.left, right: dock.right, view: [view.left, view.right], ringLeft: ring.left - 4, scroll: track.scrollWidth, viewW: view.width };
  });
  assert.ok(Math.abs(g.left - (1920 - g.right)) <= 1, 'centred');
  assert.ok(g.ringLeft >= g.view[0], 'ring inside the clip box on the left');
  assert.ok(g.scroll <= g.viewW, 'no scrolling for 8 apps');
});

test('a long dock scrolls with cues, and long names are cut with an ellipsis', async () => {
  await open('?apps=many', { settings: S({ layout: 'dock' }) });
  await seedHome(30);
  const cues = () => page.$$eval('.cue-dock', (els) => els.map((c) => c.classList.contains('is-shown')));
  assert.deepEqual(await cues(), [false, true]);
  await press('ArrowRight', 29);
  assert.deepEqual(await cues(), [true, false]);
  const label = await page.$eval('.dock-label', (e) => ({ right: e.getBoundingClientRect().right }));
  assert.ok(label.right <= 1920 - 96, 'label stays inside the safe area');
});

test('every option cycles both ways and is applied to the page', async () => {
  await open();
  await openSettings();
  const rows = ['layout', 'theme', 'font', 'focus', 'icons', 'clock'];
  for (let i = 0; i < rows.length; i++) {
    await press('ArrowDown');
    const before = (await state()).settings[rows[i]];
    await press('ArrowRight');
    const after = (await state()).settings[rows[i]];
    assert.notEqual(after, before, rows[i] + ' should change');
    assert.equal(await page.getAttribute('html', 'data-' + rows[i]), after);
    await press('ArrowLeft');
    assert.equal((await state()).settings[rows[i]], before, rows[i] + ' should change back');
  }
  assert.deepEqual(errors, []);
});

test('reset needs a second OK, and confirms in the sheet rather than a toast', async () => {
  await open();
  await openSettings();
  await press('ArrowDown', 2); // Background
  await press('ArrowRight');
  assert.equal((await state()).settings.theme, 'tide');
  await press('ArrowDown', 5); // Reset
  await press('Enter');
  assert.equal((await state()).settings.theme, 'tide', 'first OK only asks');
  assert.match(await focusedSheet(), /Press OK again/);
  await press('Enter');
  assert.equal((await state()).settings.theme, 'dusk');
  assert.equal(await sheetHint(), 'Settings reset');
  assert.equal(await toastText(), '');
});

// ---- Apps on Home -----------------------------------------------------------------

test('apps on home: add, move and remove, saved across restarts', async () => {
  await open();
  await openAppsSheet();
  const all = await sheetLabels();
  assert.deepEqual(all.slice(0, 8), DEFAULT_HOME);
  assert.ok(all.includes('Weather Now'), 'unrecognised apps can be added');
  for (const junk of ['Smart Hub', 'Clean Hub', 'Voice', 'ADPlayer', 'e-Manual', 'Apps']) {
    assert.ok(!all.includes(junk), junk + ' should be filtered out');
  }
  assert.equal(all.filter((n) => n === 'YouTube').length, 1, 'twins collapse to one');

  await press('ArrowDown', all.indexOf('Weather Now'));
  await press('Enter'); // add: lands at the end of On Home, focus follows
  assert.equal((await sheetLabels())[8], 'Weather Now');
  assert.equal(await focusedSheet(), 'Weather Now');
  await press('Enter'); // pick up
  assert.equal(await page.$eval('#sheet .pill', (e) => e.classList.contains('is-moving')), true);
  await press('ArrowUp', 8);
  await press('Enter'); // drop
  assert.equal((await sheetLabels())[0], 'Weather Now');
  await press('ArrowDown', 2);
  assert.equal(await focusedSheet(), 'YouTube');
  await press('ArrowLeft'); // remove; focus follows it to Not on Home
  assert.equal(await focusedSheet(), 'YouTube');
  await press('Escape');
  await press('Escape');
  const expected = ['Weather Now', 'Netflix', 'Prime Video', 'Disney+', 'Max', 'Plex', 'Tubi', 'Spotify'];
  assert.deepEqual(await homeNames(), expected);
  assert.equal(await focusedHome(), 'Settings', 'focus stays on Settings even though Home changed');
  await reload();
  assert.deepEqual(await homeNames(), expected);
  assert.deepEqual(errors, []);
});

test('moving updates the sheet in place and numbers stay right', async () => {
  await open();
  await openAppsSheet();
  await press('Enter'); // pick up Netflix
  await press('ArrowDown', 3);
  const orders = await page.$$eval('#sheet .sheet-row.is-on .order', (els) => els.map((e) => e.textContent));
  assert.deepEqual(orders.slice(0, 5), ['1', '2', '3', '', '5']);
  assert.deepEqual((await sheetLabels()).slice(0, 4), ['YouTube', 'Prime Video', 'Disney+', 'Netflix']);
  await press('Enter');
  assert.deepEqual((await state()).home.slice(0, 4), ['YouTube', 'Prime Video', 'Disney+', 'Netflix']);
});

test('Back while moving puts the app back and keeps the automatic selection', async () => {
  await open();
  await openAppsSheet();
  await press('Enter'); // pick up Netflix
  await press('ArrowDown', 3);
  await press('Escape'); // cancel
  assert.equal((await state()).screen, 'apps');
  assert.equal((await sheetLabels())[0], 'Netflix');
  assert.equal((await state()).settings.apps, null, 'still "not chosen yet"');
  await press('Enter');
  await press('Escape'); // pick up and cancel with no move at all
  assert.equal((await state()).settings.apps, null);
});

test('a refresh while an app is lifted keeps the move on that app', async () => {
  await open();
  await openAppsSheet();
  await press('ArrowDown');
  await press('Enter'); // pick up YouTube
  await page.evaluate(() => {
    window.__mock.apps = window.__mock.apps.filter((a) => a.name !== 'Netflix');
    window.__mock.returnFromApp();
  });
  await page.waitForFunction(() => !window.CleanHub.main.state.home.some((e) => e.name === 'Netflix'));
  assert.equal(await focusedSheet(), 'YouTube');
  await press('ArrowDown');
  await press('Escape');
  assert.deepEqual(errors, []);
  assert.equal((await sheetLabels())[0], 'YouTube');
});

test('Home holds up to 40 apps and says so', async () => {
  await open('?apps=many');
  await seedHome(40);
  await openAppsSheet();
  const labels = await sheetLabels();
  await press('ArrowDown', labels.length - 1); // the switch
  await press('Enter'); // show everything
  const after = await sheetLabels();
  await press('ArrowUp', after.length - 1 - after.indexOf('Apps'));
  assert.equal(await focusedSheet(), 'Apps');
  await press('Enter');
  assert.equal((await state()).settings.apps.length, 40);
  assert.equal(await focusedSheet(), 'Apps', 'focus stays put');
  assert.match(await sheetHint(), /up to 40 apps/);
});

test('the apps sheet can show everything the TV lists, to rescue a filtered app', async () => {
  await open();
  await openAppsSheet();
  const before = await sheetLabels();
  assert.equal(before[before.length - 1], 'Show everything the TV lists');
  await press('ArrowDown', before.length - 1);
  await press('Enter');
  const after = await sheetLabels();
  assert.ok(after.includes('e-Manual') && after.includes('Apps'), 'plumbing is listed on request');
  assert.ok(!after.includes('Clean Hub'), 'never lists itself');
  assert.equal(after[after.length - 1], 'Show only recognised apps');
  assert.equal(await focusedSheet(), 'Show only recognised apps', 'focus stays on the switch');
  await press('ArrowUp', after.length - 1 - after.indexOf('Apps'));
  await press('Enter');
  await press('Escape');
  await press('Escape');
  assert.ok((await homeNames()).includes('Apps'));
});

test('a long sheet scrolls by whole rows with cues', async () => {
  await open('?apps=many');
  await openAppsSheet();
  const cues = () => page.$$eval('#sheet .cue-sheet', (els) => els.map((e) => e.classList.contains('is-shown')));
  assert.deepEqual(await cues(), [false, true]);
  await press('ArrowDown', 30);
  await page.waitForTimeout(250);
  const g = await page.evaluate(() => {
    const v = document.querySelector('#sheet .sheet-view').getBoundingClientRect();
    const f = document.querySelector('#sheet .sheet-row.is-focused').getBoundingClientRect();
    const sliver = [...document.querySelectorAll('#sheet .sheet-track > :not(.pill)')].some((el) => {
      const b = el.getBoundingClientRect();
      return b.top < v.top - 1 && b.bottom > v.top + 1;
    });
    return { visible: f.top >= v.top - 1 && f.bottom <= v.bottom + 1, sliver };
  });
  assert.ok(g.visible, 'focused row on screen');
  assert.equal(g.sliver, false, 'nothing half-cut under the title');
  assert.deepEqual(await cues(), [true, true]);
});

// ---- Data -------------------------------------------------------------------------

test('if the list arrives while Settings is open, Home matches it afterwards', async () => {
  await open('?hold=1', { wait: false });
  await page.waitForFunction(() => window.CleanHub && window.CleanHub.main);
  assert.match(await page.$eval('.list-empty', (e) => e.textContent), /Loading/);
  await press('Enter'); // the only thing focused is Settings
  assert.equal((await state()).screen, 'settings');
  await page.evaluate(() => window.__mock.release());
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
  assert.match(await page.$eval('#sheet .sheet-row .sheet-value', (e) => e.textContent), /8 apps/);
  await press('Escape');
  assert.deepEqual(await homeNames(), DEFAULT_HOME, 'Home redrawn under the sheet');
  assert.equal(await focusedHome(), 'Settings');
  await press('Enter');
  assert.equal((await state()).screen, 'settings', 'OK on Settings opens Settings');
  assert.deepEqual((await state()).launches, []);
});

test('apps uninstalled while away disappear; installed ones show up', async () => {
  await open();
  await page.evaluate(() => {
    window.__mock.apps = window.__mock.apps.filter((a) => a.name !== 'YouTube')
      .concat([{ id: 'zzzzzzzzz1.Crunchyroll', name: 'Crunchyroll' }]);
    window.__mock.returnFromApp();
  });
  await page.waitForFunction(() => window.CleanHub.main.state.home.length === 7);
  assert.ok(!(await homeNames()).includes('YouTube'));
  await openAppsSheet();
  assert.ok((await sheetLabels()).includes('Crunchyroll'));
});

test('a saved app follows its new id (HBO Max to Max)', async () => {
  await open('', { settings: S({ apps: ['cj37Ni3qXM.HBONow', 'org.tizen.netflix-app'] }) });
  assert.deepEqual(await homeNames(), ['Max', 'Netflix']);
  assert.deepEqual((await state()).settings.apps, ['5b8c3eb16b.BeamCTVDev', 'org.tizen.netflix-app']);
});

test('an app list that arrives after the deadline is still used', async () => {
  await page.clock.install();
  await open('?delay=9000', { wait: false });
  await page.waitForFunction(() => window.CleanHub && window.CleanHub.main);
  await page.clock.runFor(8100);
  assert.match(await page.$eval('.list-empty', (e) => e.textContent), /Couldn’t read/);
  await page.clock.runFor(1000);
  assert.deepEqual(await homeNames(), DEFAULT_HOME);
});

test('when the app list cannot be read, Home and the apps sheet say so', async () => {
  await open('?listFail=1');
  assert.match(await page.$eval('.list-empty', (e) => e.textContent), /Couldn’t read/);
  assert.equal(await focusedHome(), 'Settings');
  await press('Enter');
  await press('Enter');
  assert.match(await page.$eval('#sheet .sheet-empty', (e) => e.textContent), /Couldn’t read this TV’s app list/);
});

test('with no apps installed, home points to Settings', async () => {
  await open('?apps=none');
  assert.match(await page.$eval('.list-empty', (e) => e.textContent), /Pick some in Settings/);
  await press('Enter');
  assert.equal((await state()).screen, 'settings');
});

test('a cached list draws Home at once, and a hung TV call still lets Settings open', async () => {
  await open();
  await page.goto(base + '?hang=1');
  await page.waitForFunction(() => window.CleanHub.main.state.loaded);
  assert.equal((await homeNames())[0], 'Netflix', 'drawn from the cache');
  assert.equal(await page.evaluate(() => window.CleanHub.main.state.fresh), false);
  await openSettings();
});

test('only unrecognised apps: the first ones are shown', async () => {
  await open('?apps=unknown');
  assert.deepEqual(await homeNames(), ['Alpha Radio', 'Beta News']);
});

test('clock follows the 12/24-hour and off settings', async () => {
  await open();
  const fmt = await page.evaluate(() => {
    const d = new Date(2026, 9, 20, 21, 5);
    return [window.CleanHub.ui.formatClock(d, '12'), window.CleanHub.ui.formatClock(d, '24'),
      window.CleanHub.ui.formatClock(new Date(2026, 9, 20, 0, 7), '12')];
  });
  assert.deepEqual(fmt[0], { time: '9:05', ampm: 'PM', date: 'Tuesday, October 20' });
  assert.deepEqual(fmt[1], { time: '21:05', ampm: '', date: 'Tuesday, October 20' });
  assert.equal(fmt[2].time, '12:07');
  assert.equal(fmt[2].ampm, 'AM');
});
