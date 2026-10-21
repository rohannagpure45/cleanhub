// Clean Hub's Fire TV service: opens an app on the Fire TV Stick through the
// stick's own remote-control API, the one Amazon's Fire TV phone app uses.
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

  function launch(host, token, pkg) {
    return request(https, {
      host: host, port: p.api, method: 'POST', path: '/v1/FireTV/app/' + pkg,
      rejectUnauthorized: false, // Amazon's private certificate; only ever this stick
      headers: { 'x-api-key': API_KEY, 'x-client-token': token, 'Content-Length': 0, Connection: 'close' }
    }, ATTEMPT_MS);
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

function requestedPackage() {
  try {
    const req = tizen.application.getCurrentApplication().getRequestedAppControl();
    const data = (req && req.appControl && req.appControl.data) || [];
    for (let i = 0; i < data.length; i++) {
      if (data[i].key === 'package' && data[i].value && data[i].value[0]) return String(data[i].value[0]);
    }
  } catch (e) {
    // No app control: started without a request.
  }
  return null;
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
  idleLater();
};

module.exports.onRequest = function () {
  const pkg = requestedPackage();
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
module.exports.transport = transport;
module.exports.DEADLINE_MS = DEADLINE_MS;
