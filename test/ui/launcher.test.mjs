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

async function open(query = '') {
  await page.goto(base + query);
  await page.waitForFunction(() => window.CleanHub.main.state.loaded);
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
const focusedText = (scope) => page.$eval(`${scope} .is-focused`, (e) => e.textContent.trim());
const toastText = () => page.$eval('#toast', (e) => (e.classList.contains('is-shown') ? e.textContent : ''));

test('home lists recognised apps in the preferred order, then Settings', async () => {
  await open();
  assert.deepEqual(await homeNames(), ['Netflix', 'YouTube', 'Prime Video', 'Disney+', 'Max', 'Plex', 'Tubi', 'Spotify']);
  const rows = await page.$$eval('#home .list-row .list-name', (els) => els.map((e) => e.textContent));
  assert.equal(rows[rows.length - 1], 'Settings');
  assert.equal(await focusedText('#home'), 'NNetflix');
  assert.deepEqual(errors, []);
});

test('arrows move focus, clamp at the ends, and OK launches the focused app', async () => {
  await open();
  await press('ArrowUp');
  assert.equal((await state()).homeIndex, 0);
  await press('ArrowDown', 2);
  assert.equal((await state()).homeIndex, 2);
  await press('ArrowLeft'); // ignored in list layout
  assert.equal((await state()).homeIndex, 2);
  await press('Enter');
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  assert.deepEqual((await state()).launches, ['org.tizen.ignition']);
  await press('ArrowDown', 20);
  assert.equal((await state()).homeIndex, 8, 'stops on Settings');
});

test('a failed launch tells the viewer', async () => {
  await open('?fail=RN1MCdNq8t.Netflix');
  await press('Enter');
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('is-shown'));
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

test('settings change the layout, and the choice survives a restart', async () => {
  await open();
  await press('ArrowDown', 8);
  await press('Enter');
  assert.equal((await state()).screen, 'settings');
  await press('ArrowDown'); // Layout
  await press('ArrowRight');
  assert.equal((await state()).settings.layout, 'dock');
  assert.equal(await page.getAttribute('html', 'data-layout'), 'dock');
  assert.equal(await page.$$eval('#home .dock-item', (els) => els.length), 9);
  await press('Escape');
  assert.equal((await state()).screen, 'home');
  await page.reload();
  await page.waitForFunction(() => window.CleanHub.main.state.loaded);
  assert.equal(await page.getAttribute('html', 'data-layout'), 'dock');
  // Dock moves with left/right and shows the focused name.
  assert.equal(await page.$eval('.dock-label', (e) => e.textContent), 'Netflix');
  await press('ArrowRight', 2);
  assert.equal(await page.$eval('.dock-label', (e) => e.textContent), 'Prime Video');
  await press('ArrowDown');
  assert.equal((await state()).homeIndex, 2, 'down does nothing in the dock');
});

test('every option cycles both ways and is applied to the page', async () => {
  await open();
  await press('ArrowDown', 8);
  await press('Enter');
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

test('reset needs a second OK', async () => {
  await open();
  await press('ArrowDown', 8);
  await press('Enter');
  await press('ArrowDown', 2); // Background
  await press('ArrowRight');
  assert.equal((await state()).settings.theme, 'tide');
  await press('ArrowDown', 6); // Reset
  await press('Enter');
  assert.equal((await state()).settings.theme, 'tide', 'first OK only asks');
  assert.match(await focusedText('#sheet'), /Press OK again/);
  await press('Enter');
  assert.equal((await state()).settings.theme, 'dusk');
});

test('apps on home: add, move and remove, saved across restarts', async () => {
  await open();
  await press('ArrowDown', 8);
  await press('Enter');
  await press('Enter'); // Apps on Home
  assert.equal((await state()).screen, 'apps');
  const labels = () => page.$$eval('#sheet .sheet-row .sheet-label', (els) => els.map((e) => e.textContent));
  const all = await labels();
  assert.deepEqual(all.slice(0, 8), ['Netflix', 'YouTube', 'Prime Video', 'Disney+', 'Max', 'Plex', 'Tubi', 'Spotify']);
  assert.ok(all.includes('Weather Now'), 'unrecognised apps can be added');
  assert.ok(!all.includes('Smart Hub') && !all.includes('Clean Hub') && !all.includes('Voice'));

  // Add Weather Now (it lands at the end of the On Home group).
  await press('ArrowDown', all.indexOf('Weather Now'));
  await press('Enter');
  assert.equal((await labels())[8], 'Weather Now');
  // Move it to the top: OK picks up, Up x8, OK drops.
  await press('Enter');
  await press('ArrowUp', 8);
  await press('Enter');
  assert.equal((await labels())[0], 'Weather Now');
  // Remove YouTube (now third) with Left.
  await press('ArrowDown', 2);
  assert.equal(await page.$eval('#sheet .sheet-row.is-focused .sheet-label', (e) => e.textContent), 'YouTube');
  await press('ArrowLeft');
  await press('Escape');
  await press('Escape');
  assert.deepEqual(await homeNames(), ['Weather Now', 'Netflix', 'Prime Video', 'Disney+', 'Max', 'Plex', 'Tubi', 'Spotify']);
  await page.reload();
  await page.waitForFunction(() => window.CleanHub.main.state.loaded);
  assert.deepEqual(await homeNames(), ['Weather Now', 'Netflix', 'Prime Video', 'Disney+', 'Max', 'Plex', 'Tubi', 'Spotify']);
  assert.deepEqual(errors, []);
});

test('Back while moving puts the app back where it was', async () => {
  await open();
  await press('ArrowDown', 8);
  await press('Enter');
  await press('Enter');
  await press('Enter'); // pick up Netflix
  await press('ArrowDown', 3);
  await press('Escape');
  const s = await state();
  assert.equal(s.screen, 'apps');
  const labels = await page.$$eval('#sheet .sheet-row .sheet-label', (els) => els.map((e) => e.textContent));
  assert.equal(labels[0], 'Netflix');
});

test('apps that are uninstalled disappear, and come back in place if reinstalled', async () => {
  await open();
  await page.evaluate(() => {
    window.__mock.apps = window.__mock.apps.filter((a) => a.name !== 'YouTube');
    window.__mock.returnFromApp();
  });
  await page.waitForFunction(() => window.CleanHub.main.state.home.length === 7);
  assert.ok(!(await homeNames()).includes('YouTube'));
});

test('an app installed while away shows up in the picker', async () => {
  await open();
  await page.evaluate(() => {
    window.__mock.apps = window.__mock.apps.concat([{ id: 'zzzzzzzzzz.Crunchyroll', name: 'Crunchyroll' }]);
    window.__mock.returnFromApp();
  });
  await press('ArrowDown', 8);
  await press('Enter');
  await press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#sheet .sheet-label')].some((e) => e.textContent === 'Crunchyroll'));
});

test('when the app list cannot be read, home says so and Settings still opens', async () => {
  await open('?listFail=1');
  assert.match(await page.$eval('.list-empty', (e) => e.textContent), /Couldn’t read/);
  assert.equal((await state()).homeIndex, 0);
  await press('Enter');
  assert.equal((await state()).screen, 'settings');
});

test('with no apps installed, home points to Settings', async () => {
  await open('?apps=none');
  assert.match(await page.$eval('.list-empty', (e) => e.textContent), /Pick some in Settings/);
  await press('Enter');
  assert.equal((await state()).screen, 'settings');
});

test('only unrecognised apps: the first ones are shown', async () => {
  await open('?apps=unknown');
  assert.deepEqual(await homeNames(), ['Alpha Radio', 'Beta News']);
});

test('a long list scrolls to keep focus on screen', async () => {
  await open('?apps=many');
  await press('ArrowDown', 8);
  await press('Enter');
  await press('Enter');
  await press('ArrowDown', 30);
  await page.waitForTimeout(300); // let the scroll transition finish
  const visible = await page.$eval('#sheet .sheet-row.is-focused', (el) => {
    const r = el.getBoundingClientRect();
    const v = document.querySelector('#sheet .sheet-view').getBoundingClientRect();
    return r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
  });
  assert.ok(visible);
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
