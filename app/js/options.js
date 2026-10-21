// Every choice the settings screen offers. CSS keys off the ids
// (data-theme, data-font, data-layout, data-focus, data-icons, data-brainrot on <html>).
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
    // 'dark' ones are almost all black (low power on a local-dimming TV),
    // from Lamp to night scenes lit by one light; scenes are full colour;
    // Rotate shows the scenes in turn.
    wallpaper: [
      { id: 'lamp', name: 'Lamp', kind: 'dark' },
      { id: 'midnight', name: 'Midnight', kind: 'dark' },
      { id: 'streetlamp', name: 'Street Lamp', kind: 'dark' },
      { id: 'moonrise', name: 'Moonrise', kind: 'dark' },
      { id: 'lighthouse', name: 'Lighthouse', kind: 'dark' },
      { id: 'fireflies', name: 'Fireflies', kind: 'dark' },
      { id: 'black', name: 'Black', kind: 'dark' },
      { id: 'sunset', name: 'Sunset', kind: 'scene' },
      { id: 'coast', name: 'Coast', kind: 'scene' },
      { id: 'dunes', name: 'Dunes', kind: 'scene' },
      { id: 'aurora', name: 'Aurora', kind: 'scene' },
      { id: 'rain', name: 'City Rain', kind: 'scene' },
      { id: 'rotate', name: 'Rotate', kind: 'rotate' }
    ],
    // Moving layers (js/walls.js), or the still pictures.
    motion: [
      { id: 'on', name: 'On' },
      { id: 'off', name: 'Off' }
    ],
    input: [
      { id: 'off', name: 'Off' },
      { id: 'hdmi1', name: 'HDMI 1' },
      { id: 'hdmi2', name: 'HDMI 2' },
      { id: 'hdmi3', name: 'HDMI 3' },
      { id: 'hdmi4', name: 'HDMI 4' }
    ],
    // How Fire TV on Home shows the stick: in Samsung's TV viewer (the remote
    // reaches the stick over HDMI-CEC; Home opens the Smart Hub), or inside
    // Clean Hub (Home comes back to Clean Hub; arrows, OK, Back and play/pause
    // reach the stick over the network). Inside needs Home button: Clean Hub.
    firetvView: [
      { id: 'tv', name: 'TV input' },
      { id: 'hub', name: 'In Clean Hub' }
    ],
    // What the remote's Home button opens: Clean Hub (service/home.js brings
    // it back over Samsung's Smart Hub) or Samsung's own Home.
    home: [
      { id: 'cleanhub', name: 'Clean Hub' },
      { id: 'samsung', name: 'Samsung Home' }
    ],
    brainrot: [
      { id: 'off', name: 'Off' },
      { id: 'on', name: 'On' }
    ],
    // Brainrot mode's soundtrack, under the reels' own sound. Switched with ◀
    // in the feed, so it has no row of its own.
    brainrotMusic: [
      { id: 'on', name: 'On' },
      { id: 'off', name: 'Off' }
    ],
    // Ambient music's order: a new random one each time round, or the
    // genres' own. Ticked in the Ambient music sheet, so no row of its own.
    shuffle: [
      { id: 'on', name: 'On' },
      { id: 'off', name: 'Off' }
    ]
  };

  // Ambient's music, ticked on or off in Settings → Ambient music (any mix;
  // none = silent). Each id is a set of bundled tracks (track.set):
  // music/playlist.js, music/vintage.js and music/<id>.js. Ticked genres
  // play in this order.
  CH.genres = [
    { id: 'originals', name: 'Originals', note: 'Clean Hub Trio jazz' },
    { id: 'vintage', name: '1920s', note: 'Dance bands and blues, 1919–25' },
    { id: 'classical', name: 'Classical', note: 'Bach, Vivaldi, Mozart, Grieg, Dvořák' },
    { id: 'piano', name: 'Piano', note: 'Satie, Chopin, Bach, Beethoven' },
    { id: 'ragtime', name: 'Ragtime', note: 'Joplin and friends' },
    { id: 'bigband', name: 'Big band', note: 'Airmen of Note, 1920s orchestras' },
    { id: 'ambient', name: 'Ambient', note: 'Slow pads and drones' }
  ];

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
    { id: 'motion', label: 'Wallpaper motion' },
    { id: 'music', kind: 'action', label: 'Ambient music' },
    { id: 'input', label: 'Fire TV on Home' },
    { id: 'firetvView', label: 'Fire TV picture' },
    { id: 'home', label: 'Home button' },
    { id: 'samsung', kind: 'action', label: 'Open Samsung Home' },
    { id: 'reset', kind: 'action', label: 'Reset to defaults' },
    { id: 'brainrot', label: 'Brainrot mode' } // Ambient becomes a TikTok-style feed
  ];
})(typeof window !== 'undefined' ? window : globalThis);
