// Brainrot mode: Ambient as a vertical, TikTok-style feed in the middle of the
// screen, with a comment section beside it. Every video is drawn live on a
// canvas (an endless runner under a story, a ball escaping rings, an aura
// meter, Italian brainrot characters, a logo waiting for the corner) with words
// from brainrot.js, so there are no video files and no network. Sound effects
// are synthesised with Web Audio; the music is the player's 'brainrot' set.
// It draws at 30 fps, only while Ambient shows and isn't paused. More video
// kinds plug in from reel-more.js through CH.reel.scenes and CH.reel.kit.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};
  const doc = root.document;

  const W = 608; // the reel: 9:16 at the screen's full height
  const H = 1080;
  const RES = 0.75; // canvas pixels per screen pixel; the TV scales it up
  const FRAME_MS = 1000 / 30;
  const SWIPE_MS = 420;
  const COMMENT_S = 2.6;
  const MAX_COMMENTS = 7;
  const TAU = Math.PI * 2;

  // Drawn emoji, for the tokens brainrot.js writes (:skull: and friends).
  const EMOJI = {
    skull: '<svg viewBox="0 0 24 24"><path fill="#EDEDED" d="M12 2C6.9 2 3 5.6 3 10.3c0 2.7 1.3 4.6 3 5.8V19a1 1 0 0 0 1 1h1.5v-2H10v2h4v-2h1.5v2H17a1 1 0 0 0 1-1v-2.9c1.7-1.2 3-3.1 3-5.8C21 5.6 17.1 2 12 2z"/>' +
      '<circle cx="8.6" cy="11" r="2.3" fill="#222"/><circle cx="15.4" cy="11" r="2.3" fill="#222"/><path fill="#222" d="M12 13.4l-1.3 2.4h2.6z"/></svg>',
    sob: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#FFCC33"/>' +
      '<path d="M6.5 9.5q2-1.5 4 0M13.5 9.5q2-1.5 4 0" stroke="#5B3A1A" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
      '<path d="M7 11h2.6v10.5H7zM14.4 11H17v10.5h-2.6z" fill="#4FB3FF"/><ellipse cx="12" cy="16.5" rx="3.2" ry="2.4" fill="#5B3A1A"/></svg>',
    fire: '<svg viewBox="0 0 24 24"><path fill="#FF5A1F" d="M12 2c1 3.5 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-3 1.6-4.6 2.7-6.2.3 1.8 1.1 2.7 2 3.2C11 7.5 11.3 4.7 12 2z"/>' +
      '<path fill="#FFC21F" d="M12 11.5c.8 1.8 3 2.6 3 5a3 3 0 0 1-6 0c0-1.6 1.2-2.5 1.8-3.6.2.9.6 1.3 1 1.5.1-1 .1-2 .2-2.9z"/></svg>',
    moai: '<svg viewBox="0 0 24 24"><path fill="#9AA0A6" d="M7 4.5C7 3 8.5 2 12 2s5 1 5 2.5V20l1 2H6l1-2z"/><path fill="#6B7177" d="M7 6.5h10v2.2H7z"/>' +
      '<path fill="#3F4448" d="M8.3 9.6h2.6v1.2H8.3zM13.1 9.6h2.6v1.2h-2.6zM11.2 10.5h1.6l.7 5h-3zM9.5 17.3h5v1.1h-5z"/></svg>'
  };

  const ICON = {
    heart: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.2 0 3.6 1.2 5.2 3 1.6-1.8 3-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>',
    comment: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 5 3.7 6.5L5 21.5l4.2-2.3c.9.2 1.8.3 2.8.3 5.5 0 10-3.8 10-8.5S17.5 3 12 3z"/>' +
      '<circle cx="7.5" cy="11.5" r="1.4" fill="#000" opacity=".35"/><circle cx="12" cy="11.5" r="1.4" fill="#000" opacity=".35"/><circle cx="16.5" cy="11.5" r="1.4" fill="#000" opacity=".35"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 2.5h12a1 1 0 0 1 1 1v18l-7-4.6-7 4.6v-18a1 1 0 0 1 1-1z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13.5 3.5L22 11l-8.5 7.5V14C7.5 14 4.3 16 2 20.5 2.8 13.6 6.6 9.2 13.5 8.4z"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 18.5a3 3 0 1 1-2-2.8V4l12-2v12.5a3 3 0 1 1-2-2.8V6.3l-8 1.4z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4.5v15l12.5-7.5z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="3.2" stroke-linecap="round" d="M12 6v12M6 12h12"/></svg>'
  };

  // An original tune the escaping ball plays, one note per bounce (MIDI).
  const MELODY = [72, 76, 79, 84, 79, 76, 74, 77, 81, 86, 81, 77, 76, 79, 83, 88, 83, 79, 77, 81, 84, 89, 84, 81];

  const r = {
    el: null,
    phone: null,
    top: null,
    bar: null,
    pauseIcon: null,
    list: null,
    count: null,
    seed: 0,
    cur: null, // the video on screen: { video, el, ctx, caption, scene, t, ... }
    running: false,
    suspended: false,
    paused: false,
    raf: 0,
    last: 0,
    commentClock: 0,
    rnd: null,
    soundLabel: null
  };

  function h(tag, cls, text) {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function icon(cls, markup) {
    const el = h('span', cls);
    el.innerHTML = markup;
    return el;
  }

  // Text with :emoji: tokens drawn as small images.
  function rich(el, text) {
    el.innerHTML = '';
    String(text).split(/(:[a-z]+:)/).forEach(function (part) {
      const name = /^:([a-z]+):$/.exec(part);
      if (name && EMOJI[name[1]]) el.appendChild(icon('emoji', EMOJI[name[1]]));
      else if (part) el.appendChild(doc.createTextNode(part));
    });
    return el;
  }

  function hue(text) {
    let x = 0;
    for (let i = 0; i < text.length; i++) x = (x * 31 + text.charCodeAt(i)) % 360;
    return x;
  }

  function avatar(cls, user) {
    const el = h('span', cls, user.charAt(0).toUpperCase());
    el.style.backgroundColor = 'hsl(' + hue(user) + ', 70%, 52%)';
    return el;
  }

  // ---- Sound effects ---------------------------------------------------------

  // Web Audio, created on first use. If the TV has none, the feed is just quieter.
  // The reels' own sound plays whether or not the music does.
  const sfx = { ac: null, noise: null };

  function audioContext() {
    if (sfx.ac === null) {
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        sfx.ac = AC ? new AC() : false;
      } catch (e) {
        sfx.ac = false;
      }
    }
    return sfx.ac || null;
  }

  function play(fn) {
    if (r.paused || !r.running || r.suspended) return;
    const ac = audioContext();
    if (!ac) return;
    try {
      if (ac.state === 'suspended') ac.resume();
      fn(ac, ac.currentTime + 0.01);
    } catch (e) {
      // Sound effects are extras; the feed carries on without them.
    }
  }

  function tone(ac, at, freq, dur, type, gain, toFreq) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  function hiss(ac, at, dur, gain, freq, toFreq) {
    if (!sfx.noise) {
      const n = ac.sampleRate;
      sfx.noise = ac.createBuffer(1, n, n);
      const d = sfx.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    src.buffer = sfx.noise;
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(freq, at);
    if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, at + dur);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    src.start(at);
    src.stop(at + dur + 0.05);
  }

  function midiHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  // A made-up voice, TikTok-narrator style: a buzzy blip per syllable through
  // two vowel formants, so words sound spoken without being words. Each
  // speaker has their own pitch and pace.
  const VOICES = {
    narrator: { pitch: 175, wave: 'sawtooth', step: 0.085, gain: 0.5 },
    me: { pitch: 255, wave: 'square', step: 0.075, gain: 0.3 },
    them: { pitch: 135, wave: 'sawtooth', step: 0.09, gain: 0.5 },
    italian: { pitch: 118, wave: 'sawtooth', step: 0.1, gain: 0.55 },
    deep: { pitch: 72, wave: 'sawtooth', step: 0.14, gain: 0.7 },
    whisper: { noise: true, step: 0.09, gain: 0.35 }
  };
  const VOWELS = [[730, 1090], [270, 2290], [530, 1840], [570, 840], [440, 1020], [660, 1720]];

  function syllable(ac, at, v, f, vowel) {
    const o = ac.createOscillator();
    o.type = v.wave;
    o.frequency.setValueAtTime(f * 1.05, at);
    o.frequency.exponentialRampToValueAtTime(f * 0.93, at + v.step);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v.gain * 0.25, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + v.step * 0.95);
    vowel.forEach(function (formant, i) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = formant;
      bp.Q.value = 5;
      const level = ac.createGain();
      level.gain.value = i ? 0.5 : 1;
      o.connect(bp);
      bp.connect(level);
      level.connect(g);
    });
    g.connect(ac.destination);
    o.start(at);
    o.stop(at + v.step + 0.03);
  }

  // Says `text` (a word or a line) in a voice; returns nothing, schedules all.
  function say(text, voice) {
    const v = VOICES[voice] || VOICES.narrator;
    const words = String(text).replace(/:[a-z]+:/g, ' ').toLowerCase().split(/[^a-z0-9’']+/).filter(Boolean);
    if (!words.length) return;
    play(function (ac, at) {
      let when = at;
      words.slice(0, 16).forEach(function (w) {
        const groups = w.match(/[aeiouy]+/g);
        const n = Math.max(1, Math.min(4, groups ? groups.length : 1));
        let seed = 0;
        for (let i = 0; i < w.length; i++) seed = (seed * 31 + w.charCodeAt(i)) % 997;
        for (let k = 0; k < n; k++) {
          const s = when + k * v.step;
          if (v.noise) hiss(ac, s, v.step * 0.9, v.gain * 0.4, VOWELS[(seed + k) % VOWELS.length][1] * 1.4);
          else syllable(ac, s, v, v.pitch * (1 + (((seed + k * 7) % 9) - 4) * 0.045), VOWELS[(seed + k * 3) % VOWELS.length]);
        }
        when += n * v.step + 0.05;
      });
    });
  }

  // A tune for the cappuccina's music box.
  const MUSIC_BOX = [84, 88, 91, 96, 91, 88, 86, 89, 93, 98, 93, 89];

  const SFX = {
    // The deep cinematic hit every brainrot edit leans on.
    boom: function () {
      play(function (ac, at) {
        tone(ac, at, 110, 1.1, 'sine', 0.6, 32);
        tone(ac, at, 55, 1.3, 'triangle', 0.35, 28);
        hiss(ac, at, 0.35, 0.35, 700, 120);
      });
    },
    note: function (i) {
      play(function (ac, at) {
        const f = midiHz(MELODY[i % MELODY.length]);
        tone(ac, at, f, 0.42, 'triangle', 0.24);
        tone(ac, at, f * 2, 0.16, 'sine', 0.07);
      });
    },
    ding: function () {
      play(function (ac, at) {
        tone(ac, at, 1318.5, 0.5, 'sine', 0.2);
        tone(ac, at + 0.09, 1975.5, 0.7, 'sine', 0.16);
      });
    },
    shatter: function () {
      play(function (ac, at) {
        hiss(ac, at, 0.45, 0.4, 5000, 1800);
        tone(ac, at, 1568, 0.25, 'square', 0.05, 784);
      });
    },
    swipe: function () {
      play(function (ac, at) {
        hiss(ac, at, 0.28, 0.22, 600, 3200);
      });
    },
    // A text going out, and one coming in.
    sent: function () {
      play(function (ac, at) {
        tone(ac, at, 880, 0.09, 'sine', 0.16, 1760);
      });
    },
    received: function () {
      play(function (ac, at) {
        tone(ac, at, 1174.7, 0.18, 'sine', 0.16);
        tone(ac, at + 0.11, 1568, 0.3, 'sine', 0.14);
      });
    },
    // Kinetic sand giving way under the knife.
    crunch: function () {
      play(function (ac, at) {
        hiss(ac, at, 0.5, 0.5, 2400, 500);
        hiss(ac, at + 0.05, 0.3, 0.25, 6000, 2000);
      });
    },
    tick: function () {
      play(function (ac, at) {
        tone(ac, at, 2000, 0.04, 'square', 0.06);
      });
    },
    pop: function () {
      play(function (ac, at) {
        tone(ac, at, 520, 0.12, 'triangle', 0.18, 1040);
      });
    },
    say: say,
    // The 'Inception' horn under a sigma edit.
    horn: function () {
      play(function (ac, at) {
        [43, 50, 55].forEach(function (m) {
          tone(ac, at, midiHz(m), 1.6, 'sawtooth', 0.09, midiHz(m) * 0.985);
        });
      });
    },
    // A coin; a row of them climbs in pitch.
    coin: function (n) {
      play(function (ac, at) {
        const f = midiHz(83 + (n % 5) * 2);
        tone(ac, at, f, 0.08, 'square', 0.05);
        tone(ac, at + 0.06, f * 1.5, 0.18, 'square', 0.05);
      });
    },
    hop: function () {
      play(function (ac, at) {
        tone(ac, at, 220, 0.16, 'triangle', 0.14, 520);
      });
    },
    thud: function () {
      play(function (ac, at) {
        tone(ac, at, 95, 0.12, 'sine', 0.22, 50);
      });
    },
    // A marble on a peg.
    clack: function (pitch) {
      play(function (ac, at) {
        tone(ac, at, 1400 + pitch * 180, 0.035, 'triangle', 0.07);
      });
    },
    // The logo meeting a wall.
    blip: function () {
      play(function (ac, at) {
        tone(ac, at, 660, 0.07, 'square', 0.05);
      });
    },
    cheer: function () {
      play(function (ac, at) {
        hiss(ac, at, 1.6, 0.25, 1600, 900);
        hiss(ac, at + 0.1, 1.4, 0.18, 3200, 2400);
      });
    },
    buzzer: function () {
      play(function (ac, at) {
        tone(ac, at, 110, 0.6, 'square', 0.12);
        tone(ac, at, 116, 0.6, 'sawtooth', 0.1);
      });
    },
    // Fingers on a phone keyboard, while someone is typing.
    keys: function () {
      play(function (ac, at) {
        for (let k = 0; k < 6; k++) hiss(ac, at + k * 0.12 + (k % 2) * 0.03, 0.03, 0.12, 4500);
      });
    },
    scrape: function () {
      play(function (ac, at) {
        hiss(ac, at, 0.45, 0.12, 5000, 2500);
      });
    },
    crumble: function () {
      play(function (ac, at) {
        for (let k = 0; k < 5; k++) hiss(ac, at + k * 0.06, 0.12, 0.16, 1800 - k * 200);
      });
    },
    // One beat of an Italian brainrot character's own sound.
    beat: function (kind, i) {
      play(function (ac, at) {
        if (kind === 'wood') {
          tone(ac, at, 820, 0.07, 'sine', 0.35, 640);
          tone(ac, at, 410, 0.1, 'triangle', 0.2);
        } else if (kind === 'squeak') {
          if (i % 2) tone(ac, at, 1900, 0.09, 'sine', 0.1, 2700);
        } else if (kind === 'twinkle') {
          const f = midiHz(MUSIC_BOX[i % MUSIC_BOX.length]);
          tone(ac, at, f, 0.6, 'sine', 0.14);
          tone(ac, at, f * 3, 0.25, 'sine', 0.03);
        } else if (kind === 'wa') {
          syllable(ac, at, { wave: 'sawtooth', step: 0.22, gain: 0.6 }, 220 + (i % 3) * 30, VOWELS[i % 2 ? 0 : 3]);
        } else if (kind === 'propeller') {
          hiss(ac, at, BEAT, 0.08, 180, 160);
          if (i % 8 === 7) tone(ac, at, 1600, 1.1, 'sine', 0.1, 500);
        } else if (kind === 'stomp') {
          tone(ac, at, 70, 0.28, 'sine', 0.5, 40);
          hiss(ac, at, 0.12, 0.2, 400);
        } else if (kind === 'swish') {
          hiss(ac, at, 0.18, 0.3, 1200, 7000);
          if (i % 2) {
            tone(ac, at + 0.12, 1250, 0.4, 'triangle', 0.08);
            tone(ac, at + 0.12, 1880, 0.3, 'triangle', 0.05);
          }
        }
      });
    }
  };

  // ---- Drawing helpers --------------------------------------------------------

  function rrect(ctx, x, y, w, hh, rad) {
    const rr = Math.min(rad, w / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + hh, rr);
    ctx.arcTo(x + w, y + hh, x, y + hh, rr);
    ctx.arcTo(x, y + hh, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function circle(ctx, x, y, rad, fill) {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function poly(ctx, pts, fill) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function eye(ctx, x, y, rad, look) {
    circle(ctx, x, y, rad, '#FFFFFF');
    circle(ctx, x + rad * 0.35 * look, y + rad * 0.1, rad * 0.5, '#111111');
    circle(ctx, x + rad * 0.15 * look, y - rad * 0.2, rad * 0.15, '#FFFFFF');
  }

  function vgrad(ctx, y0, y1, a, b) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
  }

  // Bits that fly off when something breaks or celebrates.
  function sparks() {
    const list = [];
    return {
      burst: function (x, y, n, colour, speed) {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const s = speed * (0.4 + Math.random() * 0.8);
          list.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c: colour || 'hsl(' + Math.floor(Math.random() * 360) + ', 90%, 60%)' });
        }
      },
      update: function (dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.vy += 600 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * 0.8;
          if (p.life <= 0) list.splice(i, 1);
        }
      },
      draw: function (ctx) {
        list.forEach(function (p) {
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.c;
          ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        });
        ctx.globalAlpha = 1;
      },
      count: function () {
        return list.length;
      }
    };
  }

  // ---- Scene: story over an endless runner (the split screen) ----------------

  const HORIZON = 640;
  const FOCAL = 260;
  const CAM_H = 2.0; // above the trains, so their roofs show
  const RUN_Z = 2.2; // the runner's distance from the camera
  const LANE = 1.15;
  const FAR = 40;
  const TRAIN_COLOURS = [['#E63946', '#B02A35', '#F28B93'], ['#F4A261', '#C47A3D', '#F8C99B'],
    ['#2A9D8F', '#1E7066', '#7ACFC4'], ['#457B9D', '#2F5870', '#8DB6CF']];

  function runner(rnd) {
    const g = { objs: [], travel: 0, lane: 0, x: 0, jump: 0, jumpT: -1, coins: 0, legs: 0, spawnIn: 0.6, coinIn: 0.2 };
    const skyline = [];
    for (let x = -10; x < W; ) {
      const w = 30 + rnd() * 50;
      skyline.push({ x: x, w: w, h: 30 + rnd() * 90, c: rnd() < 0.5 ? '#86AECF' : '#7399BC' });
      x += w + 2;
    }

    function trainsAt(lane, z0, z1) {
      return g.objs.some(function (o) {
        return o.kind !== 'coin' && o.lane === lane && o.z < z1 && o.z + o.len > z0;
      });
    }

    function blockedLanes(z0, z1) {
      return [-1, 0, 1].filter(function (l) { return trainsAt(l, z0, z1); }).length;
    }

    function spawn() {
      const lane = Math.floor(rnd() * 3) - 1;
      const len = 6 + rnd() * 6;
      // Never all three lanes at once, so there is always a way through.
      if (rnd() < 0.72 && blockedLanes(FAR - 4, FAR + len + 4) < 2 && !trainsAt(lane, FAR - 4, FAR + len + 4)) {
        g.objs.push({ kind: 'train', lane: lane, z: FAR, len: len, c: TRAIN_COLOURS[Math.floor(rnd() * TRAIN_COLOURS.length)] });
      } else if (!trainsAt(lane, FAR - 3, FAR + 3)) {
        g.objs.push({ kind: 'barrier', lane: lane, z: FAR, len: 0.3 });
      }
    }

    function spawnCoins() {
      const lane = Math.floor(rnd() * 3) - 1;
      if (trainsAt(lane, FAR - 1, FAR + 8)) return;
      for (let i = 0; i < 5; i++) g.objs.push({ kind: 'coin', lane: lane, z: FAR + i * 1.4, len: 0 });
    }

    function ahead(lane, within) {
      let best = null;
      g.objs.forEach(function (o) {
        if (o.kind === 'coin' || o.lane !== lane) return;
        if (o.z + o.len > RUN_Z - 0.2 && o.z < RUN_Z + within && (!best || o.z < best.z)) best = o;
      });
      return best;
    }

    function update(dt) {
      const speed = 11;
      g.travel += speed * dt;
      g.objs.forEach(function (o) { o.z -= speed * dt; });
      g.objs = g.objs.filter(function (o) {
        const here = o.lane === g.lane && o.z < RUN_Z + 0.3 && o.z > RUN_Z - 0.6;
        if (o.kind === 'coin' && here && g.jump < 0.6) {
          g.coins++;
          SFX.coin(g.coins);
          return false;
        }
        return o.z + o.len > 0.5;
      });
      g.spawnIn -= dt;
      if (g.spawnIn <= 0) {
        spawn();
        g.spawnIn = 0.7 + rnd() * 0.7;
      }
      g.coinIn -= dt;
      if (g.coinIn <= 0) {
        spawnCoins();
        g.coinIn = 1.2 + rnd() * 1.2;
      }
      // Dodge trains by changing lanes; jump barriers.
      const o = ahead(g.lane, 9);
      if (o && o.kind === 'barrier' && o.z < RUN_Z + 2.6 && g.jumpT < 0) {
        g.jumpT = 0;
        SFX.hop();
      }
      if (o && o.kind === 'train') {
        const options = [g.lane - 1, g.lane + 1].filter(function (l) {
          return l >= -1 && l <= 1 && !ahead(l, 11);
        });
        if (options.length) g.lane = options[Math.floor(rnd() * options.length)];
      } else if (!o) {
        // A clear run: head for the nearest coins, a lane at a time.
        let coin = null;
        g.objs.forEach(function (c) {
          if (c.kind === 'coin' && c.z > RUN_Z && c.z < RUN_Z + 12 && (!coin || c.z < coin.z)) coin = c;
        });
        const toward = coin ? g.lane + (coin.lane > g.lane ? 1 : coin.lane < g.lane ? -1 : 0) : g.lane;
        if (toward !== g.lane && !ahead(toward, 11)) g.lane = toward;
      }
      if (g.jumpT >= 0) {
        g.jumpT += dt;
        g.jump = Math.sin(Math.min(1, g.jumpT / 0.7) * Math.PI) * 1.1;
        if (g.jumpT >= 0.7) {
          g.jumpT = -1;
          g.jump = 0;
        }
      }
      g.x += (g.lane * LANE - g.x) * Math.min(1, dt * 9);
      g.legs += dt * 15;
    }

    function proj(x, y, z, cam) {
      const s = FOCAL / z;
      return { x: W / 2 + (x - cam) * s, y: HORIZON + (CAM_H - y) * s, s: s };
    }

    function quad(ctx, a, b, c, d, fill) {
      poly(ctx, [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y], fill);
    }

    function drawTrain(ctx, o, cam) {
      const lx = o.lane * LANE;
      const zn = Math.max(o.z, 0.9);
      const zf = Math.min(o.z + o.len, 70);
      const top = 1.7;
      const half = 0.5;
      // The side facing the camera, then the roof, then the front.
      const side = lx - cam > half ? -half : (lx - cam < -half ? half : 0);
      if (side) {
        quad(ctx, proj(lx + side, 0, zn, cam), proj(lx + side, top, zn, cam), proj(lx + side, top, zf, cam), proj(lx + side, 0, zf, cam), o.c[1]);
      }
      quad(ctx, proj(lx - half, top, zn, cam), proj(lx + half, top, zn, cam), proj(lx + half, top, zf, cam), proj(lx - half, top, zf, cam), o.c[2]);
      if (o.z < 0.9) return; // front already behind the camera
      const a = proj(lx - half, top, zn, cam);
      const b = proj(lx + half, 0, zn, cam);
      ctx.fillStyle = o.c[0];
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      const w = b.x - a.x;
      const hh = b.y - a.y;
      ctx.fillStyle = '#1B2733';
      ctx.fillRect(a.x + w * 0.12, a.y + hh * 0.1, w * 0.76, hh * 0.3);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(a.x, a.y + hh * 0.55, w, hh * 0.06);
      circle(ctx, a.x + w * 0.2, a.y + hh * 0.75, w * 0.07, '#FFF3B0');
      circle(ctx, a.x + w * 0.8, a.y + hh * 0.75, w * 0.07, '#FFF3B0');
    }

    function drawBarrier(ctx, o, cam) {
      const lx = o.lane * LANE;
      const l = proj(lx - 0.5, 0.62, o.z, cam);
      const rr = proj(lx + 0.5, 0.32, o.z, cam);
      const foot = proj(lx, 0, o.z, cam);
      ctx.fillStyle = '#555555';
      ctx.fillRect(l.x + (rr.x - l.x) * 0.1, l.y, 4 * l.s / 100, foot.y - l.y);
      ctx.fillRect(l.x + (rr.x - l.x) * 0.9, l.y, 4 * l.s / 100, foot.y - l.y);
      const seg = (rr.x - l.x) / 5;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#FFFFFF' : '#E63946';
        ctx.fillRect(l.x + i * seg, l.y, seg + 0.5, rr.y - l.y);
      }
    }

    function drawCoin(ctx, o, cam) {
      const p = proj(o.lane * LANE, 0.55, o.z, cam);
      const rad = 0.17 * p.s;
      const spin = Math.abs(Math.cos(g.travel * 0.8 + o.z));
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, Math.max(1, rad * spin), rad, 0, 0, TAU);
      ctx.fillStyle = '#FFD43B';
      ctx.fill();
      ctx.lineWidth = Math.max(1, rad * 0.18);
      ctx.strokeStyle = '#D99A00';
      ctx.stroke();
    }

    function drawRunner(ctx, cam) {
      const foot = proj(g.x, 0, RUN_Z, cam);
      const p = proj(g.x, g.jump, RUN_Z, cam);
      const s = p.s;
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, 0.28 * s * (1 - g.jump * 0.35), 0.06 * s, 0, 0, TAU);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fill();
      const swing = Math.sin(g.legs);
      const air = g.jump > 0.05;
      // Legs (jeans, white shoes), alternating.
      [-1, 1].forEach(function (side) {
        const lift = air ? 0.08 : Math.max(0, swing * side) * 0.12;
        const lx = p.x + side * 0.09 * s - 0.065 * s;
        rrect(ctx, lx, p.y - 0.44 * s - lift * s, 0.13 * s, 0.4 * s, 0.05 * s);
        ctx.fillStyle = '#2B3A67';
        ctx.fill();
        rrect(ctx, lx - 0.01 * s, p.y - 0.08 * s - lift * s, 0.15 * s, 0.08 * s, 0.03 * s);
        ctx.fillStyle = '#F5F5F5';
        ctx.fill();
      });
      // Arms swing opposite the legs.
      [-1, 1].forEach(function (side) {
        const lift = Math.max(0, -swing * side) * 0.1;
        rrect(ctx, p.x + side * 0.25 * s - 0.05 * s, p.y - 0.82 * s - lift * s, 0.1 * s, 0.36 * s, 0.05 * s);
        ctx.fillStyle = '#E8445F';
        ctx.fill();
      });
      rrect(ctx, p.x - 0.22 * s, p.y - 0.86 * s, 0.44 * s, 0.46 * s, 0.1 * s);
      ctx.fillStyle = '#FF4F6D';
      ctx.fill();
      rrect(ctx, p.x - 0.15 * s, p.y - 0.8 * s, 0.3 * s, 0.3 * s, 0.07 * s);
      ctx.fillStyle = '#2EC4B6';
      ctx.fill();
      circle(ctx, p.x, p.y - 0.99 * s, 0.14 * s, '#3B2A1E');
      // A cap on backwards.
      ctx.beginPath();
      ctx.arc(p.x, p.y - 1.01 * s, 0.145 * s, Math.PI, TAU);
      ctx.fillStyle = '#FFD23F';
      ctx.fill();
      ctx.fillStyle = '#E0B000';
      ctx.fillRect(p.x - 0.08 * s, p.y - 1.0 * s, 0.16 * s, 0.035 * s);
    }

    function draw(ctx) {
      const cam = g.x * 0.5;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, H / 2, W, H / 2);
      ctx.clip();
      ctx.fillStyle = vgrad(ctx, H / 2, HORIZON, '#4FB8F5', '#CDEFFF');
      ctx.fillRect(0, H / 2, W, HORIZON - H / 2);
      skyline.forEach(function (b) {
        ctx.fillStyle = b.c;
        ctx.fillRect(b.x, HORIZON - b.h, b.w, b.h);
      });
      ctx.fillStyle = '#A08C74';
      ctx.fillRect(0, HORIZON, W, H - HORIZON);
      [-1, 0, 1].forEach(function (lane) {
        const lx = lane * LANE;
        quad(ctx, proj(lx - 0.55, 0, FAR, cam), proj(lx + 0.55, 0, FAR, cam), proj(lx + 0.55, 0, 0.8, cam), proj(lx - 0.55, 0, 0.8, cam), '#7C6B5A');
      });
      // Sleepers scroll toward the camera; the rails stay put.
      ctx.strokeStyle = '#5A4636';
      for (let z = 0.9 + (0.9 - g.travel % 0.9); z < FAR; z += 0.9) {
        ctx.lineWidth = Math.max(1, 0.1 * FOCAL / z);
        ctx.beginPath();
        [-1, 0, 1].forEach(function (lane) {
          const a = proj(lane * LANE - 0.45, 0, z, cam);
          const b = proj(lane * LANE + 0.45, 0, z, cam);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        });
        ctx.stroke();
      }
      ctx.strokeStyle = '#D5DAE1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      [-1, 0, 1].forEach(function (lane) {
        [-0.3, 0.3].forEach(function (side) {
          const a = proj(lane * LANE + side, 0, 0.8, cam);
          const b = proj(lane * LANE + side, 0, FAR, cam);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        });
      });
      ctx.stroke();
      const objs = g.objs.slice().sort(function (a, b) { return b.z - a.z; });
      const one = function (o) {
        if (o.kind === 'train') drawTrain(ctx, o, cam);
        else if (o.kind === 'barrier') drawBarrier(ctx, o, cam);
        else drawCoin(ctx, o, cam);
      };
      objs.forEach(function (o) { if (o.z >= RUN_Z) one(o); });
      drawRunner(ctx, cam);
      objs.forEach(function (o) { if (o.z < RUN_Z) one(o); });
      ctx.restore();
    }

    return { update: update, draw: draw, state: g };
  }

  function storyScene(v, st) {
    const rnd = CH.brainrot.random(v.seed);
    const card = h('div', 'reel-card');
    const head = h('div', 'reel-card-head');
    head.appendChild(h('span', 'reel-card-icon', 'r/'));
    head.appendChild(h('span', 'reel-card-sub', v.sub));
    head.appendChild(h('span', 'reel-card-age', ' · ' + (1 + Math.floor(rnd() * 11)) + 'h'));
    card.appendChild(head);
    card.appendChild(rich(h('div', 'reel-card-title'), v.title));
    card.appendChild(h('div', 'reel-card-foot', CH.brainrot.count(v.likes) + ' upvotes · ' + CH.brainrot.count(v.comments) + ' comments'));
    st.layer.appendChild(card);
    const coins = h('div', 'reel-coins');
    coins.appendChild(h('span', 'reel-coin'));
    const coinText = h('span', null, '0');
    coins.appendChild(coinText);
    st.layer.appendChild(coins);
    const game = runner(rnd);
    let shown = 0;
    return {
      update: function (dt) {
        game.update(dt);
        if (game.state.coins !== shown) {
          shown = game.state.coins;
          coinText.textContent = String(shown);
        }
      },
      draw: function (ctx, t) {
        ctx.fillStyle = vgrad(ctx, 0, H / 2, '#2B1055', '#7597DE');
        ctx.fillRect(0, 0, W, H / 2);
        // Slow light streaks behind the post.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        for (let i = 0; i < 4; i++) {
          const x = ((t * 40 + i * 190) % (W + 300)) - 150;
          poly(ctx, [x, 0, x + 70, 0, x - 130, H / 2, x - 200, H / 2], 'rgba(255, 255, 255, 0.06)');
        }
        game.draw(ctx);
      }
    };
  }

  // ---- Scene: the ball escaping rings ------------------------------------------

  function bounceScene(v, st) {
    const rnd = CH.brainrot.random(v.seed);
    const cx = W / 2;
    const cy = 540;
    const hud = h('div', 'reel-hud');
    const hudCount = h('div', 'reel-hud-big', '0/' + v.rings);
    hud.appendChild(hudCount);
    hud.appendChild(h('div', 'reel-hud-label', 'rings escaped'));
    st.layer.appendChild(hud);
    const fx = sparks();
    let rings = [];
    let ball = null;
    let trail = [];
    let broken = 0;
    let bounces = 0;
    let freeFor = -1;
    let hueBase = rnd() * 360;

    function reset() {
      rings = [];
      for (let i = 0; i < v.rings; i++) {
        rings.push({ r: 96 + i * 28, gap: 0.62, a: rnd() * TAU, w: (i % 2 ? -1 : 1) * (0.8 + 0.16 * i),
          hue: (hueBase + i * 300 / v.rings) % 360, alive: true, flash: 0 });
      }
      ball = { x: cx, y: cy - 20, vx: (rnd() < 0.5 ? -1 : 1) * (160 + rnd() * 80), vy: -80, r: 13 };
      trail = [];
      broken = 0;
      freeFor = -1;
      hudCount.textContent = '0/' + v.rings;
    }
    reset();

    function wrap(a) {
      a = (a + Math.PI) % TAU;
      if (a < 0) a += TAU;
      return a - Math.PI;
    }

    function stepBall(dt) {
      ball.vy += 760 * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      rings.forEach(function (ring) { ring.a += ring.w * dt; });
      let inner = null;
      for (let i = 0; i < rings.length && !inner; i++) if (rings[i].alive) inner = rings[i];
      if (!inner) return;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const inGap = Math.abs(wrap(Math.atan2(dy, dx) - inner.a)) < inner.gap / 2 - (ball.r / inner.r) * 0.6;
      if (d >= inner.r) {
        // Through the gap: the ring shatters.
        inner.alive = false;
        broken++;
        hudCount.textContent = broken + '/' + v.rings;
        fx.burst(ball.x, ball.y, 26, 'hsl(' + inner.hue + ', 90%, 62%)', 420);
        SFX.shatter();
        if (broken === v.rings) {
          freeFor = 0;
          SFX.boom();
        }
      } else if (d + ball.r >= inner.r && !inGap) {
        const nx = dx / d;
        const ny = dy / d;
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot > 0) {
          ball.vx -= 2 * dot * nx;
          ball.vy -= 2 * dot * ny;
          // Keep it lively, and nudge it so it never settles into a loop.
          const sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
          const want = Math.min(900, Math.max(sp * 1.02, 560));
          ball.vx = ball.vx / sp * want - ny * (rnd() - 0.5) * 90;
          ball.vy = ball.vy / sp * want + nx * (rnd() - 0.5) * 90;
          inner.flash = 1;
          SFX.note(bounces++);
        }
        ball.x = cx + nx * (inner.r - ball.r);
        ball.y = cy + ny * (inner.r - ball.r);
      }
    }

    return {
      update: function (dt) {
        for (let i = 0; i < 4; i++) stepBall(dt / 4);
        rings.forEach(function (ring) { ring.flash = Math.max(0, ring.flash - dt * 4); });
        trail.push(ball.x, ball.y);
        if (trail.length > 28) trail.splice(0, 2);
        fx.update(dt);
        if (freeFor >= 0) {
          freeFor += dt;
          if (freeFor > 1.8) {
            hueBase = (hueBase + 120) % 360;
            reset();
          }
        }
      },
      draw: function (ctx) {
        const bg = ctx.createRadialGradient(cx, cy, 40, cx, cy, 560);
        bg.addColorStop(0, '#1A1530');
        bg.addColorStop(1, '#050508');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        ctx.lineCap = 'round';
        rings.forEach(function (ring) {
          if (!ring.alive) return;
          ctx.beginPath();
          ctx.arc(cx, cy, ring.r, ring.a + ring.gap / 2, ring.a - ring.gap / 2 + TAU);
          ctx.lineWidth = 7 + ring.flash * 4;
          ctx.strokeStyle = 'hsl(' + ring.hue + ', 90%, ' + Math.round(58 + ring.flash * 30) + '%)';
          ctx.stroke();
        });
        for (let i = 0; i < trail.length; i += 2) {
          ctx.globalAlpha = (i / trail.length) * 0.5;
          circle(ctx, trail[i], trail[i + 1], ball.r * (0.4 + 0.6 * i / trail.length), '#9FD8FF');
        }
        ctx.globalAlpha = 0.25;
        circle(ctx, ball.x, ball.y, ball.r * 1.9, '#9FD8FF');
        ctx.globalAlpha = 1;
        circle(ctx, ball.x, ball.y, ball.r, '#FFFFFF');
        fx.draw(ctx);
      }
    };
  }

  // ---- Scene: rating everything by aura -------------------------------------------

  function groups(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function auraScene(v, st) {
    const total = h('div', 'reel-aura-total', 'AURA 0');
    const big = h('div', 'reel-aura-big');
    st.layer.appendChild(total);
    st.layer.appendChild(big);
    let idx = -1;
    let sum = 0;
    let shown = 0;
    let sign = 0;
    return {
      update: function (dt, t) {
        const i = Math.floor((t - v.start) / v.itemSeconds);
        if (i !== idx && i >= 0 && i < v.items.length) {
          idx = i;
          const p = v.items[i].points;
          sum += p;
          sign = p > 0 ? 1 : -1;
          big.textContent = (p > 0 ? '+' : '−') + groups(Math.abs(p));
          big.className = 'reel-aura-big ' + (p > 0 ? 'is-up' : 'is-down');
          void big.offsetWidth; // restart the pop
          big.className += ' is-pop';
          if (p > 0) SFX.ding();
          else SFX.boom();
        }
        shown += (sum - shown) * Math.min(1, dt * 5);
        const rounded = Math.round(shown);
        total.textContent = 'AURA ' + (rounded < 0 ? '−' : '') + groups(Math.abs(rounded));
      },
      draw: function (ctx, t) {
        const c = sign > 0 ? ['#22C55E', '#052E16'] : sign < 0 ? ['#EF4444', '#3B0A0A'] : ['#555555', '#111111'];
        const bg = ctx.createRadialGradient(W / 2, 500, 20, W / 2, 500, 700);
        bg.addColorStop(0, c[0]);
        bg.addColorStop(1, c[1]);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        // A slow sunburst behind the number.
        ctx.save();
        ctx.translate(W / 2, 500);
        ctx.rotate(t * 0.35);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        for (let k = 0; k < 14; k++) {
          const a = k * TAU / 14;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 900, a, a + TAU / 28);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    };
  }

  // ---- Scene: Italian brainrot characters ----------------------------------------

  const BEAT = 60 / 128;

  const CHARACTERS = {
    tung: {
      bg: ['#F4A261', '#6D3B1F'],
      sound: 'wood',
      draw: function (ctx, t) {
        // A log with a bat, on the beat.
        const swing = Math.sin(t * TAU / BEAT) * 0.5;
        [-1, 1].forEach(function (side) {
          ctx.fillStyle = '#6B4423';
          ctx.fillRect(side * 34 - 9, 120, 18, 90);
          rrect(ctx, side * 34 - 22, 200, 44, 18, 8);
          ctx.fill();
        });
        rrect(ctx, -75, -200, 150, 340, 64);
        ctx.fillStyle = '#A0703C';
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#6B4423';
        ctx.stroke();
        ctx.lineWidth = 3;
        [-40, 10, 45].forEach(function (x) {
          ctx.beginPath();
          ctx.moveTo(x, -120);
          ctx.quadraticCurveTo(x + 12, 0, x - 4, 110);
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.ellipse(0, -186, 62, 18, 0, 0, TAU);
        ctx.fillStyle = '#D9A86C';
        ctx.fill();
        eye(ctx, -28, -95, 22, 1);
        eye(ctx, 28, -95, 22, 1);
        ctx.beginPath();
        ctx.ellipse(0, -35, 22, 16, 0, 0, TAU);
        ctx.fillStyle = '#3A1F0F';
        ctx.fill();
        ctx.save();
        ctx.translate(75, -10);
        ctx.rotate(-0.6 + swing);
        ctx.strokeStyle = '#6B4423';
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(55, 0);
        ctx.stroke();
        rrect(ctx, 45, -80, 26, 150, 13);
        ctx.fillStyle = '#C8A27A';
        ctx.fill();
        ctx.restore();
      }
    },
    tralalero: {
      bg: ['#8ECAE6', '#023E8A'],
      sound: 'squeak',
      draw: function (ctx, t) {
        // A shark in three pairs of sneakers.
        for (let i = -1; i <= 1; i++) {
          [-1, 1].forEach(function (side) {
            const lift = Math.max(0, Math.sin(t * 9 + i * 2 + side * 1.6)) * 16;
            const x = i * 85 + side * 16;
            ctx.strokeStyle = '#4A7396';
            ctx.lineWidth = 9;
            ctx.beginPath();
            ctx.moveTo(x, 20);
            ctx.lineTo(x, 92 - lift);
            ctx.stroke();
            rrect(ctx, x - 14, 88 - lift, 38, 20, 9);
            ctx.fillStyle = '#2F6BFF';
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(x - 14, 102 - lift, 38, 6);
          });
        }
        poly(ctx, [-150, -40, -235, -120, -215, -40, -235, 30], '#5C8FB8');
        poly(ctx, [-20, -100, 30, -185, 60, -100], '#5C8FB8');
        ctx.beginPath();
        ctx.ellipse(0, -40, 175, 72, 0, 0, TAU);
        ctx.fillStyle = '#5C8FB8';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(20, -8, 140, 34, 0, 0, TAU);
        ctx.fillStyle = '#DCE8F0';
        ctx.fill();
        eye(ctx, 112, -62, 13, 1);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(95, -18);
        for (let k = 0; k < 6; k++) ctx.lineTo(100 + k * 12, k % 2 ? -18 : -8);
        ctx.stroke();
      }
    },
    cappuccina: {
      bg: ['#FFC8DD', '#7B2CBF'],
      sound: 'twinkle',
      draw: function (ctx, t) {
        // A cappuccino ballerina, mid-pirouette.
        ctx.scale(0.75 + 0.25 * Math.cos(t * 3.2), 1);
        ctx.strokeStyle = '#F2D0B5';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(-14, 40);
        ctx.lineTo(-22, 180);
        ctx.moveTo(14, 40);
        ctx.lineTo(22, 180);
        ctx.moveTo(-26, -40);
        ctx.quadraticCurveTo(-90, -110, -40, -215);
        ctx.moveTo(26, -40);
        ctx.quadraticCurveTo(90, -110, 40, -215);
        ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const a = k / 24 * TAU;
          const rad = k % 2 ? 108 : 128;
          ctx.lineTo(Math.cos(a) * rad, 40 + Math.sin(a) * rad * 0.26);
        }
        ctx.fillStyle = '#FF8FC7';
        ctx.fill();
        rrect(ctx, -30, -50, 60, 95, 22);
        ctx.fillStyle = '#FF6FB5';
        ctx.fill();
        poly(ctx, [-72, -205, 72, -205, 56, -60, -56, -60], '#F4EDE4');
        ctx.beginPath();
        ctx.arc(76, -140, 26, -Math.PI / 2, Math.PI / 2);
        ctx.lineWidth = 12;
        ctx.strokeStyle = '#F4EDE4';
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, -205, 72, 17, 0, 0, TAU);
        ctx.fillStyle = '#6F4E37';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -205, 36, 8, 0, 0, TAU);
        ctx.fillStyle = '#E8CBA8';
        ctx.fill();
        eye(ctx, -24, -140, 14, 0);
        eye(ctx, 24, -140, 14, 0);
        circle(ctx, -40, -108, 9, 'rgba(255, 120, 150, 0.6)');
        circle(ctx, 40, -108, 9, 'rgba(255, 120, 150, 0.6)');
      }
    },
    bananini: {
      bg: ['#FFE066', '#2B9348'],
      sound: 'wa',
      draw: function (ctx, t) {
        // A chimp peeking out of a banana.
        const bob = Math.sin(t * TAU / BEAT) * 8;
        [-1, 1].forEach(function (side) {
          ctx.strokeStyle = '#6B4226';
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.moveTo(side * 30, 150);
          ctx.lineTo(side * 40, 215);
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.moveTo(-60, -40);
        ctx.quadraticCurveTo(-120, 120, 10, 170);
        ctx.quadraticCurveTo(110, 120, 70, -40);
        ctx.closePath();
        ctx.fillStyle = '#FFD93B';
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#C9A100';
        ctx.stroke();
        circle(ctx, 5, -110 + bob, 66, '#6B4226');
        ctx.beginPath();
        ctx.ellipse(5, -90 + bob, 46, 40, 0, 0, TAU);
        ctx.fillStyle = '#E8C39E';
        ctx.fill();
        eye(ctx, -15, -118 + bob, 13, 0);
        eye(ctx, 25, -118 + bob, 13, 0);
        circle(ctx, 5, -70 + bob, 11 + Math.abs(Math.sin(t * 6)) * 6, '#3A1F0F');
        [-1, 0, 1].forEach(function (k) {
          poly(ctx, [k * 40 - 25, -40, k * 40 + 25, -40, k * 55, -95], '#FFE066');
        });
      }
    },
    crocodilo: {
      bg: ['#A2D2FF', '#1D3557'],
      sound: 'propeller',
      draw: function (ctx, t) {
        // A crocodile that is also a bomber plane.
        ctx.translate(0, Math.sin(t * 2) * 26);
        ctx.rotate(Math.sin(t * 2 + 1) * 0.05);
        poly(ctx, [-40, -20, 50, -20, 10, -175, -50, -175], '#8A9199');
        poly(ctx, [-150, -10, -250, -70, -230, 10], '#3E7B22');
        ctx.beginPath();
        ctx.ellipse(0, 0, 190, 56, 0, 0, TAU);
        ctx.fillStyle = '#4C9A2A';
        ctx.fill();
        for (let k = -150; k < 120; k += 30) circle(ctx, k, -48, 11, '#3E7B22');
        rrect(ctx, 150, -28, 120, 46, 18);
        ctx.fillStyle = '#5DB33A';
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        for (let k = 160; k < 262; k += 16) poly(ctx, [k, 18, k + 8, 30, k + 16, 18], '#FFFFFF');
        circle(ctx, 165, -48, 20, '#4C9A2A');
        eye(ctx, 168, -50, 12, 1);
        poly(ctx, [-40, 20, 50, 20, 10, 170, -50, 170], '#8A9199');
        [-130, 120].forEach(function (y) {
          ctx.beginPath();
          ctx.ellipse(-10, y, 8, 46 * Math.abs(Math.sin(t * 30)), 0, 0, TAU);
          ctx.fillStyle = 'rgba(40, 40, 40, 0.7)';
          ctx.fill();
        });
      }
    }
  };

  function italianScene(v, st) {
    const who = CHARACTERS[v.character] || CHARACTERS.tung;
    const name = h('div', 'reel-italian-name', v.name.toUpperCase());
    st.layer.appendChild(name);
    let boomed = false;
    let beat = -1;
    const clouds = [0, 1, 2, 3].map(function (i) { return { x: i * 190, y: 160 + (i * 137) % 600, s: 0.6 + (i % 3) * 0.3 }; });
    return {
      update: function (dt, t) {
        if (!boomed && t > 0.15) {
          boomed = true;
          SFX.boom();
        }
        const b = Math.floor(t / BEAT);
        if (b !== beat) {
          beat = b;
          if (b > 0 && who.sound) SFX.beat(who.sound, b);
        }
        clouds.forEach(function (c) {
          c.x -= dt * 60 * c.s;
          if (c.x < -160) c.x = W + 80;
        });
      },
      draw: function (ctx, t) {
        ctx.fillStyle = vgrad(ctx, 0, H, who.bg[0], who.bg[1]);
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.5;
        clouds.forEach(function (c) {
          circle(ctx, c.x, c.y, 40 * c.s, '#FFFFFF');
          circle(ctx, c.x + 45 * c.s, c.y + 8, 32 * c.s, '#FFFFFF');
          circle(ctx, c.x - 40 * c.s, c.y + 10, 28 * c.s, '#FFFFFF');
        });
        ctx.globalAlpha = 1;
        // Zoom punch on every beat.
        const punch = 1 + 0.07 * Math.max(0, 1 - (t % BEAT) / BEAT * 3);
        ctx.save();
        ctx.translate(W / 2, 650);
        ctx.scale(punch, punch);
        ctx.rotate(Math.sin(t * 3) * 0.04);
        who.draw(ctx, t);
        ctx.restore();
      }
    };
  }

  // ---- Scene: will the logo hit the corner? ----------------------------------------

  // Position on a bouncing path: the box's walls fold a straight line.
  function fold(u, len) {
    const m = ((u % (2 * len)) + 2 * len) % (2 * len);
    return m <= len ? m : 2 * len - m;
  }

  const DVD_COLOURS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#007AFF', '#AF52DE', '#FF2D55'];

  function dvdScene(v, st) {
    const LW = 236;
    const LH = 104;
    const LX = W - LW;
    const LY = H - LH;
    const vx = 150;
    const vy = 172;
    // Start so the straight line lands exactly on the bottom-right corner at v.corner.
    const ux0 = LX - vx * v.corner;
    const uy0 = LY - vy * v.corner;
    const hud = h('div', 'reel-hud reel-hud-dvd');
    const hits = h('div', 'reel-hud-big', '0');
    hud.appendChild(hits);
    hud.appendChild(h('div', 'reel-hud-label', 'corner hits'));
    st.layer.appendChild(hud);
    const party = h('div', 'reel-party', 'IT HIT THE CORNER');
    st.layer.appendChild(party);
    // The logo is a layer of its own, moved by transform: drawing it (and its
    // text) on the canvas every frame was the slowest part on the TV.
    const logo = h('div', 'reel-dvd-logo', v.word);
    st.layer.insertBefore(logo, st.layer.firstChild);
    let colour = '';
    const fx = sparks();
    let hit = false;
    let walls = null;
    let painted = false; // the canvas is plain black between bursts of confetti
    let confetti = 0;
    return {
      update: function (dt, t) {
        fx.update(dt);
        const now = Math.floor((ux0 + vx * t) / LX) + Math.floor((uy0 + vy * t) / LY);
        if (walls !== null && now !== walls && t < v.corner - 0.05) SFX.blip();
        walls = now;
        if (!hit && t >= v.corner) {
          hit = true;
          hits.textContent = '1';
          party.className += ' is-shown';
          fx.burst(W - 20, H - 20, 60, null, 700);
          fx.burst(W / 2, H / 2, 40, null, 600);
          SFX.boom();
          SFX.cheer();
        }
      },
      draw: function (ctx, t) {
        const n = fx.count();
        if (!painted || n || confetti) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, W, H);
          fx.draw(ctx);
          painted = true;
          confetti = n;
        }
        const ux = ux0 + vx * t;
        const uy = uy0 + vy * t;
        const bounces = Math.floor(ux / LX) + Math.floor(uy / LY);
        const c = DVD_COLOURS[((bounces % DVD_COLOURS.length) + DVD_COLOURS.length) % DVD_COLOURS.length];
        logo.style.transform = 'translate(' + fold(ux, LX).toFixed(1) + 'px, ' + fold(uy, LY).toFixed(1) + 'px)';
        if (c !== colour) {
          colour = c;
          logo.style.backgroundColor = c;
        }
      }
    };
  }

  const SCENES = { story: storyScene, bounce: bounceScene, aura: auraScene, italian: italianScene, dvd: dvdScene };

  // ---- The feed --------------------------------------------------------------------

  function railItem(markup, text, cls) {
    const el = h('div', 'reel-rail-item' + (cls ? ' ' + cls : ''));
    el.appendChild(icon('reel-rail-icon', markup));
    el.appendChild(h('span', 'reel-rail-count', text));
    return el;
  }

  function soundText(v) {
    return r.soundLabel || 'original sound - ' + v.user;
  }

  // One video's layer: canvas, scene extras, caption, the side rail and the
  // info at the bottom.
  function buildStage(v) {
    const el = h('div', 'reel-stage reel-' + v.kind);
    const canvas = doc.createElement('canvas');
    canvas.className = 'reel-canvas';
    canvas.width = Math.round(W * RES);
    canvas.height = Math.round(H * RES);
    el.appendChild(canvas);
    const layer = h('div', 'reel-layer');
    el.appendChild(layer);
    const caption = h('div', 'reel-caption');
    el.appendChild(caption);

    const rail = h('div', 'reel-rail');
    const who = h('div', 'reel-rail-avatar');
    who.appendChild(avatar('reel-avatar', v.user));
    who.appendChild(icon('reel-follow', ICON.plus));
    rail.appendChild(who);
    rail.appendChild(railItem(ICON.heart, CH.brainrot.count(v.likes), 'is-liked'));
    rail.appendChild(railItem(ICON.comment, CH.brainrot.count(v.comments)));
    rail.appendChild(railItem(ICON.save, CH.brainrot.count(v.saves)));
    rail.appendChild(railItem(ICON.share, CH.brainrot.count(v.shares)));
    const disc = h('div', 'reel-disc');
    disc.appendChild(avatar('reel-disc-inner', v.user));
    rail.appendChild(disc);
    el.appendChild(rail);

    const info = h('div', 'reel-info');
    info.appendChild(h('div', 'reel-user', '@' + v.user));
    info.appendChild(rich(h('div', 'reel-text'), v.title + ' ' + v.tags));
    const sound = h('div', 'reel-sound');
    sound.appendChild(icon('reel-sound-icon', ICON.note));
    const marquee = h('div', 'reel-marquee');
    const soundLine = h('span', 'reel-marquee-text', soundText(v));
    marquee.appendChild(soundLine);
    sound.appendChild(marquee);
    info.appendChild(sound);
    el.appendChild(info);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    const st = { video: v, el: el, ctx: ctx, layer: layer, caption: caption, soundLine: soundLine, t: 0, chunk: -1, word: -1 };
    st.scene = SCENES[v.kind](v, st);
    return st;
  }

  // Who reads each kind of video's captions.
  const VOICE_FOR = { italian: 'italian', sigma: 'deep', sand: 'whisper' };

  // TikTok-style captions: a few words at a time, the spoken one highlighted
  // and said in the video's voice.
  function updateCaption(st) {
    const found = CH.brainrot.chunkAt(st.video.timeline, st.t);
    const index = found ? found.index : -1;
    if (index !== st.chunk) {
      st.chunk = index;
      st.word = -1;
      st.caption.innerHTML = '';
      if (found) {
        found.chunk.words.forEach(function (w) {
          st.caption.appendChild(rich(h('span', 'reel-word'), w.text));
          st.caption.appendChild(doc.createTextNode(' '));
        });
        st.caption.className = 'reel-caption is-pop';
      } else {
        st.caption.className = 'reel-caption';
      }
    }
    if (!found) return;
    let word = 0;
    found.chunk.words.forEach(function (w, i) { if (st.t >= w.at) word = i; });
    if (word !== st.word) {
      st.word = word;
      say(found.chunk.words[word].text, VOICE_FOR[st.video.kind] || 'narrator');
      Array.prototype.forEach.call(st.caption.querySelectorAll('.reel-word'), function (el, i) {
        el.classList.toggle('is-on', i === word);
      });
    }
  }

  function drawStage(st) {
    st.scene.draw(st.ctx, st.t);
  }

  function addComment() {
    const c = CH.brainrot.comment(r.rnd);
    const row = h('div', 'reel-comment is-new');
    row.appendChild(avatar('reel-comment-avatar', c.user));
    const body = h('div', 'reel-comment-body');
    body.appendChild(h('div', 'reel-comment-user', c.user));
    body.appendChild(rich(h('div', 'reel-comment-text'), c.text));
    row.appendChild(body);
    const likes = h('div', 'reel-comment-likes');
    likes.appendChild(icon('reel-comment-heart', ICON.heart));
    likes.appendChild(h('span', null, CH.brainrot.count(c.likes)));
    row.appendChild(likes);
    r.list.appendChild(row);
    while (r.list.children.length > MAX_COMMENTS) r.list.removeChild(r.list.firstChild);
    root.setTimeout(function () { row.classList.remove('is-new'); }, 30);
  }

  // Shows video n, sliding in from below (dir 1) or above (dir -1).
  function show(n, dir) {
    const old = r.cur;
    const st = buildStage(CH.brainrot.video(r.seed, n));
    r.phone.insertBefore(st.el, r.top);
    r.cur = st;
    updateCaption(st);
    drawStage(st);
    r.count.textContent = CH.brainrot.count(st.video.comments);
    r.bar.style.transform = 'scaleX(0)';
    if (!old) return;
    if (!dir) {
      r.phone.removeChild(old.el);
      return;
    }
    st.el.style.transform = 'translateY(' + (dir * H) + 'px)';
    void st.el.offsetHeight; // commit the start before sliding
    st.el.className += ' is-sliding';
    old.el.className += ' is-sliding';
    st.el.style.transform = 'translateY(0)';
    old.el.style.transform = 'translateY(' + (-dir * H) + 'px)';
    root.setTimeout(function () {
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }, SWIPE_MS + 60);
  }

  function advance(dt) {
    const st = r.cur;
    st.t += dt;
    if (st.t >= st.video.duration) {
      next(1);
      return;
    }
    st.scene.update(dt, st.t);
    updateCaption(st);
    drawStage(st);
    r.bar.style.transform = 'scaleX(' + Math.min(1, st.t / st.video.duration).toFixed(4) + ')';
    r.commentClock += dt;
    if (r.commentClock >= COMMENT_S) {
      r.commentClock = 0;
      addComment();
    }
  }

  function frame(now) {
    r.raf = 0;
    if (!r.running || r.suspended || r.paused) return;
    r.raf = root.requestAnimationFrame(frame);
    if (r.last && now - r.last < FRAME_MS - 4) return;
    const dt = r.last ? Math.min(0.1, (now - r.last) / 1000) : 0;
    r.last = now;
    advance(dt);
  }

  function loop() {
    if (r.raf || !r.running || r.suspended || r.paused) return;
    r.last = 0;
    r.raf = root.requestAnimationFrame(frame);
  }

  function halt() {
    if (r.raf) root.cancelAnimationFrame(r.raf);
    r.raf = 0;
  }

  function next(dir) {
    show(r.cur ? r.cur.video.n + dir : 0, dir);
    SFX.swipe();
  }

  function setPaused(paused) {
    r.paused = !!paused;
    r.pauseIcon.classList.toggle('is-shown', r.paused);
    r.el.classList.toggle('is-paused', r.paused);
    if (r.paused) halt();
    else loop();
  }

  CH.reel = {
    // Builds the feed inside the Ambient screen, under its clock and controls.
    init: function (container) {
      const el = h('div', 'reel');
      const phone = h('div', 'reel-phone');
      const top = h('div', 'reel-top');
      top.appendChild(h('span', 'reel-tab', 'Following'));
      top.appendChild(h('span', 'reel-tab is-on', 'For You'));
      phone.appendChild(top);
      const progress = h('div', 'reel-progress');
      const bar = h('div', 'reel-progress-bar');
      progress.appendChild(bar);
      phone.appendChild(progress);
      const pauseIcon = icon('reel-pause', ICON.play);
      phone.appendChild(pauseIcon);
      el.appendChild(phone);
      const side = h('aside', 'reel-comments');
      const head = h('div', 'reel-comments-head');
      head.appendChild(h('span', null, 'Comments '));
      const count = h('span', 'reel-comments-count', '');
      head.appendChild(count);
      side.appendChild(head);
      const list = h('div', 'reel-comments-list');
      side.appendChild(list);
      el.appendChild(side);
      // Over the wallpaper, under the clock and the controls.
      const text = container.querySelector('.ambient-text');
      container.insertBefore(el, text && text.parentNode === container ? text : null);
      r.el = el;
      r.phone = phone;
      r.top = top;
      r.bar = bar;
      r.pauseIcon = pauseIcon;
      r.list = list;
      r.count = count;
    },
    // A fresh feed each time Ambient opens in Brainrot mode.
    start: function (paused) {
      halt();
      r.seed = Math.floor(Math.random() * 1000000);
      r.rnd = CH.brainrot.random(r.seed + 1);
      r.running = true;
      r.suspended = false;
      r.commentClock = 0;
      r.list.innerHTML = '';
      for (let i = 0; i < 4; i++) addComment();
      if (r.cur && r.cur.el.parentNode) r.cur.el.parentNode.removeChild(r.cur.el);
      r.cur = null;
      show(0, 0);
      setPaused(paused);
    },
    stop: function () {
      r.running = false;
      halt();
      if (sfx.ac) {
        try {
          sfx.ac.suspend();
        } catch (e) {
          // Nothing to release.
        }
      }
    },
    // The TV hid the app: stop drawing; carry on where it was when it's back.
    suspend: function () {
      r.suspended = true;
      halt();
    },
    resume: function () {
      r.suspended = false;
      loop();
    },
    step: function (dir) {
      if (!r.running) return;
      setPaused(false); // first, so the swipe is heard
      next(dir);
    },
    setPaused: setPaused,
    // label: the playing track, or null for 'original sound'.
    setSound: function (label) {
      r.soundLabel = label;
      if (r.cur) r.cur.soundLine.textContent = soundText(r.cur.video);
    },
    state: function () {
      const st = r.cur;
      return {
        running: r.running,
        paused: r.paused,
        n: st ? st.video.n : -1,
        kind: st ? st.video.kind : null,
        t: st ? st.t : 0,
        duration: st ? st.video.duration : 0
      };
    },
    // For reel-more.js, which adds video kinds (scenes) and Italian characters.
    scenes: SCENES,
    kit: {
      W: W, H: H, RES: RES, TAU: TAU, BEAT: BEAT, SFX: SFX, CHARACTERS: CHARACTERS,
      h: h, icon: icon, rich: rich, avatar: avatar,
      rrect: rrect, circle: circle, poly: poly, eye: eye, vgrad: vgrad, sparks: sparks
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
