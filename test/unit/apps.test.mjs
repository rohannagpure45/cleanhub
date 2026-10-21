import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, TV_APPS } from './load.mjs';

const CH = load();
const plain = (v) => JSON.parse(JSON.stringify(v));

test('normalize keeps real apps and drops twins, companions, utilities and junk', () => {
  const ids = plain(CH.apps.normalize(TV_APPS, CH.catalog).map((e) => e.id));
  assert.deepEqual(ids.sort(), [
    '5b8c3eb16b.BeamCTVDev',
    '9Ur5IzDKqV.TizenYouTube',
    'MCmYXNxgcu.DisneyPlus',
    'abc123defg.WeatherNow',
    'org.tizen.netflix-app',
    'org.tizen.primevideo'
  ]);
});

test('when an app is listed twice, the preferred id wins whatever the order', () => {
  const twins = [
    { id: 'com.samsung.tv.cobalt-yt', name: 'YouTube', show: true },
    { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', show: true }
  ];
  for (const list of [twins, [...twins].reverse()]) {
    const out = CH.apps.normalize(list, CH.catalog);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '9Ur5IzDKqV.TizenYouTube');
  }
  // With only the Cobalt build installed, that one is used.
  assert.equal(CH.apps.normalize([twins[0]], CH.catalog)[0].key, 'youtube');
});

test('a recognised id is kept even when the TV marks it hidden; a name match is not', () => {
  const list = CH.apps.normalize([
    { id: '5b8c3eb16b.BeamCTVDev', name: 'Max', show: false },
    { id: 'zzzzzzzzzz.Netflix', name: 'Netflix', show: false }
  ], CH.catalog);
  assert.deepEqual(plain(list.map((e) => e.key)), ['max']);
});

test('unknown apps need a store-style id and a non-plumbing name', () => {
  const list = CH.apps.normalize([
    { id: 'abcdefghij.Radio', name: 'Radio Garden', show: true },
    { id: 'com.samsung.tv.gallery', name: 'Gallery', show: true },
    { id: 'abcdefghij.Worker', name: 'Sync worker', show: true },
    { id: 'ep12345678.Ep', name: 'EP Player', show: true }
  ], CH.catalog);
  assert.deepEqual(plain(list.map((e) => e.name)), ['Radio Garden']);
});

test('the everything view keeps visible plumbing but still drops junk and itself', () => {
  const names = plain(CH.apps.normalize(TV_APPS, CH.catalog, true).map((e) => e.name));
  assert.ok(names.includes('Apps') && names.includes('ADPlayer') && names.includes('e-Manual'));
  assert.ok(!names.includes('Smart Hub') && !names.includes('Clean Hub') && !names.includes('Broken'));
  assert.equal(names.filter((n) => n === 'Weather Now').length, 1);
});

test('normalize uses catalog names and colours, and monograms for unknown apps', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  const max = list.find((e) => e.id === '5b8c3eb16b.BeamCTVDev');
  assert.equal(max.key, 'max');
  assert.equal(max.bg, '#002BE7');
  const weather = list.find((e) => e.id === 'abc123defg.WeatherNow');
  assert.equal(weather.key, null);
  assert.equal(weather.mono, 'WN');
  assert.equal(weather.bg, CH.apps.fillFor('abc123defg.WeatherNow'));
  assert.equal(CH.apps.fillFor('abc123defg.WeatherNow'), CH.apps.fillFor('abc123defg.WeatherNow'));
});

test('normalize keeps a usable icon path and ignores empty ones', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  assert.equal(list.find((e) => e.key === 'netflix').icon, '/opt/usr/globalapps/org.tizen.netflix-app/shared/res/icon.png');
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
    { id: 'aaaaaaaaaa.YTV', name: 'YouTube TV', show: true },
    { id: 'bbbbbbbbbb.Kids', name: 'YouTube Kids', show: true },
    { id: 'cccccccccc.YT', name: 'YouTube', show: true }
  ], CH.catalog);
  const keys = Object.fromEntries(list.map((e) => [e.id, e.key]));
  assert.deepEqual(keys, { 'aaaaaaaaaa.YTV': 'youtubetv', 'bbbbbbbbbb.Kids': 'kids', 'cccccccccc.YT': 'youtube' });
});

test('pickDefault follows the preferred order and limit', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  assert.deepEqual(plain(CH.apps.pickDefault(list, CH.defaultOrder, 3)),
    ['org.tizen.netflix-app', '9Ur5IzDKqV.TizenYouTube', 'org.tizen.primevideo']);
});

test('pickDefault falls back to the first apps when none are recognised', () => {
  const list = CH.apps.normalize([{ id: 'xxxxxxxxxx.A', name: 'Alpha', show: true }, { id: 'xxxxxxxxxx.B', name: 'Beta', show: true }], CH.catalog);
  assert.deepEqual(plain(CH.apps.pickDefault(list, CH.defaultOrder, 8)), ['xxxxxxxxxx.A', 'xxxxxxxxxx.B']);
});

test('arrange honours saved order and skips apps no longer installed', () => {
  const list = CH.apps.normalize(TV_APPS, CH.catalog);
  const out = CH.apps.arrange(list, ['abc123defg.WeatherNow', 'gone.App', 'org.tizen.netflix-app'], CH.defaultOrder, 8);
  assert.deepEqual(plain(out.map((e) => e.id)), ['abc123defg.WeatherNow', 'org.tizen.netflix-app']);
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

test('mergeChosen keeps the slots of apps that are briefly missing', () => {
  const present = { a: true, b: true, c: true };
  // Saved: a, gone, b, c. The viewer moves c to the top.
  assert.deepEqual(plain(CH.apps.mergeChosen(['a', 'gone', 'b', 'c'], ['c', 'a', 'b'], present, 40)), ['c', 'gone', 'a', 'b']);
  // Removing b leaves gone where it was; adding d goes to the end.
  assert.deepEqual(plain(CH.apps.mergeChosen(['a', 'gone', 'b'], ['a', 'd'], Object.assign({ d: true }, present), 40)), ['a', 'gone', 'd']);
});

test('mergeChosen drops missing apps first when over the cap, never visible ones', () => {
  const present = { a: true, b: true, c: true };
  assert.deepEqual(plain(CH.apps.mergeChosen(['x', 'a', 'y', 'b'], ['a', 'b', 'c'], present, 3)), ['a', 'b', 'c']);
  assert.deepEqual(plain(CH.apps.mergeChosen(['x', 'a', 'y', 'b'], ['a', 'b', 'c'], present, 4)), ['x', 'a', 'b', 'c']);
});

test('migrateIds moves saved ids to the id the TV lists now, and dedupes', () => {
  const entries = CH.apps.normalize([
    { id: '5b8c3eb16b.BeamCTVDev', name: 'Max', show: true },
    { id: 'com.samsung.tv.cobalt-yt', name: 'YouTube', show: true },
    { id: 'org.tizen.netflix-app', name: 'Netflix', show: true }
  ], CH.catalog);
  assert.deepEqual(plain(CH.apps.migrateIds(['cj37Ni3qXM.HBONow', '9Ur5IzDKqV.TizenYouTube', 'org.tizen.netflix-app', 'gone.App'], entries, CH.catalog)),
    ['5b8c3eb16b.BeamCTVDev', 'com.samsung.tv.cobalt-yt', 'org.tizen.netflix-app', 'gone.App']);
  assert.equal(CH.apps.migrateIds(['org.tizen.netflix-app'], entries, CH.catalog), null, 'null when nothing changes');
  assert.deepEqual(plain(CH.apps.migrateIds(['cj37Ni3qXM.HBONow', '5b8c3eb16b.BeamCTVDev'], entries, CH.catalog)), ['5b8c3eb16b.BeamCTVDev']);
});

test('catalogKey knows twin ids', () => {
  assert.equal(CH.apps.catalogKey('cj37Ni3qXM.HBONow', CH.catalog), 'max');
  assert.equal(CH.apps.catalogKey('nope.Nope', CH.catalog), null);
});
