// D-pad focus arithmetic, kept apart from the DOM so it can be tested.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  // Moves an index by delta within [0, count). Clamps at the ends: wrapping
  // on a TV makes the viewer lose their place.
  function step(index, count, delta) {
    if (count <= 0) return 0;
    const next = index + delta;
    if (next < 0) return 0;
    if (next >= count) return count - 1;
    return next;
  }

  // Which arrow keys move focus forward/back for each home layout.
  const AXES = {
    list: { prev: 'up', next: 'down' },
    dock: { prev: 'left', next: 'right' }
  };

  function delta(layout, dir) {
    const axis = AXES[layout] || AXES.list;
    if (dir === axis.prev) return -1;
    if (dir === axis.next) return 1;
    return 0;
  }

  CH.focus = { step: step, delta: delta };
})(typeof window !== 'undefined' ? window : globalThis);
