// Talks to Clean Hub running on the TV through the Chrome DevTools protocol
// (the app must be launched in debug mode: `python3 scripts/tv.py debug`).
//   node scripts/tv-inspect.mjs eval '<js expression>'   -> prints the JSON result
//   node scripts/tv-inspect.mjs shot out.png             -> screenshot of the app
//   node scripts/tv-inspect.mjs key Enter|ArrowDown|...  -> sends a remote key
// Uses the endpoint saved by tv.py in ~/.cleanhub/debug.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const { host, port } = JSON.parse(readFileSync(homedir() + '/.cleanhub/debug.json', 'utf8'));
const pages = await (await fetch(`http://${host}:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page');
if (!page) throw new Error('No debuggable page; launch with tv.py debug first.');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

// Some calls never answer on the TV (Page.captureScreenshot, for one).
function send(method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => {
      pending.delete(n);
      reject(new Error(method + ' did not answer within ' + timeoutMs / 1000 + ' s'));
    }, timeoutMs);
    pending.set(n, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}

const KEYS = { Enter: 13, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Back: 10009 };
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    console.error('Exception:', r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(r.result.value, null, 2));
  }
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg || 'tv.png', Buffer.from(r.data, 'base64'));
  console.log('wrote ' + (arg || 'tv.png'));
} else if (cmd === 'key') {
  const code = KEYS[arg];
  if (!code) throw new Error('key must be one of ' + Object.keys(KEYS).join(', '));
  // Dispatch in the page, as the remote's keydown would arrive.
  await send('Runtime.evaluate', {
    expression: `document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: ${code}, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: ${code}, bubbles: true }));`
  });
  console.log('sent ' + arg);
} else {
  console.error('usage: tv-inspect.mjs eval <js> | shot <file> | key <name>');
  process.exitCode = 2;
}
ws.close();
