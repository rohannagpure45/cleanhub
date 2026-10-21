// Copies app/ to dist/app, ready for `tizen package`, after checking that
// the ids and versions the rest of the project relies on agree.
//   node scripts/build.mjs
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function manifest() {
  const xml = readFileSync(ROOT + 'app/config.xml', 'utf8');
  const app = xml.match(/<tizen:application\s+id="([^"]+)"\s+package="([^"]+)"\s+required_version="([^"]+)"/);
  const version = xml.match(/<widget[^>]*\sversion="([^"]+)"/);
  if (!app || !version) throw new Error('config.xml: missing tizen:application or widget version');
  return { appId: app[1], packageId: app[2], requiredVersion: app[3], version: version[1] };
}

// Every Ambient wallpaper needs its Settings swatch and, unless it is Black
// or Rotate, its picture and the CSS rule that shows it.
export function wallpaperProblems() {
  const ctx = {};
  vm.runInNewContext(readFileSync(ROOT + 'app/js/options.js', 'utf8'), ctx);
  const css = readFileSync(ROOT + 'app/css/app.css', 'utf8');
  const out = [];
  for (const w of ctx.CleanHub.options.wallpaper) {
    if (!existsSync(ROOT + `app/img/thumb-wall-${w.id}.jpg`)) out.push(`wallpaper ${w.id}: app/img/thumb-wall-${w.id}.jpg is missing (run npm run wallpapers)`);
    if (w.kind === 'rotate' || w.id === 'black') continue;
    if (!existsSync(ROOT + `app/img/ambient-${w.id}.jpg`)) out.push(`wallpaper ${w.id}: app/img/ambient-${w.id}.jpg is missing (run npm run wallpapers)`);
    if (!css.includes(`.ambient-wall.wall-${w.id} { background-image: url(../img/ambient-${w.id}.jpg); }`)) {
      out.push(`wallpaper ${w.id}: app.css has no .ambient-wall.wall-${w.id} rule`);
    }
  }
  return out.concat(motionProblems(ctx.CleanHub.options.wallpaper, css));
}

// Every moving layer in js/walls.js needs its picture, keyframes app.css
// defines, and (if it drifts) a width of exactly two of its seamless tiles.
export function motionProblems(walls, css) {
  const ctx = {};
  vm.runInNewContext(readFileSync(ROOT + 'app/js/walls.js', 'utf8'), ctx);
  const layers = ctx.CleanHub.wallLayers;
  const out = [];
  const keyframes = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  for (const w of walls) {
    if (w.kind === 'scene' && !layers[w.id]) out.push(`wallpaper ${w.id}: no moving layers in js/walls.js`);
  }
  for (const [id, list] of Object.entries(layers)) {
    for (const l of list) {
      if (l.src && !existsSync(ROOT + 'app/' + l.src)) out.push(`wallpaper ${id}: ${l.src} is missing (run npm run wallpapers)`);
      for (const name of (l.anim || '').split(',').map((a) => a.trim().split(/\s+/)[0]).filter(Boolean)) {
        if (!keyframes.has(name)) out.push(`wallpaper ${id}: app.css has no @keyframes ${name}`);
        const drift = name.match(/^wall-drift-(\d+)$/);
        if (drift && l.w !== 2 * Number(drift[1])) out.push(`wallpaper ${id}: ${l.src} drifts by ${drift[1]} px but is ${l.w} px wide`);
      }
    }
  }
  return out;
}

export function problems() {
  const out = [];
  const m = manifest();
  const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'));
  const main = readFileSync(ROOT + 'app/js/main.js', 'utf8').match(/const VERSION = '([^']+)'/);
  const self = readFileSync(ROOT + 'app/js/apps.js', 'utf8').match(/CH\.selfIdPrefix = '([^']+)'/);
  if (!/^[A-Za-z0-9]{10}$/.test(m.packageId)) out.push(`package id "${m.packageId}" must be exactly 10 letters/digits`);
  if (m.appId.indexOf(m.packageId + '.') !== 0) out.push(`app id "${m.appId}" must start with "${m.packageId}."`);
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(m.version)) out.push(`version "${m.version}" must look like 0.1.0`);
  if (Number(m.requiredVersion) > 6.5) out.push(`required_version ${m.requiredVersion} is newer than the TV (6.5)`);
  if (pkg.version !== m.version) out.push(`package.json version ${pkg.version} != config.xml ${m.version}`);
  if (!main || main[1] !== m.version) out.push(`main.js VERSION ${main && main[1]} != config.xml ${m.version}`);
  if (!self || self[1] !== m.packageId + '.') out.push(`apps.js selfIdPrefix ${self && self[1]} != "${m.packageId}."`);
  // The page starts the Fire TV service by id, and the service answers the page by id.
  const xml = readFileSync(ROOT + 'app/config.xml', 'utf8');
  const service = (xml.match(/<tizen:service\s+id="([^"]+)"/) || [])[1];
  const asked = (readFileSync(ROOT + 'app/js/platform.js', 'utf8').match(/const FIRETV_SERVICE = '([^']+)'/) || [])[1];
  const answers = (readFileSync(ROOT + 'app/service/firetv.js', 'utf8').match(/const UI_APP = '([^']+)'/) || [])[1];
  if (!service || service.indexOf(m.packageId + '.') !== 0) out.push(`service id "${service}" must start with "${m.packageId}."`);
  if (asked !== service) out.push(`platform.js FIRETV_SERVICE ${asked} != config.xml service ${service}`);
  if (answers !== m.appId) out.push(`service/firetv.js UI_APP ${answers} != ${m.appId}`);
  for (const f of ['index.html', 'icon.png', 'css/fonts.css', 'img/bg-dusk.jpg']) {
    if (!existsSync(ROOT + 'app/' + f)) out.push(`app/${f} is missing (run the asset scripts)`);
  }
  const icons = Object.keys(JSON.parse(readFileSync(ROOT + 'scripts/app-icons.json', 'utf8'))).filter((k) => k[0] !== '_');
  const noIcon = icons.filter((k) => !existsSync(ROOT + 'app/img/apps/' + k + '.png'));
  if (noIcon.length) out.push(`app icons missing for ${noIcon.join(', ')} (run python3 scripts/fetch-icons.py)`);
  out.push(...wallpaperProblems());
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = problems();
  if (found.length) {
    console.error('Build stopped:\n' + found.map((p) => '  ' + p).join('\n'));
    process.exit(1);
  }
  execFileSync(process.execPath, [ROOT + 'scripts/check-compat.mjs'], { stdio: 'inherit' });
  rmSync(ROOT + 'dist/app', { recursive: true, force: true });
  // A Fire TV pairing never ships from app/; tv.py adds it to dist/app.
  cpSync(ROOT + 'app', ROOT + 'dist/app', { recursive: true, filter: (src) => !src.endsWith('/service/config.json') });
  const m = manifest();
  console.log(`Built dist/app (${m.appId} ${m.version}).`);
}
