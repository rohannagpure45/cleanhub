// Fails if the shipped app uses syntax, APIs or CSS the TV's browser engine
// may not have. Baseline is Chromium 76 (Tizen 6.0) so the app also runs on
// the slightly newer engine in Tizen 6.5; see README "Browser baseline".
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const problems = [];

function files(dir, ext) {
  return readdirSync(join(APP, dir)).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scan(file, text, rules) {
  for (const [re, why] of rules) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      problems.push(`${file}:${lineOf(text, m.index)}  ${why}  (${m[0].trim()})`);
    }
  }
}

// Strip comments so prose doesn't trip the API and CSS rules.
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

const JS_APIS = [
  [/\.replaceAll\s*\(/g, 'String.replaceAll needs Chromium 85'],
  [/\.at\s*\(\s*-?\d/g, 'Array/String .at() needs Chromium 92'],
  [/\.findLast(Index)?\s*\(/g, 'findLast needs Chromium 97'],
  [/\bstructuredClone\s*\(/g, 'structuredClone needs Chromium 98'],
  [/\bObject\.hasOwn\s*\(/g, 'Object.hasOwn needs Chromium 93'],
  [/\bPromise\.any\s*\(/g, 'Promise.any needs Chromium 85'],
  [/\bimport\s*\(/g, 'dynamic import is unreliable from file:// on the TV'],
  [/\bWeakRef\b/g, 'WeakRef needs Chromium 84']
];

for (const file of files('js', '.js')) {
  const text = readFileSync(join(APP, file), 'utf8');
  try {
    acorn.parse(text, { ecmaVersion: 2017, sourceType: 'script' });
  } catch (e) {
    problems.push(`${file}:${e.loc ? e.loc.line : '?'}  syntax newer than ES2017: ${e.message}`);
  }
  scan(file, stripJs(text), JS_APIS);
}

// The Fire TV service runs in the TV's Node.js 12 runtime, not the page, so
// it gets Node 12's syntax (ES2019) and no browser APIs.
for (const file of files('service', '.js')) {
  try {
    acorn.parse(readFileSync(join(APP, file), 'utf8'), { ecmaVersion: 2019, sourceType: 'script' });
  } catch (e) {
    problems.push(`${file}:${e.loc ? e.loc.line : '?'}  syntax newer than Node 12 (ES2019): ${e.message}`);
  }
}

const CSS_RULES = [
  [/\baspect-ratio\s*:/g, 'aspect-ratio needs Chromium 88'],
  [/(^|[;{\s])inset\s*:/g, 'inset needs Chromium 87'],
  [/(^|[;{\s])(row-|column-)?gap\s*:/g, 'flex gap needs Chromium 84; use margins'],
  [/:focus-visible/g, ':focus-visible needs Chromium 86'],
  [/:(is|where|has)\(/g, ':is/:where/:has need Chromium 88+'],
  [/\b(clamp|min|max)\(/g, 'CSS min()/max()/clamp() need Chromium 79'],
  [/backdrop-filter/g, 'live backdrop blur is too slow on the TV; use the pre-blurred images'],
  [/\b(color-mix|oklch|oklab|lab|lch)\(/g, 'modern color functions need Chromium 111+'],
  [/@(container|layer)\b/g, '@container/@layer need Chromium 99+'],
  [/\b\d+(\.\d+)?(dvh|svh|lvh|dvw|svw|lvw)\b/g, 'dynamic viewport units need Chromium 108'],
  [/(^|[;{\s])(translate|scale|rotate)\s*:/g, 'individual transform properties need Chromium 104'],
  [/overflow(-[xy])?\s*:\s*clip/g, 'overflow: clip needs Chromium 90'],
  [/content-visibility/g, 'content-visibility needs Chromium 85'],
  [/^\s*&/gm, 'CSS nesting needs Chromium 112']
];

for (const file of files('css', '.css')) {
  scan(file, stripCss(readFileSync(join(APP, file), 'utf8')), CSS_RULES);
}

const html = readFileSync(join(APP, 'index.html'), 'utf8');
scan('index.html', html, [
  [/type\s*=\s*["']module["']/g, 'module scripts do not load from file:// on the TV'],
  [/<script[^>]+src\s*=\s*["']https?:/g, 'the app must work offline; no remote scripts'],
  [/<link[^>]+href\s*=\s*["']https?:/g, 'the app must work offline; no remote styles']
]);

if (problems.length) {
  console.error('Compatibility check failed:\n' + problems.map((p) => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('Compatibility check passed (ES2017 syntax, Chromium 76 CSS/APIs, offline; Node 12 service).');
