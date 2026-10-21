// The Home watcher (app/service/home.js): when it brings Clean Hub back, and
// when it lets a hide be, against a fake TV and clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// The TV runs the service as a CommonJS module; this repo's package.json
// would make Node read it as ESM.
function loadService() {
  const file = fileURLToPath(new URL('../../app/service/home.js', import.meta.url));
  const module = { exports: {} };
  const wrapped = vm.runInThisContext('(function (module, exports, require) {' + readFileSync(file, 'utf8') + '\n})',
    { filename: file });
  wrapped(module, module.exports, createRequire(file));
  return module.exports;
}

const home = loadService();

const UI = 'CleanHub01.Launcher';
const NETFLIX = '3201907018807';
const YOUTUBE = '111299001912'; // Samsung's own YouTube player
const YOUTUBE_TILE = '9Ur5IzDKqV.TizenYouTube'; // what getAppsInfo lists, and hands over to it
const HULU = 'LBUAQX1exg.Hulu';
const IDLE_AIRPLAY = 0x244; // what the QN85B reports with nothing playing

// A TV whose REST API knows `known` (id -> name), with `visible` saying which
// app is on screen.
function fakeTv({ known = { [NETFLIX]: 'Netflix', [YOUTUBE]: 'YouTube', [YOUTUBE_TILE]: 'YouTube', [HULU]: 'Hulu',
  [UI]: 'Clean Hub' },
apps = [{ id: UI, name: 'Clean Hub' }, { id: 'org.tizen.netflix-app', name: 'Netflix' }, { id: HULU, name: 'Hulu' },
  { id: YOUTUBE_TILE, name: 'YouTube' }, { id: 'com.samsung.tv.store', name: 'Apps' }] } = {}) {
  let clock = 1000000;
  const tv = { known, visible: {}, power: 'on', airplay: IDLE_AIRPLAY, bounces: 0, told: [], asked: [], saved: null,
    silent: false, timeouts: [], launched: [], running: null };
  tv.io = {
    now: () => clock,
    loadOn: () => tv.saved,
    saveOn: (on) => { tv.saved = on; },
    rest: (path, timeoutMs) => {
      if (path === '/api/v2/') {
        tv.timeouts.push(timeoutMs);
        return Promise.resolve(tv.power === null ? null : { device: { PowerState: tv.power } });
      }
      const id = decodeURIComponent(path.replace('/api/v2/applications/', ''));
      tv.asked.push(id);
      if (timeoutMs) tv.timeouts.push(timeoutMs);
      if (tv.silent || !(id in tv.known)) return Promise.resolve(null);
      const running = tv.running ? tv.running.includes(id) : true;
      return Promise.resolve({ id, name: tv.known[id], running, visible: !!tv.visible[id] });
    },
    airplayFlags: (timeoutMs) => {
      tv.timeouts.push(timeoutMs);
      return Promise.resolve(tv.airplay);
    },
    appsInfo: () => Promise.resolve(apps),
    bounce: () => {
      tv.bounces++;
      return tv.launchHangs ? new Promise(() => {}) : Promise.resolve();
    },
    launch: (id) => {
      tv.launched.push(id);
      return Promise.resolve();
    },
    tell: (key, value) => tv.told.push([key, value]),
    sleep: (ms) => {
      clock += ms;
      tv.slept = (tv.slept || 0) + ms;
      if (ms && tv.duringSleep) tv.duringSleep();
      return Promise.resolve();
    },
    keepLog: (entries) => { tv.kept = entries.slice(); },
    oldLog: () => tv.previous || []
  };
  tv.reports = () => tv.told.filter((t) => t[0] === 'report').map((t) => t[1]);
  tv.advance = (ms) => { clock += ms; };
  tv.show = (id) => {
    tv.visible = id ? { [id]: true } : {};
  };
  return tv;
}

async function watching(tv = fakeTv()) {
  const w = home.createWatcher(tv.io);
  await w.command({ do: 'watch', on: true });
  await w.rescan();
  return w;
}

const events = (w) => w.state().log.map((e) => e.ev);

test('Home over Clean Hub: a hide nobody announced brings Clean Hub back', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  tv.show(null); // the Smart Hub, which the REST API doesn't know
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1);
  assert.ok(events(w).includes('home'));
  assert.deepEqual(w.state().follow, { id: UI, seen: false }, 'waits for Clean Hub to show again');
});

test('the apps the REST API knows come from the installed list and the store numbers', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  assert.equal(w.state().known, 4, 'Netflix and YouTube by number, Hulu and the YouTube tile by id; never Clean Hub');
  assert.ok(tv.asked.includes('com.samsung.tv.store'), 'asks about every installed app');
  assert.ok(!tv.asked.includes(UI));
});

test('Home over an app Clean Hub opened (Netflix, known only by its store number)', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'leaving', to: 'app', id: 'org.tizen.netflix-app', name: 'Netflix' });
  assert.deepEqual(w.state().follow, { id: NETFLIX, seen: false }, 'expects Netflix, by name');
  await w.tick(); // still starting
  tv.show(NETFLIX);
  tv.advance(home.SEEK_MS);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: NETFLIX, seen: true });
  assert.equal(w.state().pass, null, 'the leave is over once Netflix is up');
  tv.show(null); // Home
  tv.advance(250);
  await w.tick();
  assert.equal(tv.bounces, 1);
});

test('pressing Home twice in a row leaves Samsung Home up', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1);
  tv.advance(600);
  await w.command({ do: 'shown' });
  tv.advance(900);
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1, 'the second Home is let be');
  assert.equal(events(w).at(-1), 'again');
  // Much later, Home brings Clean Hub back again.
  tv.advance(home.AGAIN_MS + 1);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 2);
});

test('the TV turning off is not Home', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  tv.power = 'standby';
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 0);
  assert.equal(events(w).at(-1), 'tv-off');
});

test('an unreadable power state counts as on', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  tv.power = null;
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1);
});

test('an AirPlay session taking the screen is not Home', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  tv.airplay = IDLE_AIRPLAY | 0x20000; // ReceiverSessionIsActive
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 0);
  assert.equal(events(w).at(-1), 'airplay');
  assert.equal(w.state().follow, null, 'looks around until something it knows is on screen');
});

test('an app taking the screen from Clean Hub (cast from a phone, say) wins the second time, and is followed', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' }); // the app starting over Clean Hub: indistinguishable from Home
  assert.equal(tv.bounces, 1);
  tv.advance(400);
  await w.command({ do: 'shown' });
  tv.show(YOUTUBE);
  tv.advance(1200);
  await w.command({ do: 'hidden' }); // it comes to the front again
  assert.equal(tv.bounces, 1, 'let be');
  tv.advance(home.SEEK_MS);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: YOUTUBE, seen: true });
  tv.show(null);
  tv.advance(home.AGAIN_MS);
  await w.tick();
  assert.equal(tv.bounces, 2, 'and Home over it still comes back');
});

test('switching from one app straight to another (the Netflix button) is followed, not undone', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'leaving', to: 'app', id: HULU, name: 'Hulu' });
  tv.show(HULU);
  tv.advance(home.SEEK_MS);
  await w.tick();
  tv.show(NETFLIX);
  tv.advance(250);
  await w.tick();
  assert.equal(tv.bounces, 0);
  assert.deepEqual(w.state().follow, { id: NETFLIX, seen: true });
  assert.equal(w.state().log.at(-1).ev, 'switched');
});

test('YouTube\'s tile hands over to Samsung\'s own player, which is followed instead', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'leaving', to: 'app', id: YOUTUBE_TILE, name: 'YouTube' });
  assert.deepEqual(w.state().follow, { id: YOUTUBE_TILE, seen: false });
  tv.show(YOUTUBE);
  tv.advance(home.SEEK_MS);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: YOUTUBE, seen: true });
  tv.show(null);
  tv.advance(250);
  await w.tick();
  assert.equal(tv.bounces, 1);
});

test('no answer from the REST API is not taken for the app leaving', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'leaving', to: 'app', id: HULU, name: 'Hulu' });
  tv.show(HULU);
  tv.advance(home.SEEK_MS);
  await w.tick();
  tv.silent = true; // the API stalls (it can, for half a minute)
  for (let i = 0; i < 10; i++) {
    tv.advance(250);
    await w.tick();
  }
  assert.equal(tv.bounces, 0);
  assert.deepEqual(w.state().follow, { id: HULU, seen: true });
});

test('before bringing Clean Hub back it asks only about running apps, waiting at most 0.4 s on anything', async () => {
  const tv = fakeTv();
  tv.running = [NETFLIX];
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  tv.asked.length = 0;
  tv.timeouts.length = 0;
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1);
  assert.deepEqual(tv.asked, [NETFLIX], 'not every app the TV knows (that took a second)');
  assert.ok(tv.timeouts.length >= 3 && tv.timeouts.every((ms) => ms <= 400), String(tv.timeouts));
});

test('the Netflix button: Netflix is seen on screen before Clean Hub would come back, so it stays', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  tv.show(NETFLIX); // the TV already says so by the time Clean Hub's message arrives
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 0);
  assert.deepEqual(w.state().follow, { id: NETFLIX, seen: true });
  assert.equal(events(w).at(-1), 'switched');
});

test('an app the TV reports on screen only after Clean Hub came back gets the screen back', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1);
  tv.show(NETFLIX); // late: it was on screen as Clean Hub came back
  tv.advance(250);
  await w.tick();
  assert.deepEqual(tv.launched, ['org.tizen.netflix-app'], 'launched by its own id, found by name');
  assert.deepEqual(w.state().follow, { id: NETFLIX, seen: true });
  await w.command({ do: 'hidden' }); // Clean Hub, covered again
  assert.equal(tv.bounces, 1, 'that hide was expected');
});

test('an app showing up long after a bring-back is followed, not given the screen', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  tv.advance(300);
  await w.command({ do: 'shown' });
  tv.advance(home.GIVE_BACK_MS);
  tv.show(NETFLIX);
  await w.tick();
  assert.deepEqual(tv.launched, []);
});

test('AirPlay starting (flags unlike the idle ones, now or seen in the last seconds) is not Home; a slow answer alone is', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' }); // learns the idle flags (0x244)
  await new Promise((r) => setImmediate(r));
  tv.airplay = 0xa44; // as the QN85B reads while a phone connects
  await w.command({ do: 'hidden' });
  assert.equal(events(w).at(-1), 'airplay');
  // Too busy to answer at the hide, but seen connecting a moment before.
  tv.airplay = IDLE_AIRPLAY;
  tv.advance(10000);
  await w.command({ do: 'shown' });
  tv.airplay = 0xa44;
  await w.tick(); // the quiet look every second
  await new Promise((r) => setImmediate(r));
  tv.airplay = 'slow';
  tv.advance(1000);
  await w.command({ do: 'hidden' });
  assert.equal(events(w).at(-1), 'airplay');
  assert.equal(tv.bounces, 0);
  // Slow, with nothing seen: the TV is just busy (it is, around HDMI switches).
  tv.advance(10000);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1);
  tv.airplay = null; // refused (AirPlay off): says nothing either
  tv.advance(10000);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 2);
});

test('back on screen, Clean Hub asks whether that was the watcher; only a bring-back says yes', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown', ask: true }); // a fresh start
  assert.deepEqual(tv.told, []);
  await w.command({ do: 'hidden' });
  tv.advance(500);
  await w.command({ do: 'shown', ask: true });
  assert.deepEqual(tv.told.map((t) => t[0]), ['back']);
  tv.power = 'standby';
  tv.advance(home.AGAIN_MS);
  await w.command({ do: 'hidden' }); // the TV going off
  tv.advance(home.BACK_MS);
  tv.power = 'on';
  await w.command({ do: 'shown', ask: true }); // and on again, Clean Hub as it was
  assert.deepEqual(tv.told.map((t) => t[0]), ['back']);
});

test('Open Samsung Home is left alone; an app opened from there is followed', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'leaving', to: 'samsung' });
  assert.equal(w.state().follow, null);
  tv.advance(home.SCAN_MS);
  await w.tick();
  assert.equal(tv.bounces, 0);
  tv.show(HULU);
  tv.advance(home.SEEK_MS);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: HULU, seen: true });
  tv.show(null);
  tv.advance(250);
  await w.tick();
  assert.equal(tv.bounces, 1);
});

test('an input switch is a leave the watcher can\'t follow', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'leaving', to: 'input' });
  for (let i = 0; i < 20; i++) {
    tv.advance(1000);
    await w.tick();
  }
  assert.equal(tv.bounces, 0);
  assert.equal(w.state().follow, null);
});

test('an app that never shows up is let go once its leave expires', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'leaving', to: 'app', id: HULU, name: 'Hulu' });
  tv.advance(home.PASS_MS - 1);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: HULU, seen: false });
  tv.advance(2);
  await w.tick();
  assert.equal(w.state().follow, null);
  assert.equal(tv.bounces, 0);
});

test('an app it can\'t name is found by looking around', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'leaving', to: 'app', id: 'abc123defg.Mystery', name: 'Mystery' });
  assert.equal(w.state().follow, null);
  tv.show(YOUTUBE);
  tv.advance(home.SCAN_MS);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: YOUTUBE, seen: true });
});

test('a bring-back that never shows stops being waited for', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  tv.advance(home.AGAIN_MS + 1);
  await w.tick();
  assert.equal(w.state().follow, null);
  assert.equal(events(w).at(-1), 'not-back');
});

test('with the setting on Samsung Home, nothing is brought back', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'watch', on: false });
  await w.command({ do: 'report' });
  assert.equal(tv.reports().at(-1).enabled, false);
  await w.tick();
  assert.equal(tv.bounces, 0);
});

test('started by the TV at boot, it watches without being told', async () => {
  const tv = fakeTv();
  const w = home.createWatcher(tv.io);
  await w.command({ do: 'wake' });
  assert.equal(w.state().enabled, true, 'never told otherwise: on');
  await w.rescan();
  tv.show(YOUTUBE);
  tv.advance(home.SCAN_MS);
  await w.tick();
  tv.show(null);
  tv.advance(250);
  await w.tick();
  assert.equal(tv.bounces, 1);
});

test('Clean Hub itself is left to the page, which knows sooner than the REST API', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  tv.asked.length = 0;
  for (let i = 0; i < 8; i++) {
    tv.advance(250);
    await w.tick();
  }
  assert.deepEqual(tv.asked, []);
});

test('app names match across the TV\'s list and the store', () => {
  assert.equal(home.simpleName('Spotify - Music and Podcasts'), home.simpleName('Spotify'));
  assert.equal(home.simpleName('Tubi - Free Movies ＆ TV'), 'tubi');
  assert.equal(home.simpleName('Disney+'), 'disney+');
  assert.notEqual(home.simpleName('YouTube TV'), home.simpleName('YouTube'));
});

// A binary plist with one top-level dictionary, enough to stand in for the
// AirPlay receiver's /info.
function bplist(dict) {
  const objects = [];
  const add = (bytes) => objects.push(Buffer.from(bytes)) - 1;
  const str = (s) => add([0x50 | s.length, ...Buffer.from(s, 'latin1')]);
  const int = (n) => {
    if (n < 256) return add([0x10, n]);
    if (n < 4294967296) {
      const b = Buffer.alloc(5);
      b[0] = 0x12;
      b.writeUInt32BE(n, 1);
      return add(b);
    }
    const b = Buffer.alloc(9);
    b[0] = 0x13;
    b.writeUInt32BE(Math.floor(n / 4294967296), 1);
    b.writeUInt32BE(n % 4294967296, 5);
    return add(b);
  };
  const top = add([]); // filled in below
  const keys = Object.keys(dict).map(str);
  const values = Object.values(dict).map((v) => (typeof v === 'number' ? int(v) : str(v)));
  objects[top] = Buffer.from([0xd0 | keys.length, ...keys, ...values]);
  const parts = [Buffer.from('bplist00')];
  const offsets = [];
  let at = 8;
  for (const o of objects) {
    offsets.push(at);
    parts.push(o);
    at += o.length;
  }
  const table = at;
  const offTable = Buffer.alloc(offsets.length * 2);
  offsets.forEach((o, i) => offTable.writeUInt16BE(o, i * 2));
  const trailer = Buffer.alloc(32);
  trailer[6] = 2; // offset size
  trailer[7] = 1; // object reference size
  trailer.writeUInt32BE(objects.length, 12);
  trailer.writeUInt32BE(top, 20);
  trailer.writeUInt32BE(table, 28);
  return Buffer.concat([...parts, offTable, trailer]);
}

test('reads AirPlay\'s status flags from its binary property list', () => {
  const info = bplist({ name: 'Samsung QN85BD 85', features: 255525703439583952, statusFlags: 580, model: 'QBQ85D' });
  assert.equal(home.plistInt(info, 'statusFlags'), 580);
  assert.equal(home.plistInt(info, 'missing'), null);
  assert.equal(home.plistInt(info, 'name'), null, 'not an integer');
  assert.equal(home.plistInt(Buffer.from('<?xml version="1.0"?>'), 'statusFlags'), null);
  assert.equal(home.plistInt(null, 'statusFlags'), null);
});

test('the Home setting is remembered, and a start at boot keeps to it', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  assert.equal(tv.saved, true);
  await w.command({ do: 'watch', on: false });
  assert.equal(tv.saved, false);
  const atBoot = home.createWatcher(tv.io);
  await atBoot.command({ do: 'wake' });
  assert.equal(atBoot.state().enabled, false, 'Samsung Home was chosen');
  await atBoot.command({ do: 'shown' }); // the page, with the setting back on Clean Hub
  assert.equal(atBoot.state().enabled, true);
  assert.equal(tv.saved, true);
});

test('Clean Hub closing (an install, the app manager) is not Home', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'closing' });
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 0);
  // Usually the hide comes first and the closing while it's being checked.
  tv.advance(home.CLOSING_MS + 1);
  await w.command({ do: 'shown' });
  const checking = w.command({ do: 'hidden' });
  await w.command({ do: 'closing' });
  await checking;
  assert.equal(tv.bounces, 0);
});

test('the decision log is kept, and picked up again when the TV restarts the watcher', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden', at: tv.io.now() - 30 });
  assert.equal(tv.kept.at(-2).ev, 'home');
  assert.equal(tv.kept.find((e) => e.do === 'hidden').lag, 30, 'how long the page\'s message took');
  tv.previous = tv.kept.concat([{ t: tv.io.now(), ev: 'restart' }]);
  const again = home.createWatcher(tv.io);
  assert.deepEqual(again.state().log.map((e) => e.ev).slice(-3), ['home', 'back', 'restart']);
});

test('the Fire TV picture: pushed aside right after a bring-back, Clean Hub still comes back', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' }); // Home
  tv.advance(500);
  await w.command({ do: 'shown' });
  await w.command({ do: 'picture', ms: 6000 }); // the viewer opens Fire TV at once
  tv.advance(1500);
  await w.command({ do: 'hidden' }); // the stick claims the TV
  assert.equal(tv.bounces, 2, 'not taken for Home pressed twice');
  tv.advance(6000);
  await w.command({ do: 'shown' });
  tv.advance(500);
  await w.command({ do: 'hidden' });
  tv.advance(500);
  await w.command({ do: 'shown' });
  tv.advance(1000);
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 3, 'past the window, twice in a row is Samsung Home again');
});

test('an app it follows is asked about twice a second, not four times', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'leaving', to: 'app', id: HULU, name: 'Hulu' });
  tv.show(HULU);
  tv.advance(home.SEEK_MS);
  await w.tick();
  tv.asked.length = 0;
  for (let i = 0; i < 8; i++) {
    tv.advance(250);
    await w.tick();
  }
  assert.equal(tv.asked.filter((id) => id === HULU).length, 4);
});

test('a message the TV hands over twice counts once; an older one arriving late changes nothing', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown', run: 7, seq: 1 });
  await w.command({ do: 'hidden', run: 7, seq: 2 });
  await w.command({ do: 'hidden', run: 7, seq: 2 }); // the same app control, read again
  assert.equal(tv.bounces, 1);
  await w.command({ do: 'shown', run: 7, seq: 1 });
  assert.notEqual(w.state().follow && w.state().follow.seen, true, 'the stale "shown" was dropped');
  await w.command({ do: 'shown', run: 8, seq: 1 }); // Clean Hub restarted: numbering starts again
  assert.deepEqual(w.state().follow, { id: UI, seen: true });
});

test('a hide that comes in while the watcher is still deciding gets its own look', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'picture', ms: 6000 });
  const first = w.command({ do: 'hidden' }); // the stick's first claim
  w.command({ do: 'shown' }); // back...
  const second = w.command({ do: 'hidden' }); // ...and its second claim, while the first is decided
  await first;
  await second;
  await new Promise((r) => setImmediate(r));
  assert.equal(tv.bounces, 2);
});

test('the Fire TV picture: the bring-back waits for the stick\'s second claim, or not at all if Clean Hub is back', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'picture', ms: 6000 });
  await w.command({ do: 'hidden' });
  assert.equal(tv.slept, home.SETTLE_MS);
  assert.equal(tv.bounces, 1);
  tv.advance(6000);
  await w.command({ do: 'shown' });
  await w.command({ do: 'picture', ms: 6000 });
  tv.duringSleep = () => w.command({ do: 'shown' }); // the TV viewer let go by itself
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 1);
  assert.equal(events(w).at(-1), 'came-back');
  tv.duringSleep = null;
  tv.slept = 0;
  tv.advance(10000);
  await w.command({ do: 'hidden' }); // Home, outside that window: no waiting
  assert.equal(tv.slept, 0);
});

test('bringing Clean Hub back doesn\'t wait for the launch to answer (it can take seconds)', async () => {
  const tv = fakeTv();
  tv.launchHangs = true;
  const w = await watching(tv);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  tv.advance(home.AGAIN_MS + 1);
  await w.command({ do: 'shown' });
  await w.command({ do: 'hidden' });
  assert.equal(tv.bounces, 2);
});

test('Clean Hub said "shown" but its "hidden" went missing: the TV is asked now and then, and twice "not on screen" ends the trust', async () => {
  const tv = fakeTv();
  const w = await watching(tv);
  tv.show(UI);
  await w.command({ do: 'shown' });
  for (let i = 0; i < 4; i++) {
    tv.advance(3000);
    await w.tick();
  }
  assert.deepEqual(w.state().follow, { id: UI, seen: true }, 'on screen, as it said');
  tv.show(YOUTUBE); // the "hidden" never came
  tv.advance(3000);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: UI, seen: true }, 'one "no" could be the TV lagging');
  tv.advance(3000);
  await w.tick();
  assert.equal(events(w).at(-1), 'missed-hide');
  tv.advance(home.SCAN_MS);
  await w.tick();
  assert.deepEqual(w.state().follow, { id: YOUTUBE, seen: true });
  tv.show(null); // Home over YouTube
  tv.advance(500);
  await w.tick();
  assert.equal(tv.bounces, 1);
});
