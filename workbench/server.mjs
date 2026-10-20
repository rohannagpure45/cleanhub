// Serves app/ for a desktop preview, with a fake `tizen` injected before the
// app's scripts. Nothing here ships to the TV.
//   npm run dev            -> http://127.0.0.1:8777/
//   ?apps=typical|many|none|unknown   ?listFail=1   ?fail=<appId>,<appId>
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
  '.txt': 'text/plain; charset=utf-8'
};

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
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
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
