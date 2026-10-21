// Captures the workbench at 1920x1080 into docs/screens/ (used by the README
// and for design review), plus two contact sheets: the six Ambient scenes and
// a strip of Brainrot reels. Run: node scripts/screenshots.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { start } from '../workbench/server.mjs';

const OUT = fileURLToPath(new URL('../docs/screens/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// Every shot shows the same evening, so the clock doesn't change between runs.
const TIME = new Date('2026-10-20T21:07:00');

async function open(settings, query = '') {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.clock.setFixedTime(TIME);
  await page.addInitScript((s) => {
    localStorage.setItem('cleanhub.settings', JSON.stringify(s));
  }, settings);
  await page.goto(base + query);
  await page.waitForFunction(() => window.CleanHub.main.state.loaded);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function press(page, keys) {
  for (const k of keys) await page.keyboard.press(k);
}

async function shot(name, settings, keys = [], query = '', settle = 450) {
  const page = await open(settings, query);
  await press(page, keys);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: OUT + name + '.png' });
  await page.context().close();
  console.log('wrote docs/screens/' + name + '.png');
}

// Lays images out in a grid and saves it as one JPEG.
async function sheet(name, images, cols, width) {
  const page = await browser.newPage({ viewport: { width, height: 100 } });
  const cells = images.map((png) => `<img src="data:image/png;base64,${png.toString('base64')}">`).join('');
  await page.setContent(`<style>
    body { margin: 0; background: #000; }
    div { display: grid; grid-template-columns: repeat(${cols}, 1fr); }
    img { display: block; width: 100%; }
  </style><div>${cells}</div>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  writeFileSync(OUT + name + '.jpg', await page.locator('div').screenshot({ type: 'jpeg', quality: 84 }));
  await page.close();
  console.log('wrote docs/screens/' + name + '.jpg');
}

const S = (o) => Object.assign({
  v: 1, layout: 'list', theme: 'dusk', font: 'manrope', focus: 'glass', icons: 'on', clock: '12',
  ambient: 'on', wallpaper: 'lamp', motion: 'on', music: ['originals', 'classical', 'piano', 'ambient'],
  input: 'hdmi4', brainrot: 'off', brainrotMusic: 'on', apps: null
}, o);

// Settings rows by label, so the keys below survive new rows.
const ROWS = ['Apps on Home', 'Layout', 'Background', 'Font', 'Focus style', 'Icons in list', 'Clock',
  'Ambient on Home', 'Ambient wallpaper', 'Wallpaper motion', 'Ambient music', 'Fire TV on Home',
  'Reset to defaults', 'Brainrot mode'];
const down = (n) => Array(n).fill('ArrowDown');
const toRow = (label) => ['ArrowRight', 'Enter', ...down(ROWS.indexOf(label))];

await shot('list-dusk', S({}), down(3));
await shot('list-type-fraunces-ember', S({ theme: 'ember', font: 'fraunces', focus: 'type' }), down(3));
await shot('list-text-night', S({ theme: 'night', icons: 'off', font: 'grotesk' }));
await shot('dock-tide', S({ layout: 'dock', theme: 'tide' }), ['ArrowRight', 'ArrowRight']);
await shot('dock-paper', S({ layout: 'dock', theme: 'paper', font: 'grotesk' }), ['ArrowRight', 'ArrowRight', 'ArrowRight']);
// From the bottom of the sheet up, so the rows below stay in view.
await shot('settings', S({ wallpaper: 'aurora' }), [...toRow('Brainrot mode'), 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp']);
await shot('music', S({}), [...toRow('Ambient music'), 'Enter', ...down(3)]);
await shot('apps-on-home', S({}), ['ArrowRight', 'Enter', 'Enter', 'ArrowDown', 'Enter', 'ArrowDown']);
await shot('list-paper-many', S({ theme: 'paper', focus: 'type', input: 'off' }), down(7), '?apps=many');
await shot('home-gear-focused', S({ theme: 'tide' }), ['ArrowRight']);
await shot('ambient-controls', S({}), ['Enter']);
await shot('ambient-lamp', S({}), ['Enter'], '', 7000);
await shot('ambient-midnight', S({ wallpaper: 'midnight' }), ['Enter'], '', 7000);

// Ambient's five full-colour scenes, once the controls have faded.
const scenes = [];
for (const wallpaper of ['sunset', 'coast', 'dunes', 'aurora', 'rain']) {
  const page = await open(S({ wallpaper }));
  await press(page, ['Enter']);
  await page.waitForTimeout(7000);
  scenes.push(await page.screenshot());
  await page.context().close();
}
await sheet('ambient-scenes', scenes, 2, 1440);

// Brainrot mode: one whole screen, then the phone from each kind of reel
// (CleanHub.brainrot.KINDS is the feed's order; some kinds come round twice).
{
  const page = await open(S({ brainrot: 'on' }));
  await press(page, ['Enter']);
  const reels = [];
  const kinds = [];
  const length = await page.evaluate(() => window.CleanHub.brainrot.KINDS.length);
  for (let n = 0; n < length; n++) {
    if (n) await press(page, ['ArrowDown']);
    await page.waitForTimeout(n ? 4200 : 7000); // the first waits for the key guide to fade
    const kind = await page.evaluate(() => window.CleanHub.reel.state().kind);
    if (n === 0) await page.screenshot({ path: OUT + 'brainrot.png' });
    if (kinds.includes(kind)) continue;
    kinds.push(kind);
    reels.push(await page.locator('.reel-phone').screenshot());
  }
  await page.context().close();
  console.log('wrote docs/screens/brainrot.png; reels: ' + kinds.join(', '));
  await sheet('brainrot-reels', reels, 5, 1600);
}

await browser.close();
server.close();
