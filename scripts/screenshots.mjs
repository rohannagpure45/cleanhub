// Captures the workbench at 1920x1080 into docs/screens/ (used by the README
// and for design review). Run: node scripts/screenshots.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { start } from '../workbench/server.mjs';

const OUT = fileURLToPath(new URL('../docs/screens/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

async function shot(name, settings, keys = [], query = '') {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.addInitScript((s) => {
    localStorage.setItem('cleanhub.settings', JSON.stringify(s));
  }, settings);
  await page.goto(base + query);
  await page.waitForFunction(() => window.CleanHub.main.state.loaded);
  await page.evaluate(() => document.fonts.ready);
  for (const k of keys) await page.keyboard.press(k);
  await page.waitForTimeout(450);
  await page.screenshot({ path: OUT + name + '.png' });
  await context.close();
  console.log('wrote docs/screens/' + name + '.png');
}

const S = (o) => Object.assign({ v: 1, layout: 'list', theme: 'dusk', font: 'manrope', focus: 'glass', icons: 'on', clock: '12', apps: null }, o);

await shot('list-dusk', S({}), ['ArrowDown']);
await shot('list-type-fraunces-ember', S({ theme: 'ember', font: 'fraunces', focus: 'type' }), ['ArrowDown', 'ArrowDown']);
await shot('list-text-night', S({ theme: 'night', icons: 'off', font: 'grotesk' }));
await shot('dock-tide', S({ layout: 'dock', theme: 'tide' }), ['ArrowRight']);
await shot('dock-paper', S({ layout: 'dock', theme: 'paper', font: 'grotesk' }), ['ArrowRight', 'ArrowRight']);
await shot('settings', S({}), Array(8).fill('ArrowDown').concat(['Enter', 'ArrowDown', 'ArrowDown']));
await shot('apps-on-home', S({}), Array(8).fill('ArrowDown').concat(['Enter', 'Enter', 'ArrowDown', 'Enter', 'ArrowDown']));

await browser.close();
server.close();
