// The Ambient screen's music: the bundled playlist (music/playlist.js) on a
// loop through one <audio> element (Samsung's documented pattern: switch src
// on 'ended'). It runs all day, so every way it can stop is handled: a track
// that won't play is skipped, a stall is caught by a watchdog, and once no
// track will play it stops trying. Shuffled, it plays the list in a random
// order, and a new one each time round.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  const p = {
    list: [],
    index: 0,
    shuffle: false,
    audio: null,
    wanted: false, // the viewer wants music (survives the app being hidden)
    blocked: false, // the browser refused to start without a key press
    failed: {}, // files of tracks that wouldn't play since one last did
    onChange: null,
    retry: null,
    watch: null,
    lastTime: -1
  };

  // A random order of `list` (Fisher–Yates). `lead`, if given, goes first;
  // otherwise `avoid` (the track that just ended) doesn't, so a new pass
  // never repeats it.
  function shuffled(list, lead, avoid, random) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    if (lead) {
      out.splice(out.indexOf(lead), 1);
      out.unshift(lead);
    } else if (avoid && out.length > 1 && out[0].file === avoid.file) {
      const j = 1 + Math.floor(random() * (out.length - 1));
      out[0] = out[j];
      out[j] = avoid;
    }
    return out;
  }

  const WATCH_MS = 30000;
  const SKIP_MS = 1500;

  function failedCount() {
    return Object.keys(p.failed).length;
  }

  function broken() {
    return p.list.length > 0 && failedCount() >= p.list.length;
  }

  function notify() {
    if (p.onChange) p.onChange(state());
  }

  function state() {
    const a = p.audio;
    return {
      track: p.list[p.index] || null,
      index: p.index,
      count: p.list.length,
      playing: !!(a && !a.paused && !a.error && p.wanted),
      wanted: p.wanted,
      blocked: p.blocked,
      broken: broken()
    };
  }

  // Every 30 s while music should be playing. A frozen position means a
  // stall: move on. A pause nobody asked for (or a failed track the app was
  // hidden on) is restarted. Nothing to do once no track will play.
  function watchdog() {
    root.clearTimeout(p.watch);
    p.watch = root.setTimeout(function () {
      const a = p.audio;
      if (!p.wanted || !a || broken()) return;
      if (a.paused || a.error) {
        if (!p.blocked) {
          if (a.error) step(1);
          else play();
        }
        watchdog();
        return;
      }
      if (a.currentTime === p.lastTime) step(1);
      else p.lastTime = a.currentTime;
      watchdog();
    }, WATCH_MS);
  }

  function audio() {
    if (p.audio) return p.audio;
    const a = new root.Audio();
    a.preload = 'auto';
    a.addEventListener('ended', function () { step(1); });
    a.addEventListener('playing', function () {
      p.failed = {};
      p.blocked = false;
      p.lastTime = -1;
      notify();
    });
    a.addEventListener('pause', notify);
    // A file that won't play is skipped; once none will, stop trying.
    a.addEventListener('error', function () {
      const failedIndex = p.index;
      p.failed[p.list[failedIndex].file] = true; // by file: a new shuffle moves indexes
      notify();
      if (!broken() && p.wanted) {
        root.clearTimeout(p.retry);
        p.retry = root.setTimeout(function () {
          if (p.index === failedIndex && p.wanted) step(1);
        }, SKIP_MS);
      }
    });
    p.audio = a;
    return a;
  }

  function load(index) {
    const n = p.list.length;
    root.clearTimeout(p.retry); // a pending skip belonged to the old track
    p.index = ((index % n) + n) % n;
    audio().src = 'music/' + p.list[p.index].file;
    notify();
  }

  function play() {
    if (!p.list.length) return;
    p.wanted = true;
    const a = audio();
    // A failed source stays failed; reload it so it errors (and skips) again.
    if (!a.src || a.error) load(p.index);
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
    root.clearTimeout(p.retry);
    if (p.audio) p.audio.pause();
    notify();
  }

  function step(dir) {
    if (!p.list.length) return;
    if (p.shuffle && dir > 0 && p.index === p.list.length - 1 && p.list.length > 1) {
      p.list = shuffled(p.list, null, p.list[p.index], Math.random); // round again, in a new order
      load(0);
    } else {
      load(p.index + dir);
    }
    if (p.wanted) play();
  }

  // Previous restarts the current track first, like any music player.
  function previous() {
    if (p.audio && !p.audio.error && p.audio.currentTime > 5) {
      p.audio.currentTime = 0;
      if (p.wanted) play();
      return;
    }
    step(-1);
  }

  CH.player = {
    // Also used to switch playlists: drops the old track so play() loads anew.
    // startIndex: the track to start on, or -1 for the top (shuffled: any).
    init: function (list, startIndex, onChange, shuffle) {
      root.clearTimeout(p.retry);
      root.clearTimeout(p.watch);
      p.failed = {};
      if (p.audio) {
        p.audio.pause();
        p.audio.removeAttribute('src');
        p.audio.load();
      }
      const tracks = Array.isArray(list) ? list.filter(function (t) { return t && t.file; }) : [];
      p.shuffle = !!shuffle;
      if (p.shuffle) {
        p.list = shuffled(tracks, tracks[startIndex] || null, null, Math.random);
        p.index = 0;
      } else {
        p.list = tracks;
        p.index = tracks.length ? Math.max(0, Math.min(tracks.length - 1, startIndex || 0)) : 0;
      }
      p.onChange = onChange;
    },
    shuffled: shuffled,
    play: play,
    pause: pause,
    // Same test as the on-screen hint: OK on 'Play' plays, on 'Pause' pauses.
    toggle: function () {
      if (state().playing) pause();
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
    // Back in front: carry on, or move past a track that failed while hidden.
    resume: function () {
      if (!p.wanted) return;
      if (p.audio && p.audio.error) step(1);
      else play();
    },
    state: state
  };
})(typeof window !== 'undefined' ? window : globalThis);
