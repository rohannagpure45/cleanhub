// Loads the shipped app scripts into a sandbox, the way the TV's index.html
// does (plain <script> tags sharing window.CleanHub).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP = fileURLToPath(new URL('../../app/js/', import.meta.url));

export const SCRIPTS = ['catalog.js', 'options.js', 'store.js', 'apps.js', 'focus.js'];

export function load(files = SCRIPTS, extra = {}) {
  const window = { ...extra };
  const context = vm.createContext({ window, console });
  for (const f of files) {
    vm.runInContext(readFileSync(APP + f, 'utf8'), context, { filename: f });
  }
  return window.CleanHub;
}

export function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

// A plausible slice of what getAppsInfo returns on a Samsung TV.
export const TV_APPS = [
  { id: 'RN1MCdNq8t.Netflix', name: 'Netflix', show: true, iconPath: '/opt/usr/apps/RN1MCdNq8t/shared/res/icon.png' },
  { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', show: true, iconPath: '' },
  { id: 'org.tizen.ignition', name: 'Prime Video', show: true },
  { id: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+', show: true },
  { id: 'cj37Ni3qXM.HBONow', name: 'Max', show: true },
  { id: 'com.samsung.tv.store', name: 'Apps', show: true },
  { id: 'com.samsung.tv.csfs', name: 'Smart Hub', show: false },
  { id: 'org.tizen.example.voice-service', name: 'Voice', show: true },
  { id: 'abc.Weather', name: 'Weather Now', show: true },
  { id: '', name: 'Broken', show: true },
  { id: 'nameless.App', name: '   ', show: true },
  { id: 'CleanHub01.Launcher', name: 'Clean Hub', show: true },
  { id: 'dup.YouTube', name: 'YouTube', show: true }
];
