// Clean Hub's Home watcher: makes the remote's Home button come back to Clean
// Hub instead of Samsung's Smart Hub.
//
// Samsung keeps the Home key for itself (apps can't register it), so this
// does the next best thing. When the app on screen (Clean Hub, or an app the
// TV can report on) goes to the background and nothing explains it, Home must
// have opened the Smart Hub, and the watcher brings Clean Hub straight back.
// What explains a hide instead:
//   - Clean Hub said it was leaving: it opened an app or an input, the viewer
//     asked for Samsung Home, or it is closing;
//   - the TV is turning off;
//   - an AirPlay session started;
//   - another app the TV reports on is now on screen;
//   - Clean Hub came back only moments ago (Home pressed again, or something
//     insisting on the screen), so it lets that one go.
// Every check is time the Smart Hub stays on screen, so they're quick (0.4 s
// at most) and only ask about the few apps running. The TV reports an app on
// screen up to a second late, so one that took the screen (the remote's
// Netflix button) may only show after Clean Hub is back: for a few seconds
// after a bring-back the watcher keeps looking, and gives the screen back.
//
// It runs in the TV's background service runtime (Node.js 12). The page talks
// to it over the 'home' message port (platform.js, tellHome), or starts it
// with an app control carrying the same command. The TV also starts it at
// boot (config.xml, on-boot), so it remembers the Home setting in a small
// file in the app's data folder. Which app is on screen comes from the TV's
// own REST API on 127.0.0.1:8001, the one phone remotes use, about a second
// late. It knows Clean Hub and store apps (some by their Samsung Apps number),
// but not system apps such as the Smart Hub or the TV viewer, so Home over an
// HDMI input can't be seen from here.
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const UI_APP = 'CleanHub01.Launcher';
const PORT = 'home'; // the page listens on a port of the same name
const LOCAL = '127.0.0.1';
const REST_PORT = 8001;
const AIRPLAY_PORT = 7000;
const AIRPLAY_RECEIVING = 0x20000; // statusFlags bit 17, ReceiverSessionIsActive (Apple's)
const SLOW = 'slow'; // a request that got no answer in time (not a refusal)

const TICK_MS = 250; // how often the watcher looks at what it must
const FOLLOW_MS = 500; // how often the app being followed is asked about (it's on all evening)
const QUICK_MS = 400; // the checks before bringing Clean Hub back wait no longer
const SEEK_MS = 1000; // after Clean Hub opens an app, how often running apps are checked for it
const SCAN_MS = 3000; // ...and with nothing to follow
const SWEEP_SEEK_MS = 4000; // every known app is checked this often while looking for one
const SWEEP_MS = 30000; // ...and otherwise (it finds apps that started running)
const AGAIN_MS = 3000; // hidden again this soon after coming back: let it go
const GIVE_BACK_MS = 3000; // after a bring-back, an app seen on screen this soon wanted it
const AIRPLAY_POLL_MS = 1000; // how often AirPlay's status is looked at, quietly
const VOUCH_MS = 3000; // how often the TV is asked whether Clean Hub really is on screen
const AIRPLAY_RECENT_MS = 5000; // AirPlay seen starting this recently explains a hide
const BACK_MS = 5000; // Clean Hub asking "was that you?" this soon after: yes
const PASS_MS = 20000; // how long the page's "I'm leaving" covers a hide
const CLOSING_MS = 5000; // the page is closing: its hide just before isn't Home
// The Fire TV picture: the stick claims the TV twice, a second or so apart.
// Coming back after the first at once, the second pushes Clean Hub aside
// again (a second flicker); this long later, it lands on the TV viewer.
const SETTLE_MS = 1500;
const REQUEST_MS = 1500;
const RESCAN_MS = 30 * 60 * 1000; // the REST API's apps are listed again this often
const RETRY_MS = 60 * 1000; // ...or this soon after the TV wouldn't list its apps
const PARALLEL = 4; // requests at once when going through every app (the API is slow)
const LOG_SIZE = 200;
const REPORT_SIZE = 60;

// Store apps the REST API knows only by their Samsung Apps number (Netflix and
// Prime Video don't answer to the ids getAppsInfo gives them). Only installed
// ones answer, so the list can be generous.
const STORE_IDS = [
  '3201907018807', // Netflix
  '111299001912', // YouTube
  '3201910019365', // Prime Video
  '3201901017640', // Disney+
  '3202301029760', // HBO Max
  '3201601007625', // Hulu
  '3201807016597', // Apple TV
  '3201606009684', // Spotify
  '3201504001965', // Tubi
  '3202006020991', // Peacock
  '3201707014489', // YouTube TV
  '3201710014981', // Paramount+
  '3201512006963', // Plex
  '3201808016802', // Pluto TV
  '3201703012079', // Sling
  '3201906018693', // Crunchyroll
  '3201708014618', // ESPN
  '3201908019041', // Apple Music
  '3201905018355', // Amazon Music
  '3202203026841', // Twitch
  '3201710015037' // Gallery
];

// "Spotify - Music and Podcasts" and "Spotify" are the same app to a person.
function simpleName(name) {
  return String(name || '').toLowerCase().split(/\s[-–:(]\s?/)[0].replace(/[^a-z0-9+]/g, '');
}

// Runs `fn` over `items`, `limit` at a time.
function eachLimited(items, limit, fn) {
  const queue = items.slice();
  function worker() {
    const item = queue.shift();
    if (item === undefined) return Promise.resolve();
    return Promise.resolve(fn(item)).then(worker, worker);
  }
  const workers = [];
  for (let i = 0; i < limit; i++) workers.push(worker());
  return Promise.all(workers);
}

// The decisions, with everything that touches the TV passed in as `io`:
//   now(), rest(path, timeoutMs) -> Promise<object|null>,
//   airplayFlags(timeoutMs) -> Promise<number|null|'slow'>, appsInfo() -> Promise<[{ id, name }]>,
//   bounce() -> Promise, launch(appId) -> Promise, tell(key, value), sleep(ms) -> Promise,
//   loadOn() -> true | false | null (never saved), saveOn(boolean), keepLog(entries),
//   oldLog() -> entries from the last run.
function createWatcher(io) {
  const log = io.oldLog().slice(-LOG_SIZE / 2);
  let enabled = false;
  let known = {}; // REST id -> name, for every app the REST API answers for
  let installed = []; // getAppsInfo's [{ id, name }], for launching an app back
  let knownAt = -Infinity;
  let rescanning = null;
  let running = {}; // REST ids last reported running: where to look first
  let follow = null; // { id, seen }: the app expected on screen; null when none can be seen
  let pass = null; // { until, to }: a hide the page announced
  let backAt = -Infinity; // when Clean Hub was last brought back
  let giveBackUntil = -Infinity; // looking for an app that wanted the screen until then
  let insistUntil = -Infinity; // Clean Hub expects to be pushed aside till then: always bring it back
  let lastFollow = -Infinity;
  let pageHidden = false; // Clean Hub's latest word: hidden (and not announced)
  let lastVouch = -Infinity;
  let doubts = 0; // checks in a row the TV said Clean Hub wasn't on screen
  let pending = false; // a hide came in while deciding: think again after
  let lastRun = null; // the page's start and its last message number, so a
  let lastSeq = -1; // message the TV hands over twice counts once
  let airplayIdle = null; // AirPlay's statusFlags with nothing playing
  let airplaySeenAt = -Infinity; // when AirPlay was last seen starting up
  let lastAirplay = -Infinity;
  let deciding = false;
  let checking = false;
  let lastScan = -Infinity;
  let lastSweep = -Infinity;

  function note(ev, extra) {
    log.push(Object.assign({ t: io.now(), ev: ev }, extra || {}));
    if (log.length > LOG_SIZE) log.shift();
    io.keepLog(log);
  }

  function state() {
    return {
      enabled: enabled,
      follow: follow,
      pass: pass,
      known: Object.keys(known).length,
      running: Object.keys(running),
      log: log.slice()
    };
  }

  // On or off, as the page says; remembered for when the TV starts the
  // watcher on its own.
  function setEnabled(on) {
    if (on === enabled) return;
    enabled = on;
    io.saveOn(on);
    if (on && !Object.keys(known).length) rescan();
  }

  // true or false, or null when the API didn't answer (which says nothing).
  function visibleOf(id, timeoutMs) {
    return io.rest('/api/v2/applications/' + encodeURIComponent(id), timeoutMs).then(function (r) {
      if (!r || typeof r.visible !== 'boolean') return null;
      if (r.running) running[id] = true;
      else delete running[id];
      return r.visible;
    }, function () { return null; });
  }

  // Asks the REST API about every installed app and the store numbers above;
  // the ones it answers for are the apps whose comings and goings show.
  function rescan() {
    if (rescanning) return rescanning;
    rescanning = io.appsInfo().then(function (apps) {
      installed = apps;
      const ids = apps.map(function (a) { return a.id; }).filter(function (id) { return id && id !== UI_APP; });
      const found = {};
      const now = {};
      return eachLimited(ids.concat(STORE_IDS.filter(function (id) { return ids.indexOf(id) === -1; })), PARALLEL,
        function (id) {
          return io.rest('/api/v2/applications/' + encodeURIComponent(id)).then(function (r) {
            if (!r || typeof r.visible !== 'boolean') return;
            found[id] = r.name || id;
            if (r.running) now[id] = true;
          });
        }).then(function () {
        known = found;
        running = now;
        knownAt = io.now();
        note('known', { count: Object.keys(found).length, running: Object.keys(now).length });
      });
    }).catch(function (e) {
      knownAt = io.now() - RESCAN_MS + RETRY_MS;
      note('known-failed', { err: String(e && e.message) });
    }).then(function () {
      rescanning = null;
    });
    return rescanning;
  }

  // The REST id for an app Clean Hub opens: its own id if the API knows it,
  // else the store app of the same name (org.tizen.netflix-app is Netflix,
  // 3201907018807), else null.
  function restIdFor(id, name) {
    if (known[id]) return id;
    const want = simpleName(name);
    if (!want) return null;
    const ids = Object.keys(known);
    for (let i = 0; i < ids.length; i++) {
      if (simpleName(known[ids[i]]) === want) return ids[i];
    }
    return null;
  }

  // The first of `ids` on screen, or null.
  function firstVisible(ids, timeoutMs) {
    let hit = null;
    return eachLimited(ids, PARALLEL, function (id) {
      if (hit) return null;
      return visibleOf(id, timeoutMs).then(function (v) {
        if (v && !hit) hit = id;
      });
    }).then(function () { return hit; });
  }

  // Looks for a known app on screen: among the running ones (and `also`), or
  // every known app (`all`, slower). Never Clean Hub, nor `except`.
  function look(all, also, except, timeoutMs) {
    const ids = all ? Object.keys(known) : Object.keys(running);
    if (also && ids.indexOf(also) === -1) ids.unshift(also);
    return firstVisible(ids.filter(function (id) { return id !== UI_APP && id !== except; }), timeoutMs);
  }

  // The id to launch for a REST id: itself if installed under it, else the
  // installed app of the same name (3201907018807 is org.tizen.netflix-app).
  function appIdFor(restId) {
    for (let i = 0; i < installed.length; i++) if (installed[i].id === restId) return restId;
    const want = simpleName(known[restId]);
    for (let i = 0; i < installed.length; i++) {
      if (want && simpleName(installed[i].name) === want) return installed[i].id;
    }
    return null;
  }

  // true (on), false (going to standby), null (no quick answer: counts as on).
  function powerOn() {
    return io.rest('/api/v2/', QUICK_MS).then(function (r) {
      const p = r && r.device && r.device.PowerState;
      return typeof p === 'string' ? p === 'on' : null;
    }, function () { return null; });
  }

  function airplayFlags() {
    return io.airplayFlags(QUICK_MS).then(function (f) { return typeof f === 'number' || f === SLOW ? f : null; },
      function () { return null; });
  }

  // AirPlay starting up: its status flags differ from when nothing plays (on
  // the QN85B, 0x244 becomes 0xA44 for a second or two while a phone
  // connects; during playback they read as idle again, but by then the
  // watcher has let it be). Checked at the hide and, as the receiver can be
  // too busy to answer then, every second before it.
  function airplayFlagsStarting(f) {
    if (typeof f !== 'number') return false;
    return (f & AIRPLAY_RECEIVING) !== 0 || (airplayIdle !== null && f !== airplayIdle);
  }

  function airplayStarting(f) {
    if (airplayFlagsStarting(f)) airplaySeenAt = io.now();
    return io.now() - airplaySeenAt < AIRPLAY_RECENT_MS;
  }

  function pollAirplay() {
    const now = io.now();
    if (now - lastAirplay < AIRPLAY_POLL_MS) return;
    lastAirplay = now;
    io.airplayFlags(QUICK_MS).then(function (f) {
      if (airplayFlagsStarting(f)) airplaySeenAt = io.now();
    }, function () {});
  }

  // What AirPlay says with Clean Hub on screen counts as idle.
  function learnAirplay() {
    airplayFlags().then(function (f) {
      if (typeof f === 'number' && (f & AIRPLAY_RECEIVING) === 0) airplayIdle = f;
    });
  }

  function passing() {
    return !!pass && io.now() < pass.until;
  }

  // The app being followed left the screen ('left'), or Clean Hub was hidden
  // without saying why ('hidden'): Home, unless something explains it.
  function decide(why) {
    if (!enabled) return Promise.resolve();
    if (deciding) {
      if (why === 'hidden') pending = true;
      return Promise.resolve();
    }
    if (passing()) {
      note('pass', { why: why, to: pass.to });
      return Promise.resolve();
    }
    const since = io.now() - backAt;
    if (since < AGAIN_MS && io.now() >= insistUntil) {
      follow = null;
      note('again', { why: why, ms: since });
      return Promise.resolve();
    }
    deciding = true;
    const was = follow && follow.id;
    const settle = why === 'hidden' && io.now() < insistUntil ? SETTLE_MS : 0;
    let t0;
    return io.sleep(settle).then(function () {
      // Back on screen meanwhile (the TV viewer let go): nothing to do.
      if (why === 'hidden' && !pageHidden) return [true, null, null, true];
      t0 = io.now();
      return Promise.all([powerOn(), airplayFlags(), look(false, null, was, QUICK_MS)]);
    }).then(function (r) {
      if (r[3]) {
        note('came-back', { settle: settle });
        return null;
      }
      const checks = { why: why, from: was, ms: io.now() - t0, power: r[0], airplay: r[1] };
      if (settle) checks.settle = settle;
      if (!enabled || passing()) {
        note('pass', checks);
        return null;
      }
      if (r[0] === false) {
        follow = null;
        note('tv-off', checks);
        return null;
      }
      if (airplayStarting(r[1])) {
        follow = null;
        note('airplay', checks);
        return null;
      }
      if (r[2]) {
        follow = { id: r[2], seen: true };
        note('switched', Object.assign(checks, { to: r[2] }));
        return null;
      }
      note('home', checks);
      bounce();
      return null;
    }).then(done, function (e) {
      note('decide-failed', { err: String(e && e.message) });
      done();
    });
    // A hide that came in meanwhile, and still stands, gets its own look.
    function done() {
      deciding = false;
      if (!pending) return null;
      pending = false;
      return pageHidden ? decide('hidden') : null;
    }
  }

  // The launch's own answer can take a second or two; the watcher doesn't
  // wait for it (a hide meanwhile must still be heard).
  function bounce() {
    backAt = io.now();
    giveBackUntil = backAt + GIVE_BACK_MS;
    follow = { id: UI_APP, seen: false };
    io.bounce().then(function () {
      note('back', { ms: io.now() - backAt });
    }, function (e) {
      note('back-failed', { err: String(e && e.message) });
    });
  }

  // An app turned out to have been on screen as Clean Hub came back (the TV
  // says so late): it wanted the screen, so it gets it back.
  function giveBack(restId) {
    giveBackUntil = -Infinity;
    const appId = appIdFor(restId);
    if (!appId) {
      note('no-give-back', { id: restId });
      return Promise.resolve();
    }
    pass = { until: io.now() + PASS_MS, to: 'app' };
    follow = { id: restId, seen: true };
    note('give-back', { id: restId, app: appId, ms: io.now() - backAt });
    return io.launch(appId).then(function () {}, function (e) {
      note('give-back-failed', { err: String(e && e.message) });
    });
  }

  function found(id) {
    if (!id || (follow && follow.seen)) return;
    follow = { id: id, seen: true };
    pass = null; // whatever Clean Hub opened is on screen: that leave is over
    note('found', { id: id });
  }

  // Checks on the app being followed. Until one is on screen, looks for it:
  // the app Clean Hub opened may hand over to another (its YouTube tile opens
  // Samsung's own YouTube player), and an app opened from Samsung Home is
  // followed too. Clean Hub itself is left to the page, which knows at once
  // when it's hidden.
  function tick() {
    if (!enabled) return Promise.resolve();
    pollAirplay();
    if (checking || deciding) return Promise.resolve();
    const now = io.now();
    if (now - knownAt > RESCAN_MS) rescan();
    if (follow && follow.id === UI_APP) {
      if (now < giveBackUntil && now - lastFollow >= FOLLOW_MS) {
        lastFollow = now;
        checking = true;
        return look(false, null, null, QUICK_MS).then(function (id) {
          checking = false;
          if (id && now < giveBackUntil) return giveBack(id);
          return null;
        }, function () { checking = false; });
      }
      // Brought back, but it never showed (something kept the screen).
      if (!follow.seen && now - backAt > AGAIN_MS) {
        follow = null;
        note('not-back');
        return Promise.resolve();
      }
      // Clean Hub's word is all the watcher has here, and a word can go
      // missing (once after the TV woke up, its "hidden" never came): now and
      // then the TV is asked too. Twice "not on screen", and the watcher stops
      // taking it on trust and looks for what is.
      if (!follow.seen || now - lastVouch < VOUCH_MS) return Promise.resolve();
      lastVouch = now;
      checking = true;
      const f = follow;
      return visibleOf(UI_APP).then(function (v) {
        checking = false;
        if (follow !== f || v !== false) {
          doubts = 0;
          return;
        }
        doubts++;
        if (doubts < 2) return;
        doubts = 0;
        follow = null;
        pageHidden = true;
        note('missed-hide');
      }, function () { checking = false; });
    }
    if (!follow || !follow.seen) {
      if (follow && !passing()) {
        note('lost', { id: follow.id });
        follow = null;
      }
      const seeking = passing();
      const all = now - lastSweep >= (seeking ? SWEEP_SEEK_MS : SWEEP_MS);
      if (!all && now - lastScan < (seeking ? SEEK_MS : SCAN_MS)) return Promise.resolve();
      lastScan = now;
      if (all) lastSweep = now;
      checking = true;
      return look(all, follow && follow.id).then(function (id) {
        checking = false;
        found(id);
      }, function () { checking = false; });
    }
    if (now - lastFollow < FOLLOW_MS) return Promise.resolve();
    lastFollow = now;
    checking = true;
    const f = follow;
    return visibleOf(f.id).then(function (visible) {
      checking = false;
      if (follow !== f || visible !== false) return null;
      return decide('left');
    }, function () { checking = false; });
  }

  // A command from the page: { do: 'watch', on } | { do: 'shown', ask } | { do: 'hidden' } |
  // { do: 'leaving', to: 'app' | 'input' | 'samsung', id, name } | { do: 'closing' } |
  // { do: 'picture', ms } |
  // { do: 'report' }; or { do: 'wake' } when the TV started the watcher itself.
  function command(cmd) {
    if (!cmd || typeof cmd !== 'object') return Promise.resolve();
    // The TV can hand over the newest app control in place of an older one,
    // and then the same one twice: numbered, the repeat is dropped.
    if (cmd.run !== undefined && typeof cmd.seq === 'number') {
      if (cmd.run !== lastRun) {
        lastRun = cmd.run;
        lastSeq = -1;
      }
      if (cmd.seq <= lastSeq) return Promise.resolve();
      lastSeq = cmd.seq;
    }
    // `at`: when the page saw it (same clock), to time the trip here.
    if (cmd.do !== 'report') note('cmd', { do: cmd.do, to: cmd.to, id: cmd.id, lag: cmd.at ? io.now() - cmd.at : undefined });
    if (cmd.do === 'watch') {
      setEnabled(!!cmd.on);
      return Promise.resolve();
    }
    if (cmd.do === 'report') {
      // The recent part only: a message port won't carry a big one.
      io.tell('report', Object.assign(state(), { log: log.slice(-REPORT_SIZE) }));
      return Promise.resolve();
    }
    if (cmd.do === 'wake') {
      // Not from the page: the last choice it made stands (on, if it never said).
      if (!enabled && io.loadOn() !== false) {
        enabled = true;
        rescan();
      }
      return Promise.resolve();
    }
    if (cmd.do === 'closing') {
      pageHidden = true;
      pass = { until: io.now() + CLOSING_MS, to: 'closing' };
      follow = null;
      return Promise.resolve();
    }
    // The page only says anything else while the Home setting is Clean Hub.
    setEnabled(true);
    if (cmd.do === 'shown') {
      pageHidden = false;
      doubts = 0;
      lastVouch = io.now(); // the TV lags a second: don't ask it straight away
      pass = null;
      follow = { id: UI_APP, seen: true };
      learnAirplay();
      // Clean Hub is back after a hide it didn't announce: it shows Home if
      // that was the watcher answering Home (not, say, the TV waking up).
      if (cmd.ask && io.now() - backAt < BACK_MS) io.tell('back', { ms: io.now() - backAt });
    } else if (cmd.do === 'hidden') {
      pageHidden = true;
      return decide('hidden');
    } else if (cmd.do === 'picture') {
      // The Fire TV picture: the stick will take the TV over HDMI-CEC in a
      // moment, and Clean Hub must come back even right after a bring-back.
      insistUntil = io.now() + Math.min(Number(cmd.ms) || 0, 10000);
    } else if (cmd.do === 'leaving') {
      pass = { until: io.now() + PASS_MS, to: String(cmd.to || '') };
      const id = cmd.to === 'app' && cmd.id ? restIdFor(String(cmd.id), cmd.name) : null;
      follow = id ? { id: id, seen: false } : null;
      lastScan = -Infinity;
    }
    return Promise.resolve();
  }

  return { command: command, tick: tick, rescan: rescan, state: state };
}

// ---- The TV ------------------------------------------------------------------

function get(port, path, binary, timeoutMs) {
  return new Promise(function (resolve) {
    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }
    const req = http.request({ host: LOCAL, port: port, path: path, method: 'GET', agent: false,
      headers: { Connection: 'close' } }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { finish(res.statusCode === 200 ? Buffer.concat(chunks) : null); });
      res.on('error', function () { finish(null); });
    });
    const timer = setTimeout(function () {
      finish(SLOW);
      req.abort();
    }, timeoutMs || REQUEST_MS);
    req.on('error', function () { finish(null); });
    req.end();
  }).then(function (body) {
    if (body === SLOW || !body || binary) return body;
    try {
      return JSON.parse(body.toString('utf8'));
    } catch (e) {
      return null;
    }
  });
}

// One integer value from a binary property list (the AirPlay receiver's /info),
// by key in its top-level dictionary; null if it isn't there.
function plistInt(buf, key) {
  if (!buf || buf.length < 40 || buf.toString('latin1', 0, 8) !== 'bplist00') return null;
  const trailer = buf.length - 32;
  const offSize = buf[trailer + 6];
  const refSize = buf[trailer + 7];
  const count = buf.readUInt32BE(trailer + 12);
  const top = buf.readUInt32BE(trailer + 20);
  const table = buf.readUInt32BE(trailer + 28);
  function offset(ref) {
    return ref < count ? buf.readUIntBE(table + ref * offSize, offSize) : -1;
  }
  // An object's length field: in the marker's low nibble, or a following int.
  function sized(at) {
    const low = buf[at] & 0x0f;
    if (low !== 0x0f) return { n: low, start: at + 1 };
    const bytes = 1 << (buf[at + 1] & 0x0f);
    return { n: readInt(at + 2, bytes), start: at + 2 + bytes };
  }
  function readInt(at, bytes) {
    if (bytes <= 4) return buf.readUIntBE(at, bytes);
    return buf.readUInt32BE(at + bytes - 8) * 4294967296 + buf.readUInt32BE(at + bytes - 4);
  }
  function string(ref) {
    const at = offset(ref);
    if (at < 0) return null;
    const kind = buf[at] >> 4;
    const s = sized(at);
    if (kind === 0x5) return buf.toString('latin1', s.start, s.start + s.n);
    if (kind === 0x6) return Buffer.from(buf.slice(s.start, s.start + s.n * 2)).swap16().toString('utf16le');
    return null;
  }
  const at = offset(top);
  if (at < 0 || buf[at] >> 4 !== 0xd) return null;
  const d = sized(at);
  for (let i = 0; i < d.n; i++) {
    if (string(buf.readUIntBE(d.start + i * refSize, refSize)) !== key) continue;
    const v = offset(buf.readUIntBE(d.start + (d.n + i) * refSize, refSize));
    if (v < 0 || buf[v] >> 4 !== 0x1) return null;
    return readInt(v + 1, 1 << (buf[v] & 0x0f));
  }
  return null;
}

// Where the Home setting (and the decision log) are kept: the package's data
// folder, else the temporary folder (lost at boot, which then counts as never
// saved).
function storeDirs() {
  const pkg = UI_APP.split('.')[0];
  return [
    path.join('/opt/usr/home/owner/apps_rw', pkg, 'data'),
    path.join(os.homedir(), 'apps_rw', pkg, 'data'),
    os.tmpdir()
  ];
}

let storeUsed = null; // the folder that took the last write, for reports
let logTimer = null;

function readStore(name) {
  const dirs = storeDirs();
  for (let i = 0; i < dirs.length; i++) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dirs[i], name), 'utf8'));
    } catch (e) {
      // Not there, or not readable: try the next.
    }
  }
  return null;
}

function writeStore(name, value) {
  const dirs = storeDirs();
  for (let i = 0; i < dirs.length; i++) {
    try {
      fs.writeFileSync(path.join(dirs[i], name), JSON.stringify(value));
      storeUsed = dirs[i];
      return;
    } catch (e) {
      // Not writable here: try the next.
    }
  }
  storeUsed = 'nowhere';
}

function tvIo() {
  return {
    now: function () { return Date.now(); },
    loadOn: function () {
      const saved = readStore('cleanhub-home.json');
      return saved && typeof saved.on === 'boolean' ? saved.on : null;
    },
    saveOn: function (on) {
      writeStore('cleanhub-home.json', { on: on });
    },
    rest: function (path, timeoutMs) {
      return get(REST_PORT, path, false, timeoutMs).then(function (r) { return r === SLOW ? null : r; });
    },
    airplayFlags: function (timeoutMs) {
      return get(AIRPLAY_PORT, '/info', true, timeoutMs).then(function (buf) {
        return buf === SLOW ? SLOW : plistInt(buf, 'statusFlags');
      });
    },
    appsInfo: function () {
      return new Promise(function (resolve, reject) {
        tizen.application.getAppsInfo(function (infos) {
          resolve((infos || []).map(function (i) { return { id: i.id, name: i.name }; }));
        }, function (e) { reject(new Error(e && e.message)); });
      });
    },
    launch: function (appId) {
      return new Promise(function (resolve, reject) {
        try {
          tizen.application.launch(appId, resolve, function (e) { reject(new Error(e && e.message)); });
        } catch (e) {
          reject(e);
        }
      });
    },
    sleep: function (ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    },
    // Brings Clean Hub to the front: a plain launch, the quickest way.
    bounce: function () {
      return new Promise(function (resolve, reject) {
        try {
          tizen.application.launch(UI_APP, resolve, function (e) { reject(new Error(e && e.message)); });
        } catch (e) {
          reject(e);
        }
      });
    },
    // The decision log survives the TV stopping the watcher (it does, under
    // memory pressure), for tv-inspect.mjs. Written at most once a second.
    keepLog: function (entries) {
      if (logTimer) return;
      logTimer = setTimeout(function () {
        logTimer = null;
        writeStore('cleanhub-home-log.json', entries);
      }, 1000);
    },
    oldLog: function () {
      const entries = readStore('cleanhub-home-log.json');
      return Array.isArray(entries) ? entries.concat([{ t: Date.now(), ev: 'restart' }]) : [];
    },
    tell: function (key, value) {
      if (key === 'report') value = Object.assign({ store: storeUsed }, value);
      try {
        tizen.messageport.requestRemoteMessagePort(UI_APP, PORT)
          .sendMessage([{ key: key, value: JSON.stringify(value) }]);
      } catch (e) {
        // Clean Hub isn't running; nobody to tell.
      }
    }
  };
}

// ---- Tizen service hooks -----------------------------------------------------

let watcher = null;
let timer = null;
let listening = false;

function parse(text) {
  try {
    return JSON.parse(String(text));
  } catch (e) {
    return null;
  }
}

function requested() {
  try {
    const req = tizen.application.getCurrentApplication().getRequestedAppControl();
    const data = (req && req.appControl && req.appControl.data) || [];
    for (let i = 0; i < data.length; i++) {
      if (data[i].key === 'cmd' && data[i].value && data[i].value[0]) return parse(data[i].value[0]);
    }
  } catch (e) {
    // Started without a command.
  }
  return null;
}

function start() {
  if (watcher) return;
  watcher = createWatcher(tvIo());
  timer = setInterval(function () { watcher.tick(); }, TICK_MS);
}

function stop() {
  clearInterval(timer);
  try {
    tizen.application.getCurrentApplication().exit();
  } catch (e) {
    process.exit(0);
  }
}

function handle(cmd) {
  if (!cmd) return;
  start();
  watcher.command(cmd);
  // Off: nothing to do until the page says otherwise (and starts it again).
  if (!watcher.state().enabled) setTimeout(stop, 100);
}

function listen() {
  if (listening) return;
  listening = true;
  try {
    tizen.messageport.requestLocalMessagePort(PORT).addMessagePortListener(function (data) {
      (data || []).forEach(function (d) {
        if (d.key === 'cmd') handle(parse(d.value));
      });
    });
  } catch (e) {
    listening = false;
  }
}

module.exports.onStart = function () {
  listen();
  start();
};

// Started by the page with a command, or by the TV at boot without one.

module.exports.onRequest = function () {
  listen();
  handle(requested() || { do: 'wake' });
};

module.exports.onStop = function () {
  clearInterval(timer);
};

// For test/unit/home-service.test.mjs.
module.exports.createWatcher = createWatcher;
module.exports.plistInt = plistInt;
module.exports.simpleName = simpleName;
module.exports.AGAIN_MS = AGAIN_MS;
module.exports.PASS_MS = PASS_MS;
module.exports.BACK_MS = BACK_MS;
module.exports.GIVE_BACK_MS = GIVE_BACK_MS;
module.exports.SETTLE_MS = SETTLE_MS;
module.exports.SEEK_MS = SEEK_MS;
module.exports.SWEEP_MS = SWEEP_MS;
module.exports.CLOSING_MS = CLOSING_MS;
module.exports.SCAN_MS = SCAN_MS;
