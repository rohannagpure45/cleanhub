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
    // 'dark' ones are almost all black (low power on a local-dimming TV);
    // scenes are full colour; Rotate shows the scenes in turn.
    wallpaper: [
      { id: 'lamp', name: 'Lamp', kind: 'dark' },
      { id: 'midnight', name: 'Midnight', kind: 'dark' },
      { id: 'black', name: 'Black', kind: 'dark' },
      { id: 'sunset', name: 'Sunset', kind: 'scene' },
      { id: 'coast', name: 'Coast', kind: 'scene' },
      { id: 'dunes', name: 'Dunes', kind: 'scene' },
      { id: 'aurora', name: 'Aurora', kind: 'scene' },
      { id: 'rain', name: 'City Rain', kind: 'scene' },
      { id: 'deco', name: 'Deco', kind: 'scene' },
      { id: 'rotate', name: 'Rotate', kind: 'rotate' }
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
