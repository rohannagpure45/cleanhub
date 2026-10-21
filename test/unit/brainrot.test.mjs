import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, memoryStorage } from './load.mjs';

const CH = load(['brainrot.js']);
const plain = (v) => JSON.parse(JSON.stringify(v));
const DRAWN = ['skull', 'sob', 'fire', 'moai']; // the emoji reel.js has images for

function texts(v) {
  const out = [v.title, v.user, v.tags];
  v.timeline.chunks.forEach((c) => c.words.forEach((w) => out.push(w.text)));
  if (v.items) v.items.forEach((it) => out.push(it.text));
  return out;
}

test('the same seed and position always give the same video', () => {
  assert.deepEqual(plain(CH.brainrot.video(42, 3)), plain(CH.brainrot.video(42, 3)));
  assert.notDeepEqual(plain(CH.brainrot.video(42, 3)), plain(CH.brainrot.video(43, 3)));
});

test('every kind comes round in one pass down the feed, scrolling back too', () => {
  const kinds = CH.brainrot.KINDS.map((k, n) => CH.brainrot.video(7, n).kind);
  assert.deepEqual(plain(kinds), plain(CH.brainrot.KINDS));
  assert.deepEqual([...new Set(kinds)].sort(), ['aura', 'bounce', 'dvd', 'italian', 'story']);
  assert.equal(CH.brainrot.video(7, -1).kind, CH.brainrot.KINDS[CH.brainrot.KINDS.length - 1]);
});

test('videos are filled in: no template slots, only emoji that can be drawn, captions inside the video', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (let n = 0; n < CH.brainrot.KINDS.length; n++) {
      const v = CH.brainrot.video(seed, n);
      for (const t of texts(v)) {
        assert.ok(!/[{}]/.test(t), `unfilled slot in "${t}"`);
        for (const m of t.matchAll(/:([a-z]+):/g)) assert.ok(DRAWN.includes(m[1]), `no image for :${m[1]}:`);
      }
      assert.ok(v.timeline.chunks.length > 0);
      assert.ok(v.timeline.end < v.duration, `${v.kind}: captions run past the end`);
      assert.ok(v.likes > 0 && v.comments >= 0 && v.saves >= 0 && v.shares >= 0);
      if (v.kind === 'italian') assert.ok(CH.brainrot.ITALIAN.some((c) => c.id === v.character));
      if (v.kind === 'aura') assert.equal(v.items.length, 5);
      if (v.kind === 'dvd') assert.ok(v.corner > 0 && v.corner < v.duration);
      if (v.kind === 'bounce') assert.ok(v.rings >= 5 && v.rings <= 7);
    }
  }
});

test('captions show three words at a time, in order, and timed lines show whole', () => {
  const tl = CH.brainrot.timeline([{ text: 'one two three four five' }, { text: 'a whole line here', dur: 2 }], 1);
  assert.deepEqual(plain(tl.chunks.map((c) => c.words.map((w) => w.text).join(' '))),
    ['one two three', 'four five', 'a whole line here']);
  const at = tl.chunks.flatMap((c) => c.words.map((w) => w.at));
  assert.equal(at[0], 1);
  at.slice(1).forEach((t, i) => assert.ok(t > at[i]));
  assert.ok(Math.abs(tl.end - (1 + 5 * 0.34 + 2)) < 1e-9);
});

test('chunkAt finds the words on screen, and nothing before the first one', () => {
  const tl = CH.brainrot.timeline([{ text: 'one two three four' }], 1);
  assert.equal(CH.brainrot.chunkAt(tl, 0.5), null);
  assert.equal(CH.brainrot.chunkAt(tl, 1).index, 0);
  assert.equal(CH.brainrot.chunkAt(tl, 1 + 3 * 0.34 + 0.01).index, 1);
  assert.equal(CH.brainrot.chunkAt(tl, tl.end + 0.01), null);
});

test('counts are abbreviated like the app does', () => {
  assert.deepEqual(plain([0, 9999, 12345, 999999, 2400000, 10000000].map(CH.brainrot.count)),
    ['0', '9999', '12.3K', '999.9K', '2.4M', '10M']);
});

test('comments are filled in', () => {
  const rnd = CH.brainrot.random(5);
  for (let i = 0; i < 200; i++) {
    const c = CH.brainrot.comment(rnd);
    assert.ok(c.user && c.text && !/[{}]/.test(c.text), JSON.stringify(c));
    assert.ok(c.likes >= 0);
  }
});

test('Brainrot mode is off by default and only takes off or on', () => {
  const S = load();
  assert.equal(S.store.defaults().brainrot, 'off');
  assert.equal(S.store.sanitize({ brainrot: 'on' }).brainrot, 'on');
  assert.equal(S.store.sanitize({ brainrot: 'yes' }).brainrot, 'off');
  assert.equal(S.store.load(memoryStorage({ [S.store.KEY]: '{"brainrot":"on"}' })).brainrot, 'on');
  const rows = S.settingRows.map((r) => r.id);
  assert.equal(rows[rows.length - 1], 'brainrot', 'the last row of Settings');
});
