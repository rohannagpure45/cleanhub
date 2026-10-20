import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, memoryStorage } from './load.mjs';

const CH = load();
const plain = (v) => JSON.parse(JSON.stringify(v));

test('load returns defaults when nothing is stored', () => {
  assert.deepEqual(plain(CH.store.load(memoryStorage())), plain(CH.store.defaults()));
});

test('load survives corrupt JSON and a throwing storage', () => {
  assert.deepEqual(plain(CH.store.load(memoryStorage({ [CH.store.KEY]: '{nope' }))), plain(CH.store.defaults()));
  const throwing = { getItem() { throw new Error('denied'); } };
  assert.deepEqual(plain(CH.store.load(throwing)), plain(CH.store.defaults()));
});

test('sanitize keeps valid values and drops unknown ones', () => {
  const s = CH.store.sanitize({ layout: 'dock', theme: 'neon', font: 'fraunces', focus: 'type', clock: '24', extra: 1 });
  assert.equal(s.layout, 'dock');
  assert.equal(s.theme, 'dusk');
  assert.equal(s.font, 'fraunces');
  assert.equal(s.focus, 'type');
  assert.equal(s.clock, '24');
  assert.equal('extra' in s, false);
});

test('sanitize dedupes app ids, drops non-strings and caps the list', () => {
  const many = Array.from({ length: 60 }, (_, i) => 'app.' + i);
  assert.equal(CH.store.sanitize({ apps: many }).apps.length, CH.store.MAX_APPS);
  assert.deepEqual(plain(CH.store.sanitize({ apps: ['a', 'a', 3, '', null, 'b'] }).apps), ['a', 'b']);
  assert.equal(CH.store.sanitize({ apps: 'a' }).apps, null);
});

test('save then load round-trips', () => {
  const storage = memoryStorage();
  const s = Object.assign(CH.store.defaults(), { layout: 'dock', apps: ['x', 'y'] });
  assert.equal(CH.store.save(storage, s), true);
  assert.deepEqual(plain(CH.store.load(storage)), plain(s));
});

test('save reports failure instead of throwing (e.g. storage full)', () => {
  const full = { setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(CH.store.save(full, CH.store.defaults()), false);
});

test('cycle wraps in both directions', () => {
  const s = CH.store.defaults();
  assert.equal(CH.store.cycle(s, 'layout', 1).layout, 'dock');
  assert.equal(CH.store.cycle(CH.store.cycle(s, 'layout', 1), 'layout', 1).layout, 'list');
  assert.equal(CH.store.cycle(s, 'clock', -1).clock, 'off');
  assert.equal(s.layout, 'list', 'cycle must not mutate');
});

test('label names an option and falls back to the id', () => {
  assert.equal(CH.store.label('font', 'grotesk'), 'Space Grotesk');
  assert.equal(CH.store.label('font', 'mystery'), 'mystery');
});
