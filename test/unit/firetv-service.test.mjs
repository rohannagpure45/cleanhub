// The Fire TV service (app/service/firetv.js): its retry logic against a fake
// stick, and its real HTTP/HTTPS calls against local stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import http from 'node:http';
import https from 'node:https';

// The TV runs the service as a CommonJS module (the .wgt has no package.json
// saying otherwise); this repo's package.json would make Node read it as ESM.
function loadService() {
  const file = fileURLToPath(new URL('../../app/service/firetv.js', import.meta.url));
  const module = { exports: {} };
  const wrapped = vm.runInThisContext('(function (module, exports, require) {' + readFileSync(file, 'utf8') + '\n})',
    { filename: file });
  wrapped(module, module.exports, createRequire(file));
  return module.exports;
}

const service = loadService();

const PAIRED = { host: '10.0.0.5', token: 'Tok3n' };
const PKG = 'com.mvas.stb.emu.pro';

// A stick that answers from a script: wake/launch answers are taken in
// order (the last one repeats); an Error is thrown, anything else returned.
function fakeStick({ wake = [{ status: 201 }], launch = [{ status: 200 }], found = null } = {}) {
  let clock = 0;
  const log = [];
  const next = (list) => (list.length > 1 ? list.shift() : list[0]);
  const answer = (a) => (a instanceof Error ? Promise.reject(a) : Promise.resolve(a));
  return {
    log,
    io: {
      now: () => clock,
      sleep: (ms) => { clock += ms; log.push('sleep'); return Promise.resolve(); },
      wake: (host) => { clock += 100; log.push('wake ' + host); return answer(next(wake)); },
      launch: (host, token, pkg) => { clock += 100; log.push(`launch ${host} ${token} ${pkg}`); return answer(next(launch)); },
      discover: () => { log.push('discover'); return Promise.resolve(found); }
    }
  };
}

test('opens the app on the first try when the stick is awake', async () => {
  const stick = fakeStick();
  assert.deepEqual(await service.openApp(PKG, PAIRED, stick.io), { state: 'opened', host: '10.0.0.5' });
  assert.deepEqual(stick.log, ['wake 10.0.0.5', `launch 10.0.0.5 Tok3n ${PKG}`]);
});

test('keeps asking while a sleeping stick starts up', async () => {
  const slow = new Error('no answer in 4000 ms');
  const stick = fakeStick({ launch: [slow, slow, { status: 503 }, { status: 200 }] });
  const result = await service.openApp(PKG, PAIRED, stick.io);
  assert.equal(result.state, 'opened');
  assert.equal(stick.log.filter((l) => l.startsWith('launch')).length, 4);
  assert.equal(stick.log.filter((l) => l.startsWith('wake')).length, 4, 'wakes the remote service before each try');
});

test('a refused token means the pairing is gone; no point retrying', async () => {
  const stick = fakeStick({ launch: [{ status: 403, body: '{"description":"Request unauthorized"}' }] });
  const result = await service.openApp(PKG, PAIRED, stick.io);
  assert.equal(result.state, 'unpaired');
  assert.equal(stick.log.filter((l) => l.startsWith('launch')).length, 1);
});

test('a build without a pairing answers unpaired without touching the network', async () => {
  const stick = fakeStick();
  assert.equal((await service.openApp(PKG, null, stick.io)).state, 'unpaired');
  assert.equal((await service.openApp(PKG, { host: '10.0.0.5' }, stick.io)).state, 'unpaired');
  assert.deepEqual(stick.log, []);
});

test('a package name that could reach another API path is refused', async () => {
  const stick = fakeStick();
  for (const bad of ['../FireTV?action=home', 'com.x/../../v1', 'nodots', '']) {
    assert.equal((await service.openApp(bad, PAIRED, stick.io)).state, 'unreachable', bad);
  }
  assert.deepEqual(stick.log, []);
});

test('if the saved address is dead, finds the stick on the network once and uses it', async () => {
  const gone = Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
  const stick = fakeStick({ found: '10.0.0.9' });
  stick.io.wake = (host) => {
    stick.log.push('wake ' + host);
    return host === '10.0.0.5' ? Promise.reject(gone) : Promise.resolve({ status: 201 });
  };
  const result = await service.openApp(PKG, PAIRED, stick.io);
  assert.deepEqual(result, { state: 'opened', host: '10.0.0.9' });
  assert.deepEqual(stick.log, ['wake 10.0.0.5', 'discover', 'wake 10.0.0.9', `launch 10.0.0.9 Tok3n ${PKG}`]);
});

test('gives up at the deadline and says why', async () => {
  const stick = fakeStick({ wake: [new Error('connect ECONNREFUSED')] });
  const result = await service.openApp(PKG, PAIRED, stick.io);
  assert.equal(result.state, 'unreachable');
  assert.match(result.detail, /ECONNREFUSED/);
  assert.equal(stick.log.filter((l) => l === 'discover').length, 1, 'searches only once');
  assert.ok(stick.io.now() <= service.DEADLINE_MS + 1000, 'stops near the deadline');
});

// ---- Real requests -------------------------------------------------------------

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// A throwaway self-signed certificate, like the stick's (which no TV trusts).
function selfSigned() {
  const dir = mkdtempSync(join(tmpdir(), 'cleanhub-firetv-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-days', '1', '-subj', '/O=Aralink', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')],
  { stdio: 'ignore' });
  return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}

let hasOpenssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch (e) {
  hasOpenssl = false;
}

test('talks to the stick the way the Fire TV app does', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const seen = [];
  const dial = http.createServer((req, res) => {
    seen.push(`dial ${req.method} ${req.url}`);
    res.writeHead(201);
    res.end();
  });
  const api = https.createServer(selfSigned(), (req, res) => {
    seen.push(`api ${req.method} ${req.url} key=${req.headers['x-api-key']} token=${req.headers['x-client-token']}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"description":"OK"}');
  });
  const ports = { dial: await listen(dial), api: await listen(api) };
  try {
    const io = service.transport(ports);
    const result = await service.openApp(PKG, { host: '127.0.0.1', token: 'Tok3n' }, io);
    assert.deepEqual(result, { state: 'opened', host: '127.0.0.1' });
    assert.deepEqual(seen, [
      'dial POST /apps/FireTVRemote',
      `api POST /v1/FireTV/app/${PKG} key=0987654321 token=Tok3n`
    ]);
  } finally {
    dial.close();
    api.close();
  }
});

test('a stick that accepts the connection but never answers times out', async () => {
  const sockets = [];
  const silent = http.createServer(() => {}); // holds every request open, as the hung stick did
  silent.on('connection', (s) => sockets.push(s));
  const port = await listen(silent);
  try {
    const started = Date.now();
    await assert.rejects(service.transport({ dial: port }).wake('127.0.0.1'), /no answer/);
    assert.ok(Date.now() - started < 3500, 'gives up after about 2 s');
  } finally {
    sockets.forEach((s) => s.destroy());
    silent.close();
  }
});
