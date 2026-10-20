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

// A slice of what getAppsInfo returns on a 2022 Samsung TV, including the
// noise real sets report (ids from CleanFrame and arn0-tv device logs).
export const TV_APPS = [
  { id: 'org.tizen.netflix-app', name: 'Netflix', show: true, iconPath: '/opt/usr/globalapps/org.tizen.netflix-app/shared/res/icon.png' },
  { id: 'com.samsung.tv.cobalt-yt', name: 'YouTube', show: true },
  { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', show: true, iconPath: '' },
  { id: 'org.tizen.primevideo', name: 'Prime Video', show: true },
  { id: 'org.tizen.primevideo-dummy', name: 'Prime Video', show: true },
  { id: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+', show: true },
  { id: 'MCmYXNxgcu.DisneyPlusService', name: 'Disney+', show: true },
  { id: '5b8c3eb16b.BeamCTVDev', name: 'Max', show: false },
  { id: 'com.samsung.tv.store', name: 'Apps', show: true },
  { id: 'com.samsung.tv.csfs', name: 'Smart Hub', show: false },
  { id: 'org.tizen.example.voice-service', name: 'Voice', show: true },
  { id: 'adplatform.ADPlayer', name: 'ADPlayer', show: true },
  { id: '25emanual3.emanual', name: 'e-Manual', show: true },
  { id: 'ep0000test.EpHelper', name: 'EP Helper', show: true },
  { id: 'abc123defg.WeatherNow', name: 'Weather Now', show: true },
  { id: 'hiddenapp1.Hidden', name: 'Hidden Thing', show: false },
  { id: '', name: 'Broken', show: true },
  { id: 'nameless01.App', name: '   ', show: true },
  { id: 'CleanHub01.Launcher', name: 'Clean Hub', show: true },
  { id: 'abc123defg.WeatherNow', name: 'Weather Now', show: true }
];
