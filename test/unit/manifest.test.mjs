import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, problems } from '../../scripts/build.mjs';

test('config.xml, package.json, main.js and apps.js agree on ids and version', () => {
  assert.deepEqual(problems(), []);
});

test('the manifest targets the TV it is for', () => {
  const m = manifest();
  assert.equal(m.appId, 'CleanHub01.Launcher');
  assert.ok(Number(m.requiredVersion) <= 6.5);
});
