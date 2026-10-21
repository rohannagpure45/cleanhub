// Brainrot mode, driven like launcher.test.mjs: the real app in Chromium,
// the workbench's fake `tizen`, and only the keys a Samsung remote sends.
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

const S = (o = {}) => Object.assign({ v: 1, layout: 'list', ambient: 'on', music: 'all', brainrot: 'on', apps: null }, o);

async function open(settings) {
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('cleanhub.settings', JSON.stringify(s));
      sessionStorage.setItem('seeded', '1');
    }
  }, settings);
  await page.goto(base);
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
}

const press = async (key, times = 1) => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
};
const app = () => page.evaluate(() => ({
  screen: window.CleanHub.main.state.screen,
  settings: window.CleanHub.main.state.settings,
  reel: window.CleanHub.reel.state(),
  player: (({ track, index, count, playing, wanted }) => ({ set: track && track.set, title: track && track.title, index, count, playing, wanted }))(window.CleanHub.player.state())
}));
const shown = (sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== 'none' && e.offsetWidth > 0);
const hint = () => page.$eval('#ambient .ambient-hint', (e) => e.textContent);

async function openFeed(settings = S()) {
  await open(settings);
  await press('Enter'); // Ambient is first on Home
  assert.equal((await app()).screen, 'ambient');
}

test('Brainrot mode is the last row of Settings, off until it is turned on, and saved', async () => {
  await open(S({ brainrot: 'off' }));
  await press('ArrowRight');
  await press('Enter');
  const labels = await page.$$eval('#sheet .sheet-row .sheet-label', (els) => els.map((e) => e.textContent));
  assert.equal(labels[labels.length - 1], 'Brainrot mode');
  await press('ArrowDown', labels.length - 1);
  assert.equal(await page.$eval('#sheet .sheet-row.is-focused .sheet-label', (e) => e.textContent), 'Brainrot mode');
  assert.equal(await page.$eval('#sheet .sheet-row.is-focused .sheet-value-text', (e) => e.textContent), 'Off');
  await press('ArrowRight');
  assert.equal((await app()).settings.brainrot, 'on');
  assert.equal(await page.getAttribute('html', 'data-brainrot'), 'on');
  assert.equal((await app()).player.set, 'brainrot', 'its soundtrack is queued');
  await page.reload();
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
  assert.equal((await app()).settings.brainrot, 'on');
  assert.deepEqual(errors, []);
});

test('with Brainrot mode on, Ambient is a TikTok-style feed with its own soundtrack', async () => {
  await openFeed();
  await page.waitForFunction(() => window.CleanHub.player.state().playing, null, { timeout: 5000 });
  const a = await app();
  assert.equal(a.player.set, 'brainrot');
  assert.equal(a.player.count, 3);
  assert.equal(a.reel.running, true);
  assert.equal(a.reel.kind, 'story', 'the feed opens on a split-screen story');
  assert.equal(await shown('#ambient .reel'), true);
  assert.equal(await shown('#ambient .reel-comments'), true);
  await page.waitForFunction(() => document.querySelector('#ambient .reel-caption').textContent.trim().length > 0, null, { timeout: 3000 });
  await page.waitForFunction(() => document.querySelectorAll('#ambient .reel-comment').length >= 5, null, { timeout: 6000 });
  // The canvas is drawn: plenty of non-black pixels in the runner's half.
  const lit = await page.$eval('#ambient .reel-canvas', (c) => {
    const d = c.getContext('2d').getImageData(0, c.height / 2, c.width, c.height / 2).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
    return n / (d.length / 4);
  });
  assert.ok(lit > 0.5, `canvas lit ${lit}`);
  assert.match(await page.$eval('#ambient .reel-marquee-text', (e) => e.textContent), /Sigma Drift/);
  assert.match(await hint(), /Scroll/);
  assert.deepEqual(errors, []);
});

test('▲▼ scroll the feed; OK pauses the feed and its music together; ▶ skips a song', async () => {
  await openFeed();
  await page.waitForFunction(() => window.CleanHub.player.state().playing, null, { timeout: 5000 });
  await press('ArrowDown');
  assert.deepEqual([(await app()).reel.n, (await app()).reel.kind], [1, 'bounce']);
  await press('ArrowDown');
  assert.equal((await app()).reel.kind, 'texting');
  await press('ArrowUp');
  assert.equal((await app()).reel.n, 1);
  await page.waitForTimeout(600); // the old video has slid away
  assert.equal(await page.$$eval('#ambient .reel-stage', (els) => els.length), 1);
  await press('Enter');
  let a = await app();
  assert.equal(a.reel.paused, true);
  assert.equal(a.player.wanted, false);
  assert.equal(await page.$eval('#ambient .reel-pause', (e) => e.classList.contains('is-shown')), true);
  assert.match(await hint(), /OKPlay/);
  const t = a.reel.t;
  await page.waitForTimeout(400);
  assert.equal((await app()).reel.t, t, 'a paused video stays still');
  await press('Enter');
  a = await app();
  assert.equal(a.reel.paused, false);
  assert.equal(a.player.wanted, true);
  await press('ArrowRight');
  assert.equal((await app()).player.title, 'Ohio Funk');
  await press('Enter'); // pause, then scroll: a new video plays, music too
  await press('ArrowDown');
  a = await app();
  assert.equal(a.reel.paused, false);
  assert.equal(a.player.wanted, true);
  assert.deepEqual(errors, []);
});

test('a video that ends gives way to the next one', async () => {
  await page.clock.install();
  await openFeed(S({ music: 'off' }));
  const first = await app();
  await page.clock.runFor((first.reel.duration + 1) * 1000);
  const a = await app();
  assert.equal(a.reel.n, 1);
  assert.equal(a.reel.kind, 'bounce');
  assert.ok(a.reel.t < 2, `fresh video, t=${a.reel.t}`);
});

test('Back leaves the feed: drawing and music stop', async () => {
  await openFeed();
  await page.waitForFunction(() => window.CleanHub.player.state().playing, null, { timeout: 5000 });
  await press('Escape');
  const a = await app();
  assert.equal(a.screen, 'home');
  assert.equal(a.reel.running, false);
  assert.equal(a.player.wanted, false);
  const t = a.reel.t;
  await page.waitForTimeout(300);
  assert.equal((await app()).reel.t, t);
});

test('the feed stops while the TV hides the app and carries on after', async () => {
  await openFeed(S({ music: 'off' }));
  await page.evaluate(() => window.__mock.goHidden());
  const t = (await app()).reel.t;
  await page.waitForTimeout(300);
  assert.equal((await app()).reel.t, t);
  await page.evaluate(() => window.__mock.returnFromApp());
  await page.waitForFunction((t0) => window.CleanHub.reel.state().t > t0, t, { timeout: 3000 });
});

// Counts the sounds the reels make, by watching what Web Audio is asked to play.
async function countSounds() {
  await page.addInitScript(() => {
    const AC = window.AudioContext;
    window.__sounds = 0;
    window.AudioContext = function () {
      const c = new AC();
      const osc = c.createOscillator.bind(c);
      const buf = c.createBufferSource.bind(c);
      c.createOscillator = function () { window.__sounds++; return osc(); };
      c.createBufferSource = function () { window.__sounds++; return buf(); };
      return c;
    };
  });
}

test('◀ turns the music off and on; the reels keep their own sound; the choice is kept', async () => {
  await countSounds();
  await openFeed();
  await page.waitForFunction(() => window.CleanHub.player.state().playing, null, { timeout: 5000 });
  assert.match(await hint(), /◀Music off/);
  await press('ArrowLeft');
  let a = await app();
  assert.equal(a.settings.brainrotMusic, 'off');
  assert.equal(a.player.count, 0, 'no soundtrack queued');
  assert.equal(a.player.wanted, false);
  assert.equal(a.reel.running, true);
  assert.equal(a.reel.paused, false);
  assert.match(await hint(), /◀Music on/);
  assert.doesNotMatch(await hint(), /Next song/);
  assert.match(await page.$eval('#ambient .reel-marquee-text', (e) => e.textContent), /original sound/);
  const before = await page.evaluate(() => window.__sounds);
  await page.waitForTimeout(2500);
  const made = (await page.evaluate(() => window.__sounds)) - before;
  assert.ok(made > 4, `the reel kept making its own sounds (${made})`);
  await page.reload();
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
  a = await app();
  assert.equal(a.settings.brainrotMusic, 'off', 'kept across a restart');
  assert.equal(a.player.wanted, false);
  await press('ArrowLeft');
  await page.waitForFunction(() => window.CleanHub.player.state().playing, null, { timeout: 5000 });
  a = await app();
  assert.equal(a.settings.brainrotMusic, 'on');
  assert.equal(a.player.set, 'brainrot');
  assert.deepEqual(errors, []);
});

test('Ambient’s own Music setting doesn’t silence Brainrot mode', async () => {
  await openFeed(S({ music: 'off' }));
  await page.waitForFunction(() => window.CleanHub.player.state().playing, null, { timeout: 5000 });
  assert.equal((await app()).player.set, 'brainrot');
});

test('every reel speaks its captions and makes its own sounds, with no music', async () => {
  await countSounds();
  await page.clock.install();
  await openFeed(S({ brainrotMusic: 'off' }));
  const kinds = await page.evaluate(() => window.CleanHub.brainrot.KINDS.length);
  const quiet = [];
  for (let i = 0; i < kinds; i++) {
    const kind = (await app()).reel.kind;
    const before = await page.evaluate(() => window.__sounds);
    for (let k = 0; k < 16; k++) await page.clock.runFor(500);
    if ((await page.evaluate(() => window.__sounds)) - before < 5) quiet.push(kind);
    await press('ArrowDown');
  }
  assert.deepEqual(quiet, [], 'reels without their own sound');
  assert.equal((await app()).player.wanted, false, 'and no music');
});

test('with Brainrot mode off, Ambient is the usual wallpaper and never plays the brainrot set', async () => {
  await openFeed(S({ brainrot: 'off' }));
  assert.equal(await shown('#ambient .reel'), false);
  assert.equal((await app()).reel.running, false);
  const sets = await page.evaluate(() => {
    const p = window.CleanHub.player;
    const out = [];
    for (let i = 0; i < p.state().count; i++) {
      out.push(p.state().track.set);
      p.next();
    }
    return out;
  });
  assert.ok(sets.length > 0);
  assert.ok(!sets.includes('brainrot'), sets.join(','));
});

test('the feed comes back by itself after a restart (TV switched off on it)', async () => {
  await openFeed();
  await page.reload();
  await page.waitForFunction(() => window.CleanHub.main.state.fresh);
  const a = await app();
  assert.equal(a.screen, 'ambient');
  assert.equal(a.reel.running, true);
  assert.deepEqual(errors, []);
});

test('every kind of video draws without errors, and each new one does its thing', async () => {
  await page.clock.install();
  await openFeed(S({ music: 'off' }));
  // What each kind shows, checked every half second of its first 13 s. A
  // 13 s video (sigma) may already have given way to the next one by the last
  // look, so a missing element reads as null rather than throwing.
  const look = (k) => page.evaluate((kind) => {
    const q = (sel) => document.querySelector('#ambient .reel-stage ' + sel);
    const text = (sel) => (q(sel) ? q(sel).textContent : null);
    if (kind === 'texting') return document.querySelectorAll('#ambient .reel-stage .reel-bubble:not(.is-typing)').length;
    if (kind === 'odd') return !!q('.reel-odd-cell.is-odd');
    if (kind === 'race') return text('.reel-race-hud .reel-hud-big');
    if (kind === 'sigma') return text('.reel-sigma-title');
    return kind;
  }, k);
  const seen = {};
  const kinds = await page.evaluate(() => window.CleanHub.brainrot.KINDS.length);
  for (let i = 0; i < kinds; i++) {
    const kind = (await app()).reel.kind;
    const sights = [];
    for (let step = 0; step < 26; step++) {
      await page.clock.runFor(500);
      sights.push(await look(kind));
    }
    seen[kind] = sights;
    await press('ArrowDown');
  }
  assert.deepEqual(Object.keys(seen).sort(), ['aura', 'bounce', 'dvd', 'italian', 'odd', 'race', 'sand', 'sigma', 'story', 'texting']);
  assert.ok(Math.max(...seen.texting) >= 4, `messages arrived: ${seen.texting}`);
  assert.equal(seen.odd[0], false, 'hidden during the countdown');
  assert.ok(seen.odd.includes(true), 'the odd one is revealed after it');
  assert.ok(['3', '2', '1'].includes(seen.race[0]) && seen.race.includes('GO!'), 'a countdown, then go');
  assert.ok(seen.race.some((s) => /WINS!$/.test(s)), seen.race.join(','));
  assert.match(seen.sigma[0], /^SIGMA RULE #\d+$/);
  assert.deepEqual(errors, []);
});
