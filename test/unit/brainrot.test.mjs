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
  if (v.messages) v.messages.forEach((m) => out.push(m.text));
  if (v.contact) out.push(v.contact);
  return out;
}

test('the same seed and position always give the same video', () => {
  assert.deepEqual(plain(CH.brainrot.video(42, 3)), plain(CH.brainrot.video(42, 3)));
  assert.notDeepEqual(plain(CH.brainrot.video(42, 3)), plain(CH.brainrot.video(43, 3)));
});

test('every kind comes round in one pass down the feed, scrolling back too', () => {
  const kinds = CH.brainrot.KINDS.map((k, n) => CH.brainrot.video(7, n).kind);
  assert.deepEqual(plain(kinds), plain(CH.brainrot.KINDS));
  assert.deepEqual([...new Set(kinds)].sort(), ['aura', 'bounce', 'dvd', 'italian', 'odd', 'race', 'sand', 'sigma', 'story', 'texting']);
  assert.ok(CH.brainrot.ITALIAN.length >= 7, 'seven Italian brainrot characters');
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
      if (v.kind === 'texting') {
        assert.ok(v.contact && v.messages.length >= 6);
        assert.ok(v.messages.every((m) => m.from === 'me' || m.from === 'them'));
        v.messages.slice(1).forEach((m, i) => assert.ok(m.at > v.messages[i].at, 'messages in order'));
        assert.ok(v.messages[v.messages.length - 1].at < v.duration);
      }
      if (v.kind === 'odd') {
        assert.notEqual(v.pair[0], v.pair[1]);
        assert.ok(v.odd >= 0 && v.odd < v.cols * v.rows);
        assert.ok(v.start + 10 < v.duration, 'the reveal happens on screen');
      }
      if (v.kind === 'race') assert.equal(new Set(v.racers.map((r) => r.colour)).size, v.racers.length);
      if (v.kind === 'sand') assert.ok(v.colours.length >= 3 && v.cut > 0);
      if (v.kind === 'sigma') assert.ok(v.rule >= 1 && v.rule <= 99);
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

test('a line with no words is a pause', () => {
  const tl = CH.brainrot.timeline([{ text: 'go', dur: 1 }, { text: '', dur: 5 }, { text: 'now', dur: 1 }], 0);
  assert.equal(tl.chunks.length, 2);
  assert.equal(tl.chunks[1].words[0].at, 6);
  assert.equal(CH.brainrot.chunkAt(tl, 3), null);
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
  assert.equal(S.store.defaults().brainrotMusic, 'on', 'its music starts on');
  assert.equal(S.store.sanitize({ brainrotMusic: 'off' }).brainrotMusic, 'off');
  assert.equal(S.store.sanitize({ brainrotMusic: 'loud' }).brainrotMusic, 'on');
  const rows = S.settingRows.map((r) => r.id);
  assert.equal(rows[rows.length - 1], 'brainrot', 'the last row of Settings');
});
