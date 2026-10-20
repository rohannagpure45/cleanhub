import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, TV_APPS } from './load.mjs';

const CH = load();
const plain = (v) => JSON.parse(JSON.stringify(v));

test('normalize drops hidden, nameless, service, duplicate and self entries', () => {
  const ids = plain(CH.apps.normalize(TV_APPS, CH.catalog).map((e) => e.id));
  assert.deepEqual(ids.sort(), [
    '9Ur5IzDKqV.TizenYouTube',
    'MCmYXNxgcu.DisneyPlus',
    'RN1MCdNq8t.Netflix',
    'abc.Weather',
    'cj37Ni3qXM.HBONow',
    'com.samsung.tv.store',
    'org.tizen.ignition'
  ]);
});

test('normalize keeps Prime Video despite its org.tizen id', () => {
  const prime = CH.apps.normalize(TV_APPS, CH.catalog).find((e) => e.key === 'prime');
  assert.equal(prime.id, 'org.tizen.ignition');
  assert.equal(prime.name, 'Prime Video');
});

test('normalize uses catalog names and colors, and monograms for unknown apps', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  const max = list.find((e) => e.id === 'cj37Ni3qXM.HBONow');
  assert.equal(max.key, 'max');
  assert.equal(max.bg, '#002BE7');
  const weather = list.find((e) => e.id === 'abc.Weather');
  assert.equal(weather.key, null);
  assert.equal(weather.mono, 'WN');
  assert.match(weather.bg, /^hsl\(/);
});

test('normalize keeps a usable icon path and ignores empty ones', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  assert.equal(list.find((e) => e.key === 'netflix').icon, '/opt/usr/apps/RN1MCdNq8t/shared/res/icon.png');
  assert.equal(list.find((e) => e.key === 'youtube').icon, null);
});

test('normalize sorts by name and tolerates junk input', () => {
  const names = plain(CH.apps.normalize(TV_APPS, CH.catalog).map((e) => e.name));
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(plain(CH.apps.normalize(null, CH.catalog)), []);
  assert.deepEqual(plain(CH.apps.normalize([null, 7, {}], CH.catalog)), []);
});

test('YouTube TV and YouTube Kids are not mistaken for YouTube', () => {
  const list = CH.apps.normalize([
    { id: 'a.YTV', name: 'YouTube TV', show: true },
    { id: 'b.Kids', name: 'YouTube Kids', show: true },
    { id: 'c.YT', name: 'YouTube', show: true }
  ], CH.catalog);
  const keys = Object.fromEntries(list.map((e) => [e.id, e.key]));
  assert.deepEqual(keys, { 'a.YTV': 'youtubetv', 'b.Kids': 'kids', 'c.YT': 'youtube' });
});

test('pickDefault follows the preferred order and limit', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  assert.deepEqual(plain(CH.apps.pickDefault(list, CH.defaultOrder, 3)),
    ['RN1MCdNq8t.Netflix', '9Ur5IzDKqV.TizenYouTube', 'org.tizen.ignition']);
});

test('pickDefault falls back to the first apps when none are recognised', () => {
  const list = CH.apps.normalize([{ id: 'x.A', name: 'Alpha', show: true }, { id: 'x.B', name: 'Beta', show: true }], CH.catalog);
  assert.deepEqual(plain(CH.apps.pickDefault(list, CH.defaultOrder, 8)), ['x.A', 'x.B']);
});

test('arrange honours saved order and skips apps no longer installed', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  const out = CH.apps.arrange(list, ['abc.Weather', 'gone.App', 'RN1MCdNq8t.Netflix'], CH.defaultOrder, 8);
  assert.deepEqual(plain(out.map((e) => e.id)), ['abc.Weather', 'RN1MCdNq8t.Netflix']);
});

test('arrange with an empty saved list shows nothing (viewer removed everything)', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  assert.equal(CH.apps.arrange(list, [], CH.defaultOrder, 8).length, 0);
});

test('move reorders and clamps', () => {
  assert.deepEqual(plain(CH.apps.move(['a', 'b', 'c'], 0, 2)), ['b', 'c', 'a']);
  assert.deepEqual(plain(CH.apps.move(['a', 'b', 'c'], 2, -5)), ['c', 'a', 'b']);
  assert.deepEqual(plain(CH.apps.move(['a', 'b', 'c'], 7, 0)), ['a', 'b', 'c']);
});

test('toggle adds at the end and removes in place', () => {
  assert.deepEqual(plain(CH.apps.toggle(['a', 'b'], 'c')), ['a', 'b', 'c']);
  assert.deepEqual(plain(CH.apps.toggle(['a', 'b', 'c'], 'b')), ['a', 'c']);
});
