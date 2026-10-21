// Ambient's music: every genre Settings offers is bundled, loaded and kept,
// and Shuffle plays the ticked ones in a new random order each time round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { load, memoryStorage, SCRIPTS } from './load.mjs';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const CH = load([...SCRIPTS, 'player.js']);
const html = readFileSync(APP + 'index.html', 'utf8');
const genres = Array.from(CH.genres, (g) => g.id); // an array of this realm, not the sandbox's
const plain = (v) => JSON.parse(JSON.stringify(v));

// The playlist as the TV builds it: every music/*.js that index.html loads.
function playlist() {
  const window = {};
  const context = vm.createContext({ window });
  for (const [, src] of html.matchAll(/<script src="(music\/[^"]+\.js)">/g)) {
    vm.runInContext(readFileSync(APP + src, 'utf8'), context, { filename: src });
  }
  return window.CleanHub.playlist;
}

test('any mix of genres is saved and comes back after a restart', () => {
  const mixes = [['originals', 'classical', 'piano', 'ambient'], ['piano'], [], genres];
  for (const music of mixes) {
    const storage = memoryStorage();
    assert.equal(CH.store.save(storage, Object.assign(CH.store.defaults(), { music })), true);
    assert.deepEqual(plain(CH.store.load(storage).music), music);
  }
});

test('every genre plays until some are turned off', () => {
  assert.deepEqual(plain(CH.store.defaults().music), genres);
  assert.deepEqual(plain(CH.store.sanitize({}).music), genres);
});

test('older saves become a list: All, Off or one genre', () => {
  const music = (v) => plain(CH.store.sanitize({ music: v }).music);
  assert.deepEqual(music('all'), genres);
  assert.deepEqual(music('on'), genres, 'from before there were genres');
  assert.deepEqual(music('off'), []);
  assert.deepEqual(music('piano'), ['piano']);
  assert.deepEqual(music('vintage'), ['vintage']);
});

test('a saved list keeps known genres, once each, in playing order', () => {
  const music = (v) => plain(CH.store.sanitize({ music: v }).music);
  assert.deepEqual(music(['ambient', 'piano', 'piano', 'disco', 7]), ['piano', 'ambient']);
  assert.deepEqual(music(['disco']), genres, 'nothing left that exists: play everything');
  assert.deepEqual(music(42), genres);
});

test('OK on a genre ticks or unticks it, and the row sums it up', () => {
  let s = CH.store.sanitize({ music: 'originals' });
  assert.equal(CH.store.musicLabel(s.music), 'Originals');
  for (const id of ['piano', 'ambient', 'classical']) s = CH.store.toggleGenre(s, id);
  assert.deepEqual(plain(s.music), ['originals', 'classical', 'piano', 'ambient']);
  assert.equal(CH.store.musicLabel(s.music), '4 genres');
  for (const id of ['originals', 'classical', 'piano', 'ambient']) s = CH.store.toggleGenre(s, id);
  assert.deepEqual(plain(s.music), []);
  assert.equal(CH.store.musicLabel(s.music), 'Off');
  assert.equal(CH.store.musicLabel(genres), 'All');
});

test('index.html loads every bundled music set', () => {
  for (const f of readdirSync(APP + 'music').filter((f) => f.endsWith('.js'))) {
    assert.ok(html.includes(`<script src="music/${f}"></script>`), `music/${f} isn't loaded by index.html`);
  }
});

test('each genre in Settings has its own tracks, and every track ships', () => {
  const list = playlist();
  for (const id of genres) {
    assert.ok(list.filter((t) => t.set === id).length >= 3, `too few tracks for '${id}'`);
  }
  for (const t of list) {
    assert.ok(existsSync(APP + 'music/' + t.file), `missing app/music/${t.file}`);
    assert.ok(t.title && t.artist && t.set, `${t.file} needs a title, an artist and a set`);
  }
  const files = new Set(list.map((t) => t.file));
  assert.equal(files.size, list.length, 'a track is listed twice');
});

test('no audio ships that no genre plays', () => {
  const files = new Set(playlist().map((t) => t.file));
  for (const id of genres) {
    if (!existsSync(APP + 'music/' + id)) continue;
    for (const f of readdirSync(APP + 'music/' + id).filter((f) => f.endsWith('.m4a'))) {
      assert.ok(files.has(`${id}/${f}`), `app/music/${id}/${f} isn't in the playlist`);
    }
  }
});

// ---- Shuffle --------------------------------------------------------------------

// A repeatable stand-in for Math.random (mulberry32).
function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const tracks = Array.from({ length: 22 }, (_, i) => ({ file: `t${i}.m4a` }));
const files = (list) => Array.from(list, (t) => t.file);

test('Shuffle is on until it is turned off', () => {
  assert.equal(CH.store.defaults().shuffle, 'on');
  assert.equal(CH.store.sanitize({ shuffle: 'off' }).shuffle, 'off');
  assert.equal(CH.store.sanitize({ shuffle: 'sideways' }).shuffle, 'on');
});

test('a shuffle plays every ticked track once, in a different order each time', () => {
  const a = files(CH.player.shuffled(tracks, null, null, seeded(1)));
  const b = files(CH.player.shuffled(tracks, null, null, seeded(2)));
  assert.deepEqual([...a].sort(), files(tracks).sort());
  assert.notDeepEqual(a, files(tracks), 'not the list order');
  assert.notDeepEqual(a, b, 'a new order each time');
});

test('a resumed track leads the shuffle, and a new round never repeats the last track', () => {
  for (let s = 0; s < 50; s++) {
    assert.equal(CH.player.shuffled(tracks, tracks[9], null, seeded(s))[0].file, 't9.m4a');
  }
  for (let s = 0; s < 200; s++) {
    const last = tracks[s % tracks.length];
    const next = files(CH.player.shuffled(tracks, null, last, seeded(s)));
    assert.notEqual(next[0], last.file);
    assert.equal(new Set(next).size, tracks.length);
  }
});
