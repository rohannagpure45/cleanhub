// Every choice the settings screen offers. CSS keys off the ids
// (data-theme, data-font, data-layout, data-focus, data-icons on <html>).
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  CH.options = {
    layout: [
      { id: 'list', name: 'List' },
      { id: 'dock', name: 'Dock' }
    ],
    theme: [
      { id: 'dusk', name: 'Dusk' },
      { id: 'tide', name: 'Tide' },
      { id: 'ember', name: 'Ember' },
      { id: 'night', name: 'Night' },
      { id: 'paper', name: 'Paper' }
    ],
    font: [
      { id: 'manrope', name: 'Manrope' },
      { id: 'fraunces', name: 'Fraunces' },
      { id: 'grotesk', name: 'Space Grotesk' }
    ],
    focus: [
      { id: 'glass', name: 'Glass' },
      { id: 'type', name: 'Type' }
    ],
    icons: [
      { id: 'on', name: 'Shown' },
      { id: 'off', name: 'Text only' }
    ],
    clock: [
      { id: '12', name: '12-hour' },
      { id: '24', name: '24-hour' },
      { id: 'off', name: 'Off' }
    ],
    ambient: [
      { id: 'on', name: 'Shown' },
      { id: 'off', name: 'Hidden' }
    ],
    wallpaper: [
      { id: 'lamp', name: 'Lamp' },
      { id: 'midnight', name: 'Midnight' },
      { id: 'black', name: 'Black' }
    ],
    music: [
      { id: 'all', name: 'All' },
      { id: 'originals', name: 'Originals' },
      { id: 'vintage', name: '1920s' },
      { id: 'off', name: 'Off' }
    ],
    input: [
      { id: 'off', name: 'Off' },
      { id: 'hdmi1', name: 'HDMI 1' },
      { id: 'hdmi2', name: 'HDMI 2' },
      { id: 'hdmi3', name: 'HDMI 3' },
      { id: 'hdmi4', name: 'HDMI 4' }
    ]
  };

  // The settings sheet, top to bottom. 'action' rows open or do something;
  // the rest cycle through CH.options[id].
  CH.settingRows = [
    { id: 'apps', kind: 'action', label: 'Apps on Home' },
    { id: 'layout', label: 'Layout' },
    { id: 'theme', label: 'Background' },
    { id: 'font', label: 'Font' },
    { id: 'focus', label: 'Focus style' },
    { id: 'icons', label: 'Icons in list' },
    { id: 'clock', label: 'Clock' },
    { id: 'ambient', label: 'Ambient on Home' },
    { id: 'wallpaper', label: 'Ambient wallpaper' },
    { id: 'music', label: 'Ambient music' },
    { id: 'input', label: 'Fire TV on Home' },
    { id: 'reset', kind: 'action', label: 'Reset to defaults' }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
