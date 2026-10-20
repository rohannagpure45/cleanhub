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
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
