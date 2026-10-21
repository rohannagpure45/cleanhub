// Serves app/ for a desktop preview, with a fake `tizen` injected before the
// app's scripts. Nothing here ships to the TV.
//   npm run dev            -> http://127.0.0.1:8777/
//   ?apps=typical|many|none|unknown   ?listFail=1   ?fail=<appId>,<appId>
//   ?music=broken|none   (swaps the Ambient playlist; see playlistFor)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = join(ROOT, 'app');
const PORT = Number(process.env.PORT || 8777);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8'
};

// The page's query picks a test playlist: the playlist script's request
// carries the page URL as its Referer.
function playlistFor(req, body) {
  const ref = req.headers.referer ? new URL(req.headers.referer).searchParams.get('music') : null;
  if (ref === 'none') return body.replace(/CH\.playlist = [\s\S]*?\];/, 'CH.playlist = [];');
  if (ref === 'broken') {
    return body.replace(/CH\.playlist = [\s\S]*?\];/,
      'CH.playlist = [{ "file": "missing-1.m4a", "title": "Gone" }, { "file": "missing-2.m4a", "title": "Also gone" }];');
  }
  return body;
}

export function start(port = PORT) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    try {
      if (path === '/__workbench/mock-tizen.js') {
        res.writeHead(200, { 'content-type': TYPES['.js'] });
        res.end(await readFile(join(ROOT, 'workbench/mock-tizen.js')));
        return;
      }
      // Samsung's product API exists only on the TV; stand in for it.
      if (path === '/$WEBAPIS/webapis/webapis.js') {
        res.writeHead(200, { 'content-type': TYPES['.js'] });
        res.end(await readFile(join(ROOT, 'workbench/mock-webapis.js')));
        return;
      }
      if (path === '/frame') {
        res.writeHead(200, { 'content-type': TYPES['.html'] });
        res.end(await readFile(join(ROOT, 'workbench/frame.html')));
        return;
      }
      if (path === '/') path = '/index.html';
      const file = normalize(join(APP, path));
      if (!file.startsWith(APP)) throw Object.assign(new Error('outside app'), { code: 'ENOENT' });
      let body = await readFile(file);
      if (path === '/index.html') {
        body = String(body).replace('<script src="js/catalog.js">',
          '<script src="/__workbench/mock-tizen.js"></script>\n  <script src="js/catalog.js">');
      }
      if (path === '/music/playlist.js') body = playlistFor(req, String(body));
      const type = TYPES[extname(file)] || 'application/octet-stream';
      // Media elements ask for byte ranges.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && Buffer.isBuffer(body)) {
        const size = body.length;
        const startByte = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${startByte}-${end}/${size}`,
          'accept-ranges': 'bytes', 'content-length': end - startByte + 1, 'cache-control': 'no-store' });
        res.end(body.subarray(startByte, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes' });
      res.end(body);
    } catch (e) {
      res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' });
      res.end(e.code === 'ENOENT' ? 'Not found' : String(e));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then(() => {
    console.log(`Clean Hub workbench: http://127.0.0.1:${PORT}/frame  (raw 1920x1080: http://127.0.0.1:${PORT}/)`);
    console.log('Keys: arrows, Enter = OK, Escape/Backspace = Back.');
  });
}
