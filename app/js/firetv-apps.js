// Apps on the Fire TV Stick that get their own item on Home, after Fire TV:
// [{ name: 'StbEmu', package: 'com.mvas.stb.emu.pro' }]. Empty here on
// purpose: `python3 scripts/tv.py firetv add` keeps your list in ~/.cleanhub,
// and `tv.py package` writes it into the build, once the stick is paired.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};
  CH.fireTvApps = [];
})(typeof window !== 'undefined' ? window : globalThis);
