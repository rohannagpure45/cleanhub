import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from './load.mjs';

const CH = load();
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = ROOT + 'app/img/apps/';
// Spread: arrays from the sandbox fail deepStrictEqual against local ones.
const withArt = [...CH.catalog.filter((a) => a.art !== false).map((a) => a.key)].sort();

// Width and height from a PNG's IHDR chunk.
function pngSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', file + ' is not a PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('every catalog app with art has a 192 px square icon in app/img/apps', () => {
  for (const key of withArt) {
    const file = DIR + key + '.png';
    assert.ok(existsSync(file), `${key}.png is missing: run python3 scripts/fetch-icons.py`);
    assert.deepEqual(pngSize(file), [192, 192], key);
  }
});

test('app/img/apps holds nothing the catalog does not use', () => {
  const files = readdirSync(DIR).filter((f) => !f.startsWith('.')).sort();
  assert.deepEqual(files, withArt.map((k) => k + '.png'));
});

test('scripts/app-icons.json lists a source for exactly the apps with art', () => {
  const sources = JSON.parse(readFileSync(ROOT + 'scripts/app-icons.json', 'utf8'));
  assert.deepEqual(Object.keys(sources).filter((k) => !k.startsWith('_')).sort(), withArt);
});
