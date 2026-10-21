// Copies app/ to dist/app, ready for `tizen package`, after checking that
// the ids and versions the rest of the project relies on agree.
//   node scripts/build.mjs
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function manifest() {
  const xml = readFileSync(ROOT + 'app/config.xml', 'utf8');
  const app = xml.match(/<tizen:application\s+id="([^"]+)"\s+package="([^"]+)"\s+required_version="([^"]+)"/);
  const version = xml.match(/<widget[^>]*\sversion="([^"]+)"/);
  if (!app || !version) throw new Error('config.xml: missing tizen:application or widget version');
  return { appId: app[1], packageId: app[2], requiredVersion: app[3], version: version[1] };
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
  for (const f of ['index.html', 'icon.png', 'css/fonts.css', 'img/bg-dusk.jpg']) {
    if (!existsSync(ROOT + 'app/' + f)) out.push(`app/${f} is missing (run the asset scripts)`);
  }
  const icons = Object.keys(JSON.parse(readFileSync(ROOT + 'scripts/app-icons.json', 'utf8'))).filter((k) => k[0] !== '_');
  const noIcon = icons.filter((k) => !existsSync(ROOT + 'app/img/apps/' + k + '.png'));
  if (noIcon.length) out.push(`app icons missing for ${noIcon.join(', ')} (run python3 scripts/fetch-icons.py)`);
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
  cpSync(ROOT + 'app', ROOT + 'dist/app', { recursive: true });
  const m = manifest();
  console.log(`Built dist/app (${m.appId} ${m.version}).`);
}
