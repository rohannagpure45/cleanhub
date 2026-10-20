import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const CH = load();

test('step clamps at both ends', () => {
  assert.equal(CH.focus.step(0, 5, -1), 0);
  assert.equal(CH.focus.step(4, 5, 1), 4);
  assert.equal(CH.focus.step(2, 5, 1), 3);
  assert.equal(CH.focus.step(3, 0, 1), 0);
});

test('delta maps arrows per layout', () => {
  assert.equal(CH.focus.delta('list', 'down'), 1);
  assert.equal(CH.focus.delta('list', 'up'), -1);
  assert.equal(CH.focus.delta('list', 'left'), 0);
  assert.equal(CH.focus.delta('dock', 'right'), 1);
  assert.equal(CH.focus.delta('dock', 'left'), -1);
  assert.equal(CH.focus.delta('dock', 'up'), 0);
  assert.equal(CH.focus.delta('unknown', 'down'), 1);
});
