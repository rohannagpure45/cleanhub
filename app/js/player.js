// The Ambient screen's music: the bundled playlist (music/playlist.js) on a
// loop through one <audio> element (Samsung's documented pattern: switch src
// on 'ended'). A watchdog moves on if playback ever stalls, since it runs all day.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  const p = {
    list: [],
    index: 0,
    audio: null,
    wanted: false, // the viewer wants music (survives the app being hidden)
    blocked: false, // the browser refused to start without a key press
    errors: 0, // failed tracks in a row
    onChange: null,
    retry: null,
    watch: null,
    lastTime: -1
  };

  const WATCH_MS = 30000;

  // Every 30 s while music should be playing: if the position hasn't moved,
  // skip to the next track.
  function watchdog() {
    root.clearTimeout(p.watch);
    p.watch = root.setTimeout(function () {
      const a = p.audio;
      if (!p.wanted || !a || a.paused) return;
      if (a.currentTime === p.lastTime) {
        step(1);
      } else {
        p.lastTime = a.currentTime;
      }
      watchdog();
    }, WATCH_MS);
  }

  function notify() {
    if (p.onChange) p.onChange(state());
  }

  function state() {
    return {
      track: p.list[p.index] || null,
      index: p.index,
      count: p.list.length,
      playing: !!(p.audio && !p.audio.paused && p.wanted),
      wanted: p.wanted,
      blocked: p.blocked,
      broken: p.list.length > 0 && p.errors >= p.list.length
    };
  }

  function audio() {
    if (p.audio) return p.audio;
    const a = new root.Audio();
    a.preload = 'auto';
    a.addEventListener('ended', function () { step(1); });
    a.addEventListener('playing', function () {
      p.errors = 0;
      p.blocked = false;
      p.lastTime = -1;
      notify();
    });
    a.addEventListener('pause', notify);
    // A file that won't play is skipped; if none will, stop trying.
    a.addEventListener('error', function () {
      p.errors++;
      notify();
      if (p.errors < p.list.length && p.wanted) {
        root.clearTimeout(p.retry);
        p.retry = root.setTimeout(function () { step(1); }, 1500);
      }
    });
    p.audio = a;
    return a;
  }

  function load(index) {
    const n = p.list.length;
    p.index = ((index % n) + n) % n;
    audio().src = 'music/' + p.list[p.index].file;
    notify();
  }

  function play() {
    if (!p.list.length) return;
    p.wanted = true;
    const a = audio();
    if (!a.src) load(p.index);
    const started = a.play();
    watchdog();
    if (started && typeof started.catch === 'function') {
      started.catch(function (e) {
        // Autoplay refused (desktop browsers want a key press first).
        if (e && e.name === 'NotAllowedError') {
          p.blocked = true;
          notify();
        }
      });
    }
  }

  function pause() {
    p.wanted = false;
    root.clearTimeout(p.watch);
    if (p.audio) p.audio.pause();
    notify();
  }

  function step(dir) {
    if (!p.list.length) return;
    load(p.index + dir);
    if (p.wanted) play();
  }

  // Previous restarts the current track first, like any music player.
  function previous() {
    if (p.audio && p.audio.currentTime > 5) {
      p.audio.currentTime = 0;
      if (p.wanted) play();
      return;
    }
    step(-1);
  }

  CH.player = {
    init: function (list, startIndex, onChange) {
      p.list = Array.isArray(list) ? list.filter(function (t) { return t && t.file; }) : [];
      p.index = p.list.length ? Math.max(0, Math.min(p.list.length - 1, startIndex || 0)) : 0;
      p.onChange = onChange;
    },
    play: play,
    pause: pause,
    toggle: function () {
      if (p.wanted && !p.blocked) pause();
      else play();
    },
    next: function () { step(1); },
    previous: previous,
    // The app went to the background: stop sound but remember the wish.
    suspend: function () {
      root.clearTimeout(p.retry);
      root.clearTimeout(p.watch);
      if (p.audio) p.audio.pause();
    },
    resume: function () {
      if (p.wanted) play();
    },
    state: state
  };
})(typeof window !== 'undefined' ? window : globalThis);
