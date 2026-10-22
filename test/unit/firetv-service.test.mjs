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

// The service's Tizen hooks against a stand-in TV: `data()` is the app
// control the TV hands over ([{ key, value: [string] }]); the result has what
// the service told the page. The repository has no pairing (config.json), so
// every request answers 'unpaired' without touching the network.
function fakeTv(data) {
  const told = [];
  globalThis.tizen = {
    application: {
      getCurrentApplication: () => ({
        getRequestedAppControl: () => ({ appControl: { data: data() } }),
        exit: () => {}
      })
    },
    messageport: {
      requestRemoteMessagePort: () => ({ sendMessage: (d) => d.forEach((m) => told.push(JSON.parse(m.value))) })
    }
  };
  return told;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('an app to open that came with a key, in place of its own app control, opens once, and the key goes too', async () => {
  let data = [
    { key: 'key', value: [JSON.stringify({ name: 'up', run: 7, seq: 2 })] },
    { key: 'package', value: [PKG] },
    { key: 'request', value: ['7-1'] }
  ];
  const told = fakeTv(() => data);
  try {
    service.onRequest(); // the TV hands the service the newest app control...
    service.onRequest(); // ...twice, in place of the open request sent just before
    await settle();
    assert.deepEqual(told.filter((t) => t.package), [{ package: PKG, request: '7-1', state: 'unpaired', detail: 'no pairing in this build' }]);
    assert.deepEqual(told.filter((t) => t.kind === 'key'), [{ kind: 'key', state: 'unpaired' }]);
    data = [{ key: 'package', value: [PKG] }, { key: 'request', value: ['7-3'] }]; // a new request
    service.onRequest();
    await settle();
    assert.equal(told.filter((t) => t.package).length, 2);
  } finally {
    service.onStop();
    delete globalThis.tizen;
  }
});

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

// ---- Remote keys (Fire TV picture in Clean Hub) ------------------------------

// A stick answering keys from a script (the last answer repeats), each
// answer released by the test, so ordering and queueing show.
function keyStick({ answers = [{ status: 200 }], wake = [{ status: 201 }] } = {}) {
  const log = [];
  const told = [];
  const waiting = [];
  const next = (list) => (list.length > 1 ? list.shift() : list[0]);
  const io = {
    now: () => Date.now(),
    key: (host, token, name) => new Promise((resolve, reject) => {
      log.push(`key ${name}`);
      const a = next(answers);
      waiting.push(() => (a instanceof Error ? reject(a) : resolve(a)));
    }),
    wake: () => {
      log.push('wake');
      const a = next(wake);
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    }
  };
  const tick = () => new Promise((r) => setImmediate(r));
  // Answers the key in flight (if any), then lets the next one start.
  const answer = async () => {
    await tick();
    if (waiting.length) waiting.shift()();
    await tick();
    await tick();
  };
  return { io, log, told, answer, report: (r) => told.push(r.state) };
}

test('keys go to the stick one at a time, in the order pressed', async () => {
  const stick = keyStick();
  const keys = service.createKeys(stick.io, PAIRED, stick.report);
  keys.press('down');
  keys.press('down');
  keys.press('ok');
  await stick.answer();
  assert.deepEqual(stick.log, ['key down', 'key down'], 'the second waits for the first');
  await stick.answer();
  await stick.answer();
  assert.deepEqual(stick.log, ['key down', 'key down', 'key ok']);
  assert.deepEqual(stick.told, []);
});

test('a held arrow doesn\'t pile up: keys beyond a few waiting are dropped, oldest first', async () => {
  const stick = keyStick();
  const keys = service.createKeys(stick.io, PAIRED, stick.report);
  for (let i = 0; i < 8; i++) keys.press(i < 7 ? 'right' : 'ok');
  for (let i = 0; i < 5; i++) await stick.answer();
  assert.equal(stick.log.length, 1 + service.KEY_QUEUE, 'the one in flight, then the newest few');
  assert.equal(stick.log.at(-1), 'key ok', 'the last key pressed still goes');
});

test('a stick that stopped answering is woken and the key sent again; the page hears', async () => {
  const stick = keyStick({ answers: [new Error('no answer in 1500 ms'), { status: 200 }] });
  const keys = service.createKeys(stick.io, PAIRED, stick.report);
  keys.press('up');
  await stick.answer();
  await stick.answer();
  assert.deepEqual(stick.log, ['key up', 'wake', 'key up']);
  assert.deepEqual(stick.told, ['woke'], 'it may take the TV\'s screen now (HDMI-CEC)');
});

test('a stick that can\'t be reached is reported, and waiting keys are dropped', async () => {
  const stick = keyStick({ answers: [new Error('connect EHOSTUNREACH')], wake: [new Error('connect EHOSTUNREACH')] });
  const keys = service.createKeys(stick.io, PAIRED, stick.report);
  keys.press('up');
  keys.press('down');
  await stick.answer();
  await stick.answer();
  assert.deepEqual(stick.told, ['unreachable']);
  assert.deepEqual(stick.log, ['key up', 'wake']);
});

test('a refused token stops the keys and says the pairing is gone', async () => {
  const stick = keyStick({ answers: [{ status: 403 }] });
  const keys = service.createKeys(stick.io, PAIRED, stick.report);
  keys.press('ok');
  keys.press('back');
  await stick.answer();
  assert.deepEqual(stick.told, ['unpaired']);
  assert.deepEqual(stick.log, ['key ok']);
});

test('without a pairing, or for a key the stick has no use for, nothing is sent', async () => {
  const stick = keyStick();
  service.createKeys(stick.io, null, stick.report).press('ok');
  service.createKeys(stick.io, PAIRED, stick.report).press('volume_up');
  assert.deepEqual(stick.log, []);
  assert.deepEqual(stick.told, ['unpaired']);
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

test('each key\'s trip is timed: to the service, and on to the stick', async () => {
  const stick = keyStick();
  const keys = service.createKeys(stick.io, PAIRED, stick.report);
  keys.press('ok', Date.now() - 40);
  await stick.answer();
  const [t] = keys.timings();
  assert.equal(t.name, 'ok');
  assert.ok(t.wait >= 40, String(t.wait));
  assert.equal(t.result, 'sent');
  assert.equal(typeof t.ms, 'number');
});

test('keys reuse one connection to the stick, and a failure drops it', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const sockets = new Set();
  let fail = false;
  const api = https.createServer(selfSigned(), (req, res) => {
    if (fail) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"description":"OK"}');
  });
  api.on('secureConnection', (s) => sockets.add(s));
  const port = await listen(api);
  try {
    const io = service.transport({ api: port });
    for (const name of ['up', 'down', 'ok']) assert.equal((await io.key('127.0.0.1', 'Tok3n', name)).status, 200);
    assert.equal(sockets.size, 1, 'one TLS connection for three keys');
    fail = true;
    await assert.rejects(io.key('127.0.0.1', 'Tok3n', 'back'));
    fail = false;
    assert.equal((await io.key('127.0.0.1', 'Tok3n', 'back')).status, 200);
    assert.equal(sockets.size, 2, 'a fresh connection after the failure');
  } finally {
    api.close();
  }
});
