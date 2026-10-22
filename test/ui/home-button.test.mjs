// The Home button, driven like launcher.test.mjs: the real app in Chromium,
// the workbench's fake `tizen`, and only the keys a Samsung remote sends.
// The page's half: what it tells the Home watcher (service/home.js), the two
// Settings rows, and what it shows when the watcher brings it back.
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
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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

const S = (o = {}) => Object.assign({ v: 1, layout: 'list', ambient: 'off', music: 'all', apps: null }, o);

async function open(query = '', settings = S()) {
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('cleanhub.settings', JSON.stringify(s));
      sessionStorage.setItem('seeded', '1');
    }
  }, settings);
  await page.goto(base + query);
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
}

const press = async (key, times = 1) => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
};
const told = () => page.evaluate(() => window.__mock.home.map((c) => c.do + (c.to ? ' ' + c.to : '') + (c.id ? ' ' + c.id : '')));
const mock = (name) => page.evaluate((n) => window.__mock[n], name);
const app = () => page.evaluate(() => ({ screen: window.CleanHub.main.state.screen, settings: window.CleanHub.main.state.settings }));
const labels = () => page.$$eval('#sheet .sheet-row .sheet-label', (els) => els.map((e) => e.textContent));
const focusedRow = () => page.$eval('#sheet .sheet-row.is-focused', (e) => ({
  label: e.querySelector('.sheet-label').textContent,
  value: (e.querySelector('.sheet-value-text') || e.querySelector('.sheet-value') || { textContent: '' }).textContent
}));

async function settingsRow(label) {
  await press('ArrowRight');
  await press('Enter');
  assert.equal((await app()).screen, 'settings');
  await press('ArrowDown', (await labels()).indexOf(label));
  assert.equal((await focusedRow()).label, label);
}

test('Home goes to Clean Hub by default: the watcher starts with the page', async () => {
  await open();
  assert.equal((await app()).settings.home, 'cleanhub');
  assert.deepEqual(await told(), ['shown']);
  assert.deepEqual(errors, []);
});

test('a watcher that isn\'t running is started with the command', async () => {
  await open('?homeDown=1');
  assert.deepEqual(await told(), ['shown']);
  assert.deepEqual(await mock('appControls'), [], 'nothing reaches the Fire TV service');
});

test('opening an app tells the watcher first, so that hide isn\'t Home', async () => {
  await open();
  await press('Enter'); // Netflix
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  await page.evaluate(() => window.__mock.goHidden());
  assert.deepEqual(await told(), ['shown', 'leaving app org.tizen.netflix-app']);
  const leave = (await mock('home'))[1];
  assert.equal(leave.name, 'Netflix', 'with its name, which the REST API knows it by');
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.deepEqual((await told()).slice(2), ['shown']);
});

test('a hide nobody announced is reported at once; back moments later, that was the watcher answering Home', async () => {
  await open('', S({ ambient: 'on' }));
  await press('Enter'); // Ambient
  await page.evaluate(() => window.__mock.goHidden());
  assert.deepEqual(await told(), ['shown', 'hidden']);
  await later(800); // as long as the watcher takes
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.equal((await app()).screen, 'home', 'Home at once, without waiting to be told');
  assert.equal((await mock('home')).at(-1).ask, false, 'so nothing to ask');
});

test('back long after a hide nobody announced (the TV waking up), Clean Hub asks, and stays as it was unless told', async () => {
  await open('', S({ ambient: 'on' }));
  await press('Enter'); // Ambient
  await page.evaluate(() => window.__mock.goHidden());
  await later(60000);
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.equal((await mock('home')).at(-1).ask, true);
  assert.equal((await app()).screen, 'ambient');
  await page.evaluate(() => window.__mock.homeSays('back', {})); // it was the watcher after all
  assert.equal((await app()).screen, 'home');
});

test('a "back" nobody asked for is ignored', async () => {
  await open('', S({ ambient: 'on' }));
  await page.evaluate(() => window.__mock.homeSays('back', {})); // the answer to starting up
  await press('Enter'); // Ambient
  await page.evaluate(() => window.__mock.homeSays('back', {}));
  assert.equal((await app()).screen, 'ambient');
});

test('back from an app it opened, Clean Hub doesn\'t ask', async () => {
  await open();
  await press('Enter');
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  await page.evaluate(() => window.__mock.goHidden());
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.equal((await mock('home')).at(-1).ask, false);
});

test('an app that won\'t open leaves Clean Hub on screen, and the watcher is told', async () => {
  await open('?fail=org.tizen.netflix-app');
  await press('Enter');
  await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('Couldn’t open') !== -1);
  assert.deepEqual(await told(), ['shown', 'leaving app org.tizen.netflix-app', 'shown']);
  await page.evaluate(() => window.__mock.goHidden());
  assert.equal((await told()).at(-1), 'hidden', 'so a later Home still counts');
});

test('switching to the Fire TV input is a leave the watcher can\'t follow', async () => {
  await open('', S({ input: 'hdmi4' }));
  await press('Enter'); // Fire TV
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  await page.evaluate(() => window.__mock.goHidden());
  assert.deepEqual(await told(), ['shown', 'leaving input']);
});

test('Settings has Home button and Open Samsung Home, above Reset; Brainrot mode stays last', async () => {
  await open();
  await press('ArrowRight');
  await press('Enter');
  const rows = await labels();
  assert.deepEqual(rows.slice(rows.indexOf('Fire TV on Home')),
    ['Fire TV on Home', 'Fire TV picture', 'Home button', 'Open Samsung Home', 'Reset to defaults', 'Brainrot mode']);
});

test('Home button: Samsung Home stops the watcher; Clean Hub starts it again', async () => {
  await open();
  await settingsRow('Home button');
  assert.equal((await focusedRow()).value, 'Clean Hub');
  await press('ArrowRight');
  assert.equal((await focusedRow()).value, 'Samsung Home');
  assert.equal((await app()).settings.home, 'samsung');
  assert.deepEqual((await told()).at(-1), 'watch');
  assert.equal((await mock('home')).at(-1).on, false);
  // Nothing more is said while it's off.
  await press('Escape');
  await page.evaluate(() => window.__mock.goHidden());
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.equal((await told()).at(-1), 'watch');
  await page.reload();
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
  assert.equal((await app()).settings.home, 'samsung', 'saved');
  await settingsRow('Home button');
  await press('ArrowLeft');
  assert.equal((await told()).at(-1), 'shown');
});

test('with Samsung Home chosen, the watcher is still told, to remember it for when the TV boots', async () => {
  await open('?homeDown=1', S({ home: 'samsung' }));
  assert.deepEqual(await told(), ['watch']);
  assert.equal((await mock('home'))[0].on, false);
});

test('closing Clean Hub says so, so the hide just before isn\'t taken for Home', async () => {
  await open();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.deepEqual(await told(), ['shown', 'closing']);
});

test('Open Samsung Home closes Settings and steps aside, telling the watcher', async () => {
  await open();
  await settingsRow('Open Samsung Home');
  await press('ArrowRight');
  assert.equal(await mock('hidden'), 0, 'only OK opens it');
  await press('Enter');
  assert.equal(await mock('hidden'), 1);
  assert.equal((await app()).screen, 'home');
  await page.evaluate(() => window.__mock.goHidden());
  assert.deepEqual((await told()).slice(-1), ['leaving samsung']);
});

test('brought back by Home, Clean Hub shows Home: Settings closes', async () => {
  await open();
  await press('ArrowRight');
  await press('Enter');
  await page.evaluate(() => window.__mock.goHidden());
  await page.evaluate(() => window.__mock.homeBack());
  assert.equal((await app()).screen, 'home');
  assert.equal(await page.$eval('#sheet', (e) => e.classList.contains('is-open')), false);
  assert.deepEqual(errors, []);
});

test('brought back by Home, Clean Hub shows Home: Ambient closes', async () => {
  await open('', S({ ambient: 'on' }));
  await press('Enter'); // Ambient
  assert.equal((await app()).screen, 'ambient');
  await page.evaluate(() => window.__mock.goHidden());
  await page.evaluate(() => window.__mock.homeBack());
  assert.equal((await app()).screen, 'home');
});

test('brought back by Home in the middle of a move, the move is undone', async () => {
  await open();
  await press('ArrowRight');
  await press('Enter'); // Settings
  await press('Enter'); // Apps on Home
  assert.equal((await app()).screen, 'apps');
  const before = await page.evaluate(() => window.CleanHub.main.state.home.map((e) => e.id));
  await press('Enter'); // move the first app
  await press('ArrowDown');
  await page.evaluate(() => window.__mock.goHidden());
  await page.evaluate(() => window.__mock.homeBack());
  assert.equal((await app()).screen, 'home');
  assert.deepEqual(await page.evaluate(() => window.CleanHub.main.state.home.map((e) => e.id)), before);
  assert.equal(await page.evaluate(() => window.CleanHub.main.state.moving), -1);
});

test('coming back from an app it opened keeps the screen as it was', async () => {
  await open();
  await press('ArrowDown'); // the second app
  const index = await page.evaluate(() => window.CleanHub.main.state.homeIndex);
  await press('Enter');
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  await page.evaluate(() => window.__mock.goHidden());
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.equal((await app()).screen, 'home');
  assert.equal(await page.evaluate(() => window.CleanHub.main.state.homeIndex), index, 'focus where it was');
  assert.equal((await mock('home')).at(-1).ask, false, 'nothing to ask: it said it was leaving');
});

test('the watcher\'s report is kept for tv-inspect.mjs', async () => {
  await open();
  await page.evaluate(() => window.__mock.ports.home([{ key: 'report', value: JSON.stringify({ enabled: true, log: [] }) }]));
  assert.deepEqual(await page.evaluate(() => window.CleanHub.main.homeReport()), { enabled: true, log: [] });
});

// ---- Fire TV picture in Clean Hub ------------------------------------------------

const html = (attr) => page.getAttribute('html', attr);
// Keys the page only gets once registered (play/pause), by keyCode.
const keyCode = (code) => page.evaluate((c) => {
  const e = new KeyboardEvent('keydown', { bubbles: true });
  Object.defineProperty(e, 'keyCode', { get: () => c });
  document.dispatchEvent(e);
}, code);
// Moves the page's clock on, for the "moments after" window.
const later = (ms) => page.evaluate((m) => {
  const real = Date.now;
  Date.now = () => real() + m;
}, ms);

async function openFireTv(query = '', settings = S({ input: 'hdmi4', firetvView: 'hub' })) {
  await open(query, settings);
  await press('Enter'); // Fire TV is first with Ambient off
  await page.waitForFunction(() => (window.CleanHub.main.state.screen === 'source' && window.__mock.tvWindow) ||
    window.__mock.launches.length > 0 || document.getElementById('toast').textContent.indexOf('Couldn’t') !== -1);
}

test('Fire TV picture: In Clean Hub shows the input inside Clean Hub, and passes the remote\'s keys to the stick', async () => {
  await openFireTv();
  assert.equal((await app()).screen, 'source');
  assert.deepEqual(await mock('sources'), ['HDMI 4']);
  assert.deepEqual(await mock('tvWindow'), { rect: ['0px', '0px', '1920px', '1080px'], type: 'MAIN', z: 'BEHIND' });
  assert.deepEqual(await mock('launches'), [], 'no TV viewer: Clean Hub stays the app on screen');
  assert.equal(await html('data-source'), 'on');
  assert.ok((await told()).every((c) => !c.startsWith('leaving')), 'not a leave: the watcher keeps watching Clean Hub');
  assert.deepEqual(Object.keys(await mock('keys')).sort(), ['MediaPause', 'MediaPlay', 'MediaPlayPause']);
  await press('ArrowUp');
  await press('ArrowRight');
  await press('Enter');
  await press('Escape');
  await keyCode(10252);
  assert.deepEqual(await mock('fireKeys'), ['wake', 'home', 'up', 'right', 'ok', 'back', 'play'],
    'woken first, and to its own Home screen (the Fire TV tile)');
  assert.ok((await told()).includes('picture'), 'the watcher expects the stick to take the TV');
  assert.equal(await page.$eval('#home', (e) => getComputedStyle(e).visibility), 'hidden');
  assert.deepEqual(errors, []);
});

test('the stick claiming the TV moments after keeps the picture; Home later goes back to Clean Hub\'s Home', async () => {
  await openFireTv();
  await page.evaluate(() => window.__mock.goHidden()); // the TV viewer, over HDMI-CEC
  await later(800); // the watcher brings Clean Hub back
  await page.evaluate(() => window.__mock.homeBack());
  assert.equal((await app()).screen, 'source');
  assert.equal(await html('data-source'), 'on');
  assert.ok(await mock('tvWindow'));
  await later(10000);
  await page.evaluate(() => window.__mock.goHidden()); // Home
  await later(800);
  await page.evaluate(() => window.__mock.homeBack());
  assert.equal((await app()).screen, 'home');
  assert.equal(await mock('tvWindow'), null);
  assert.equal(await html('data-source'), 'off');
  assert.deepEqual(await mock('keys'), {});
  const sent = (await mock('fireKeys')).length;
  await press('ArrowDown');
  assert.equal((await mock('fireKeys')).length, sent, 'keys are Clean Hub\'s again');
});

test('back in front a while later for reasons unknown, the Fire TV picture gives way to Home', async () => {
  await openFireTv();
  await page.evaluate(() => window.__mock.goHidden());
  await later(20000); // say, reopened from the Smart Hub
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.equal((await app()).screen, 'home');
  assert.equal(await mock('tvWindow'), null);
});

test('the stick woken again later (its remote server slept) may claim the TV again: still the picture', async () => {
  await openFireTv();
  await later(10000);
  await page.evaluate(() => window.__mock.fireTvAnswer({ kind: 'key', state: 'woke' }));
  await page.evaluate(() => window.__mock.goHidden());
  await later(800);
  await page.evaluate(() => window.__mock.homeBack());
  assert.equal((await app()).screen, 'source');
});

test('a stick that can\'t be reached is said once Clean Hub is back on screen', async () => {
  await openFireTv();
  await page.evaluate(() => window.__mock.fireTvAnswer({ kind: 'key', state: 'unreachable' }));
  assert.match(await page.$eval('#toast', (e) => e.textContent), /Couldn’t reach the Fire TV/);
});

test('with Home button on Samsung Home, Fire TV keeps using the TV viewer', async () => {
  await openFireTv('', S({ input: 'hdmi4', firetvView: 'hub', home: 'samsung' }));
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  assert.deepEqual(await mock('launches'), ['org.tizen.tv-viewer']);
  assert.equal((await app()).screen, 'home');
});

test('a TV that won\'t show its picture in Clean Hub says so and stays on Home', async () => {
  await openFireTv('?windowFail=1');
  await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('in Clean Hub') !== -1);
  assert.equal((await app()).screen, 'home');
  assert.equal(await html('data-source'), 'off');
  assert.deepEqual(await mock('keys'), {});
});

test('an input picked with the TV\'s Source button while Clean Hub was away is shown, not covered', async () => {
  await open('', S({ input: 'hdmi4' }));
  await page.evaluate(() => window.__mock.goHidden()); // the Source panel's pick hides Clean Hub
  await page.evaluate(() => { window.__mock.source = { type: 'HDMI', number: 2 }; });
  await page.evaluate(() => window.__mock.homeBack());
  await page.waitForFunction(() => window.__mock.launches.length === 1);
  assert.deepEqual(await mock('launches'), ['org.tizen.tv-viewer']);
  assert.equal((await told()).at(-1), 'leaving input');
});

test('back sooner than the watcher could manage, it wasn\'t the watcher: Clean Hub asks', async () => {
  await open('', S({ ambient: 'on' }));
  await press('Enter'); // Ambient
  await page.evaluate(() => window.__mock.goHidden());
  await page.evaluate(() => window.__mock.returnFromApp());
  assert.equal((await app()).screen, 'ambient');
  assert.equal((await mock('home')).at(-1).ask, true);
});

test('a Fire TV app\'s tile opens that app on the stick, not the stick\'s Home screen', async () => {
  await openFireTv('?fireApps=1');
  await page.evaluate(() => window.__mock.goHidden());
  await later(800);
  await page.evaluate(() => window.__mock.homeBack()); // the takeover
  await later(10000);
  await page.evaluate(() => window.__mock.goHidden()); // Home
  await later(800);
  await page.evaluate(() => window.__mock.homeBack());
  await press('ArrowDown'); // StbEmu, after Fire TV
  await press('Enter');
  await page.waitForFunction(() => window.CleanHub.main.state.screen === 'source' && window.__mock.tvWindow);
  const keys = await mock('fireKeys');
  assert.deepEqual(keys.slice(-1), ['wake'], 'no Home for the stick this time');
  assert.equal((await mock('appControls')).at(-1).data.package[0], 'com.mvas.stb.emu.pro');
});

const STBEMU = 'com.mvas.stb.emu.pro';

async function openStbEmu() {
  await open('?fireApps=1', S({ input: 'hdmi4', firetvView: 'hub' }));
  await press('ArrowDown'); // StbEmu, after Fire TV
  await press('Enter');
  await page.waitForFunction(() => window.CleanHub.main.state.screen === 'source' && window.__mock.tvWindow &&
    window.__mock.fireTvSaw.length >= 2);
}

// Presses a key in the Fire TV picture; resolves what the service got for it.
async function keyToStick(key = 'ArrowUp') {
  const n = (await mock('fireTvSaw')).length;
  await press(key);
  await page.waitForFunction((m) => window.__mock.fireTvSaw.length > m, n);
  return (await mock('fireTvSaw')).at(-1);
}

test('a Fire TV app opens though the wake sent right behind it takes its place at the service', async () => {
  await openStbEmu();
  const saw = await mock('fireTvSaw');
  assert.ok(saw.every((d) => d.key), 'the TV handed the service the wake, twice, and never the app control before it');
  assert.ok(saw.some((d) => d.package && d.package[0] === STBEMU), 'the request to open StbEmu came with the wake');
  assert.deepEqual(errors, []);
});

test('the request to open a Fire TV app goes with each key until the service answers it', async () => {
  await openStbEmu();
  const request = (await mock('appControls')).at(-1).data.request[0];
  assert.equal((await keyToStick()).request[0], request, 'unanswered: it goes with the key');
  await page.evaluate((r) => window.__mock.fireTvAnswer({ package: 'com.mvas.stb.emu.pro', request: r, state: 'opened' }),
    request);
  const after = await keyToStick();
  assert.equal(after.package, undefined, 'answered: the key goes alone');
  assert.equal(JSON.parse(after.key[0]).name, 'up');
});

test('an unanswered request to open a Fire TV app stops going with the keys once the service would have given up', async () => {
  await openStbEmu();
  await later(36000);
  assert.equal((await keyToStick()).package, undefined);
});

test('through the stick\'s takeover the Fire TV picture stays see-through and isn\'t asked for again; later, away means opaque', async () => {
  await openFireTv();
  assert.equal(await html('data-source'), 'on');
  await page.evaluate(() => window.__mock.goHidden()); // the stick's takeover
  assert.equal(await html('data-source'), 'on', 'the picture carries on through Clean Hub\'s return');
  await later(800);
  await page.evaluate(() => window.__mock.homeBack());
  assert.equal(await html('data-source'), 'on');
  assert.equal((await app()).screen, 'source');
  const evs = await page.evaluate(() => window.CleanHub.main.trace().map((e) => e.ev));
  assert.equal(evs.filter((e) => e === 'picture-shown').length, 1, 'a new show is a new reason for the stick to claim the TV');
  await later(10000);
  await page.evaluate(() => window.__mock.goHidden()); // Home
  assert.equal(await html('data-source'), 'off', 'Clean Hub\'s Home shows on return, not a black frame');
});
