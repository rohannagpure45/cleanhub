// Clean Hub's Fire TV service: opens an app on the Fire TV Stick through the
// stick's own remote-control API, the one Amazon's Fire TV phone app uses, and
// passes the Samsung remote's keys on to it while Clean Hub shows the stick's
// picture itself (Settings → Fire TV picture: In Clean Hub).
//
// It runs in the TV's background service runtime (Node.js 12), not the page:
// the API is HTTPS behind Amazon's private certificate, which the page's
// browser engine refuses. The page starts it with an app control carrying the
// package to open (platform.js, openOnFireTv) and hears back on its 'firetv'
// message port. `tv.py firetv pair` writes the stick's address and the client
// token from its PIN pairing to config.json next to this file at packaging
// time; the repository never holds them.
'use strict';

const http = require('http');
const https = require('https');
const dgram = require('dgram');

const UI_APP = 'CleanHub01.Launcher';
const UI_PORT = 'firetv';
const API_KEY = '0987654321'; // the fixed key Amazon's Fire TV app sends
const API_PORT = 8080;
const DIAL_PORT = 8009;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
// A stick that was asleep when the TV switched to it takes several seconds to
// answer, so attempts repeat until this deadline.
const DEADLINE_MS = 30000;
const ATTEMPT_MS = 4000;
const WAKE_MS = 2000;
const RETRY_MS = 1000;
const SEARCH_MS = 3000;
const IDLE_EXIT_MS = 2 * 60 * 1000;
const KEY_PORT = 'firetv-key';
const KEY_MS = 1500;
const KEY_QUEUE = 3; // keys waiting beyond this are dropped, oldest first (a held arrow)

// Clean Hub's names for the remote's keys, and the API call each becomes.
const KEY_PATHS = {
  up: '/v1/FireTV?action=dpad_up',
  down: '/v1/FireTV?action=dpad_down',
  left: '/v1/FireTV?action=dpad_left',
  right: '/v1/FireTV?action=dpad_right',
  ok: '/v1/FireTV?action=select',
  back: '/v1/FireTV?action=back',
  home: '/v1/FireTV?action=home', // the stick's own Home (Back held down)
  play: '/v1/media?action=play' // play/pause
};

// One request with a deadline. Resolves { status, body }; rejects on a
// network error or the deadline. Never keeps the connection open.
function request(mod, options, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let settled = false;
    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    }
    const req = mod.request(Object.assign({ agent: false }, options), function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () { settle(resolve, { status: res.statusCode, body: body }); });
      res.on('error', function (err) { settle(reject, err); });
    });
    const timer = setTimeout(function () {
      settle(reject, new Error('no answer in ' + timeoutMs + ' ms'));
      req.abort();
    }, timeoutMs);
    req.on('error', function (err) { settle(reject, err); });
    req.end();
  });
}

// The stick's address on the network, reached on the given ports (tests point
// these at local fakes).
function transport(ports) {
  const p = Object.assign({ api: API_PORT, dial: DIAL_PORT }, ports);

  // Starts the stick's remote-control server, which sleeps until asked.
  function wake(host) {
    return request(http, {
      host: host, port: p.dial, method: 'POST', path: '/apps/FireTVRemote',
      headers: { 'Content-Length': 0, Connection: 'close' }
    }, WAKE_MS);
  }

  function post(host, token, path, timeoutMs) {
    return request(https, {
      host: host, port: p.api, method: 'POST', path: path,
      rejectUnauthorized: false, // Amazon's private certificate; only ever this stick
      headers: { 'x-api-key': API_KEY, 'x-client-token': token, 'Content-Length': 0, Connection: 'close' }
    }, timeoutMs);
  }

  function launch(host, token, pkg) {
    return post(host, token, '/v1/FireTV/app/' + pkg, ATTEMPT_MS);
  }

  // Keys go one at a time (a burst once left the stick's server hung until it
  // was restarted) over one kept-open connection: a new TLS handshake per key
  // was most of the lag. Any failure drops the connection, so a half-open one
  // can't stall the next key.
  let keyAgent = null;

  function key(host, token, name) {
    if (!keyAgent) keyAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });
    return request(https, {
      agent: keyAgent, host: host, port: p.api, method: 'POST', path: KEY_PATHS[name],
      rejectUnauthorized: false, // Amazon's private certificate; only ever this stick
      headers: { 'x-api-key': API_KEY, 'x-client-token': token, 'Content-Length': 0 }
    }, KEY_MS).catch(function (e) {
      if (keyAgent) keyAgent.destroy();
      keyAgent = null;
      throw e;
    });
  }

  // True if `host` runs a DIAL server that knows Amazon's remote-control app.
  function isFireTv(host) {
    return request(http, { host: host, port: p.dial, method: 'GET', path: '/apps/FireTVRemote' }, WAKE_MS)
      .then(function (r) { return r.status === 200; }, function () { return false; });
  }

  // Looks for a Fire TV on the network (SSDP search for DIAL devices), for
  // when the saved address stops answering. Resolves an address or null.
  function discover(timeoutMs) {
    return new Promise(function (resolve) {
      const seen = {};
      let done = false;
      let sock = null;
      function finish(found) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { sock.close(); } catch (e) { /* already closed */ }
        resolve(found || null);
      }
      const timer = setTimeout(finish, timeoutMs);
      try {
        sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sock.on('error', function () { finish(null); });
        sock.on('message', function (msg, rinfo) {
          if (seen[rinfo.address]) return;
          seen[rinfo.address] = true;
          isFireTv(rinfo.address).then(function (yes) { if (yes) finish(rinfo.address); });
        });
        sock.bind(function () {
          const search = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\n' +
            'MX: 1\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n';
          sock.send(Buffer.from(search), 1900, '239.255.255.250');
        });
      } catch (e) {
        finish(null);
      }
    });
  }

  return {
    wake: wake,
    launch: launch,
    key: key,
    discover: discover,
    now: function () { return Date.now(); },
    sleep: function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  };
}

// Opens `pkg` on the stick: wakes its remote-control server, then asks it to
// open the app, again until it answers or the deadline passes. If the saved
// address doesn't answer at all, looks for the stick once (DHCP may have moved
// it). Resolves { state: 'opened' | 'unpaired' | 'unreachable', host, detail }.
async function openApp(pkg, config, io) {
  if (!config || !config.token || !config.host) return { state: 'unpaired', detail: 'no pairing in this build' };
  if (!PACKAGE.test(pkg)) return { state: 'unreachable', detail: 'not a package name: ' + pkg };
  const until = io.now() + DEADLINE_MS;
  let host = config.host;
  let searched = false;
  let last = 'no answer';
  while (io.now() < until) {
    let awake = false;
    try {
      await io.wake(host);
      awake = true;
    } catch (e) {
      last = e.message;
    }
    if (!awake && !searched) {
      searched = true;
      const found = await io.discover(SEARCH_MS);
      if (found && found !== host) {
        host = found;
        continue;
      }
    }
    if (awake) {
      try {
        const r = await io.launch(host, config.token, pkg);
        if (r.status === 200) return { state: 'opened', host: host };
        // The stick forgot the pairing (reset, or the token was revoked).
        if (r.status === 401 || r.status === 403) return { state: 'unpaired', host: host, detail: r.body };
        last = 'HTTP ' + r.status;
      } catch (e) {
        last = e.message;
      }
    }
    if (io.now() + RETRY_MS >= until) break;
    await io.sleep(RETRY_MS);
  }
  return { state: 'unreachable', host: host, detail: last };
}

// Passes keys to the stick one at a time, in order. If it doesn't answer, its
// remote server has gone to sleep (or hung): wakes it and tries that key once
// more. Tells the page through `report` when it woke the stick (the stick may
// then take the TV's screen over HDMI-CEC) or can't reach it.
function createKeys(io, config, report) {
  let pending = []; // [{ name, at }]
  let sending = false;
  const host = config && config.host;
  const timings = []; // the last keys: how long each took to get here, and to the stick

  function timed(entry) {
    timings.push(entry);
    if (timings.length > 30) timings.shift();
  }

  function send(name) {
    return io.key(host, config.token, name).then(function (r) {
      if (r.status === 200) return 'sent';
      if (r.status === 401 || r.status === 403) return 'unpaired';
      throw new Error('HTTP ' + r.status);
    });
  }

  function next() {
    if (sending || !pending.length) return Promise.resolve();
    sending = true;
    const k = pending.shift();
    const t0 = io.now();
    const entry = { name: k.name, wait: k.at ? t0 - k.at : null };
    return send(k.name).catch(function () {
      entry.woke = true;
      return io.wake(host).then(function () {
        report({ kind: 'key', state: 'woke' });
        return send(k.name);
      });
    }).then(function (result) {
      entry.ms = io.now() - t0;
      entry.result = result;
      if (result !== 'unpaired') return;
      pending = [];
      report({ kind: 'key', state: 'unpaired' });
    }, function (e) {
      entry.ms = io.now() - t0;
      entry.result = 'unreachable';
      pending = [];
      report({ kind: 'key', state: 'unreachable', detail: String(e && e.message) });
    }).then(function () {
      timed(entry);
      sending = false;
      return next();
    });
  }

  return {
    // `at`: when the page saw the key (same clock), to time its trip here.
    press: function (name, at) {
      if (!KEY_PATHS[name]) return Promise.resolve();
      if (!config || !config.token || !host) {
        report({ kind: 'key', state: 'unpaired' });
        return Promise.resolve();
      }
      pending.push({ name: name, at: at });
      while (pending.length > KEY_QUEUE) pending.shift();
      return next();
    },
    timings: function () { return timings.slice(); },
    // Ahead of the first key: the remote server sleeps until asked.
    wake: function () {
      if (!host) return Promise.resolve();
      return io.wake(host).then(function () {}, function () {});
    }
  };
}

// ---- Tizen service hooks -----------------------------------------------------

let config = null;
try {
  config = require('./config.json');
} catch (e) {
  config = null; // built without a pairing: every request answers 'unpaired'
}
let host = config && config.host; // follows the stick if a search finds it elsewhere
let queue = Promise.resolve();
let idleTimer = null;

function tell(result) {
  try {
    const port = tizen.messageport.requestRemoteMessagePort(UI_APP, UI_PORT);
    port.sendMessage([{ key: 'result', value: JSON.stringify(result) }]);
  } catch (e) {
    // Clean Hub isn't running; nobody to tell.
  }
}

function requested(key) {
  try {
    const req = tizen.application.getCurrentApplication().getRequestedAppControl();
    const data = (req && req.appControl && req.appControl.data) || [];
    for (let i = 0; i < data.length; i++) {
      if (data[i].key === key && data[i].value && data[i].value[0]) return String(data[i].value[0]);
    }
  } catch (e) {
    // No app control: started without a request.
  }
  return null;
}

let keys = null;

// A key from the page, as { name, at } ('up', 'ok', …; 'wake' ahead of the
// first; 'report' for the timings). Keeps the service up.
let lastRun = null; // the page's start and its last key's number: the TV
let lastSeq = -1; // can hand over the same app control twice

function onKey(value) {
  let k;
  try {
    k = JSON.parse(value);
  } catch (e) {
    k = { name: value };
  }
  if (k.run !== undefined && typeof k.seq === 'number') {
    if (k.run !== lastRun) {
      lastRun = k.run;
      lastSeq = -1;
    }
    if (k.seq <= lastSeq) return;
    lastSeq = k.seq;
  }
  if (!keys) keys = createKeys(transport(), config && Object.assign({}, config, { host: host }), tell);
  idleLater();
  if (k.name === 'wake') keys.wake();
  else if (k.name === 'report') tell({ kind: 'key-report', keys: keys.timings() });
  else keys.press(k.name, k.at);
}

function listenKeys() {
  try {
    tizen.messageport.requestLocalMessagePort(KEY_PORT).addMessagePortListener(function (data) {
      (data || []).forEach(function (d) {
        if (d.key === 'key') onKey(String(d.value));
      });
    });
  } catch (e) {
    // No port: keys then arrive by app control (onRequest).
  }
}

// The service stays up between requests (a warm start is quicker), and exits
// after a while with nothing to do.
function idleLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(function () {
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) {
      process.exit(0);
    }
  }, IDLE_EXIT_MS);
}

module.exports.onStart = function () {
  listenKeys();
  idleLater();
};

module.exports.onRequest = function () {
  const key = requested('key');
  if (key) {
    onKey(key);
    return;
  }
  const pkg = requested('package');
  if (!pkg) return;
  clearTimeout(idleTimer);
  const io = transport();
  queue = queue.then(function () {
    return openApp(pkg, config && Object.assign({}, config, { host: host }), io);
  }).then(function (result) {
    if (result.host) host = result.host;
    tell(Object.assign({ package: pkg }, result));
  }, function (err) {
    tell({ package: pkg, state: 'unreachable', detail: String(err && err.message) });
  }).then(idleLater);
};

module.exports.onStop = function () {
  clearTimeout(idleTimer);
};

// For test/unit/firetv-service.test.mjs.
module.exports.openApp = openApp;
module.exports.createKeys = createKeys;
module.exports.KEY_QUEUE = KEY_QUEUE;
module.exports.transport = transport;
module.exports.DEADLINE_MS = DEADLINE_MS;
