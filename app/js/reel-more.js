// More Brainrot videos, plugged into reel.js's feed: a texting story over
// sky parkour, kinetic sand cutting, a marble race, find-the-odd-one-out and
// a sigma-rule edit, plus two more Italian brainrot characters. Like the
// first scenes, each is drawn live on the video's canvas from the words in
// brainrot.js; scene(v, st) returns { update(dt, t), draw(ctx, t) }.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};
  const K = CH.reel.kit;
  const W = K.W;
  const H = K.H;
  const TAU = K.TAU;
  const BEAT = K.BEAT;
  const SFX = K.SFX;
  const h = K.h;
  const rich = K.rich;
  const rrect = K.rrect;
  const circle = K.circle;
  const poly = K.poly;
  const eye = K.eye;
  const vgrad = K.vgrad;

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  // ---- Texting story over sky parkour (a split screen) ------------------------

  const P_HORIZON = 740;
  const P_FOCAL = 300;
  const P_EYE = 1.62; // eye height above the block you stand on
  const P_GAP = 2.6; // distance between blocks
  const P_JUMP = 0.62; // seconds per jump

  // First-person parkour across floating grass blocks, in the bottom half.
  function parkour(rnd, onLand) {
    const blocks = [];
    let x = 0;
    let y = 0;
    function add() {
      const i = blocks.length ? blocks[blocks.length - 1].i + 1 : 0;
      if (i > 0) {
        x = clamp(x + (rnd() - 0.5) * 2.4, -2, 2);
        y = clamp(y + [-0.5, 0, 0, 0.5, 1][Math.floor(rnd() * 5)], -1.5, 1.5);
      }
      blocks.push({ i: i, x: x, y: y, z: i * P_GAP, gold: i > 0 && rnd() < 0.12,
        spots: [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5] });
    }
    for (let k = 0; k < 16; k++) add();
    const clouds = [0, 1, 2, 3, 4].map(function (k) {
      return { x: rnd() * (W + 200), y: 570 + rnd() * 120, w: 70 + rnd() * 90, hh: 18 + rnd() * 14 };
    });
    const g = { at: 0, p: 0, cam: { x: 0, y: P_EYE, z: 0 } };

    function update(dt) {
      g.p += dt / P_JUMP;
      while (g.p >= 1) {
        g.p -= 1;
        g.at++;
        add();
        if (onLand) onLand();
        if (g.at > 2) {
          blocks.shift();
          g.at--;
        }
      }
      const a = blocks[g.at];
      const b = blocks[g.at + 1];
      g.cam.x = a.x + (b.x - a.x) * g.p;
      g.cam.z = a.z + (b.z - a.z) * g.p;
      g.cam.y = a.y + (b.y - a.y) * g.p + 4 * 0.9 * g.p * (1 - g.p) + P_EYE;
    }

    function proj(px, py, pz) {
      const dz = Math.max(0.2, pz - g.cam.z);
      const s = P_FOCAL / dz;
      return { x: W / 2 + (px - g.cam.x) * s, y: P_HORIZON + (g.cam.y - py) * s };
    }

    function quad(ctx, pts, fill) {
      const p = pts.map(function (q) { return proj(q[0], q[1], q[2]); });
      poly(ctx, [p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y], fill);
    }

    function cube(ctx, b) {
      const x0 = b.x - 0.5;
      const x1 = b.x + 0.5;
      const yt = b.y;
      const yb = b.y - 1;
      const zf = b.z + 0.5;
      const zn = Math.max(b.z - 0.5, g.cam.z + 0.25);
      if (zf <= zn) return;
      const c = b.gold
        ? { top: '#F7D354', strip: '#E6B82E', front: '#E0AE2A', side: '#C2931B' }
        : { top: '#6DBE45', strip: '#5AA236', front: '#8A5A33', side: '#6E4627' };
      if (g.cam.x < x0) {
        quad(ctx, [[x0, yt, zn], [x0, yt, zf], [x0, yb, zf], [x0, yb, zn]], c.side);
        if (!b.gold) quad(ctx, [[x0, yt, zn], [x0, yt, zf], [x0, yt - 0.18, zf], [x0, yt - 0.18, zn]], c.strip);
      } else if (g.cam.x > x1) {
        quad(ctx, [[x1, yt, zn], [x1, yt, zf], [x1, yb, zf], [x1, yb, zn]], c.side);
        if (!b.gold) quad(ctx, [[x1, yt, zn], [x1, yt, zf], [x1, yt - 0.18, zf], [x1, yt - 0.18, zn]], c.strip);
      }
      if (b.z - 0.5 > g.cam.z + 0.25) {
        quad(ctx, [[x0, yt, zn], [x1, yt, zn], [x1, yb, zn], [x0, yb, zn]], c.front);
        if (!b.gold) quad(ctx, [[x0, yt, zn], [x1, yt, zn], [x1, yt - 0.18, zn], [x0, yt - 0.18, zn]], c.strip);
      }
      if (g.cam.y > yt) {
        quad(ctx, [[x0, yt, zn], [x1, yt, zn], [x1, yt, zf], [x0, yt, zf]], c.top);
        // A couple of darker pixels, for the blocky texture.
        for (let k = 0; k < 4; k += 2) {
          const u = b.x + b.spots[k] * 0.7;
          const w = b.z + b.spots[k + 1] * 0.7;
          if (w - 0.1 > g.cam.z + 0.25) quad(ctx, [[u - 0.1, yt, w - 0.1], [u + 0.1, yt, w - 0.1], [u + 0.1, yt, w + 0.1], [u - 0.1, yt, w + 0.1]], 'rgba(0, 0, 0, 0.14)');
        }
      }
    }

    function draw(ctx, t) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, H / 2, W, H / 2);
      ctx.clip();
      ctx.fillStyle = vgrad(ctx, H / 2, H, '#6FB2F2', '#D4ECFF');
      ctx.fillRect(0, H / 2, W, H / 2);
      clouds.forEach(function (c) {
        const cx = ((c.x - t * 14) % (W + 200) + W + 200) % (W + 200) - 100;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(cx, c.y, c.w, c.hh);
        ctx.fillRect(cx + c.w * 0.2, c.y - c.hh * 0.6, c.w * 0.5, c.hh * 0.6);
      });
      for (let k = blocks.length - 1; k >= 0; k--) cube(ctx, blocks[k]);
      // Crosshair and the blocky arm.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(W / 2 - 14, P_HORIZON - 2, 28, 4);
      ctx.fillRect(W / 2 - 2, P_HORIZON - 14, 4, 28);
      const bob = Math.sin(g.p * Math.PI) * 16;
      poly(ctx, [W - 170, H + 10, W - 90, H + 10, W - 40, 940 + bob, W - 110, 915 + bob], '#C68E5A');
      poly(ctx, [W - 110, 915 + bob, W - 40, 940 + bob, W - 28, 915 + bob, W - 96, 892 + bob], '#E0AC72');
      ctx.restore();
    }

    return { update: update, draw: draw };
  }

  function bubble(from, text) {
    const row = h('div', 'reel-msg is-' + from);
    const b = h('div', 'reel-bubble' + (text === null ? ' is-typing' : ''));
    if (text === null) {
      for (let k = 0; k < 3; k++) b.appendChild(h('span', 'reel-dot'));
    } else {
      rich(b, text);
    }
    row.appendChild(b);
    return row;
  }

  function textingScene(v, st) {
    const chat = h('div', 'reel-chat');
    const head = h('div', 'reel-chat-head');
    head.appendChild(h('span', 'reel-chat-back', '‹'));
    head.appendChild(K.avatar('reel-chat-avatar', v.contact));
    const who = h('div', 'reel-chat-who');
    who.appendChild(h('div', 'reel-chat-name', v.contact));
    who.appendChild(h('div', 'reel-chat-status', 'online'));
    head.appendChild(who);
    const list = h('div', 'reel-chat-list');
    chat.appendChild(list);
    chat.appendChild(head);
    st.layer.appendChild(chat);
    const game = parkour(CH.brainrot.random(v.seed), SFX.thud);
    let shown = 0;
    let typing = null;

    function add(el) {
      list.appendChild(el);
      while (list.children.length > 7) list.removeChild(list.firstChild);
    }

    return {
      update: function (dt, t) {
        game.update(dt);
        const next = v.messages[shown];
        if (next && next.from === 'them' && !typing && t >= next.at - 0.9) {
          typing = bubble('them', null);
          add(typing);
          SFX.keys();
        }
        while (shown < v.messages.length && t >= v.messages[shown].at) {
          const m = v.messages[shown++];
          if (typing && typing.parentNode) list.removeChild(typing);
          typing = null;
          add(bubble(m.from, m.text));
          if (m.from === 'me') SFX.sent();
          else SFX.received();
          SFX.say(m.text, m.from);
        }
      },
      draw: function (ctx, t) {
        ctx.fillStyle = vgrad(ctx, 0, H / 2, '#1B1035', '#3B2A70');
        ctx.fillRect(0, 0, W, H / 2);
        game.draw(ctx, t);
      }
    };
  }

  // ---- Kinetic sand cutting ----------------------------------------------------------

  const SAND_X0 = 120;
  const SAND_X1 = 488;
  const SAND_BOTTOM = 772;
  const SAND_HEIGHT = 220;
  const SLICE = 40;
  const DEPTH_X = 26;
  const DEPTH_Y = -22;

  function sandScene(v) {
    const rnd = CH.brainrot.random(v.seed);
    let colours = v.colours.slice();
    let x1 = SAND_X1;
    let cut = -1;
    let cutAt = SAND_X1;
    let slices = [];
    let piles = [];
    const grains = [];

    function spill(x0, xa, y, n, speed) {
      for (let k = 0; k < n; k++) {
        grains.push({ x: x0 + rnd() * (xa - x0), y: y, vx: (rnd() - 0.5) * speed, vy: -rnd() * speed * 0.6,
          c: colours[Math.floor(rnd() * colours.length)], life: 1 });
      }
    }

    function knifeY(phase) {
      const top = 360;
      if (phase < 0.5) return top + (SAND_BOTTOM - top) * Math.sin(phase / 0.5 * Math.PI / 2);
      if (phase < 0.75) return SAND_BOTTOM;
      if (phase < 1.2) return SAND_BOTTOM - (SAND_BOTTOM - top) * (phase - 0.75) / 0.45;
      return top;
    }

    function bands(ctx, x0, xa, top, height) {
      const bh = height / colours.length;
      colours.forEach(function (c, i) {
        ctx.fillStyle = c;
        ctx.fillRect(x0, top + i * bh, xa - x0, bh + 0.5);
      });
    }

    return {
      update: function (dt, t) {
        const n = Math.floor(t / v.cut);
        const phase = t - n * v.cut;
        if (n !== cut) {
          cut = n;
          if (x1 - SAND_X0 < SLICE * 1.5) {
            // A new block, the colours turned over.
            colours = colours.slice(1).concat(colours.slice(0, 1));
            x1 = SAND_X1;
            piles = [];
          }
          cutAt = x1 - SLICE;
          SFX.scrape();
        }
        if (phase >= 0.5 && x1 > cutAt) {
          slices.push({ x0: cutAt, x1: x1, ang: 0, rest: 0, colours: colours });
          x1 = cutAt;
          spill(cutAt - 4, cutAt + 4, SAND_BOTTOM - SAND_HEIGHT, 14, 120);
          SFX.crunch();
        }
        slices = slices.filter(function (s) {
          if (s.ang < Math.PI / 2) {
            s.ang = Math.min(Math.PI / 2, s.ang + dt * (2 + s.ang * 6));
            return true;
          }
          s.rest += dt;
          if (s.rest < 0.35) return true;
          spill(s.x0, s.x1, SAND_BOTTOM - 10, 26, 160);
          SFX.crumble();
          piles.push({ x0: s.x0, x1: s.x1, colours: s.colours });
          return false;
        });
        for (let k = grains.length - 1; k >= 0; k--) {
          const p = grains[k];
          p.vy += 700 * dt;
          p.x += p.vx * dt;
          p.y = Math.min(SAND_BOTTOM - 2, p.y + p.vy * dt);
          if (p.y >= SAND_BOTTOM - 2) {
            p.vx *= 0.8;
            p.life -= dt * 0.6;
          }
          if (p.life <= 0) grains.splice(k, 1);
        }
      },
      draw: function (ctx, t) {
        ctx.fillStyle = vgrad(ctx, 0, H, '#FDE2E4', '#E2ECFF');
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#EADBC8';
        ctx.fillRect(0, SAND_BOTTOM + 14, W, H - SAND_BOTTOM - 14);
        rrect(ctx, 70, SAND_BOTTOM - 6, 470, 30, 12);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        piles.forEach(function (p) {
          const bh = 12 / p.colours.length;
          p.colours.forEach(function (c, i) {
            ctx.fillStyle = c;
            ctx.fillRect(p.x0 - 3, SAND_BOTTOM - 12 + i * bh, p.x1 - p.x0 + 6, bh + 0.5);
          });
        });
        const top = SAND_BOTTOM - SAND_HEIGHT;
        if (x1 > SAND_X0) {
          // The block: top and right faces for depth, then the front.
          poly(ctx, [SAND_X0, top, x1, top, x1 + DEPTH_X, top + DEPTH_Y, SAND_X0 + DEPTH_X, top + DEPTH_Y], colours[0]);
          poly(ctx, [SAND_X0, top, x1, top, x1 + DEPTH_X, top + DEPTH_Y, SAND_X0 + DEPTH_X, top + DEPTH_Y], 'rgba(255, 255, 255, 0.35)');
          const bh = SAND_HEIGHT / colours.length;
          colours.forEach(function (c, i) {
            const y0 = top + i * bh;
            poly(ctx, [x1, y0, x1 + DEPTH_X, y0 + DEPTH_Y, x1 + DEPTH_X, y0 + bh + DEPTH_Y, x1, y0 + bh], c);
            poly(ctx, [x1, y0, x1 + DEPTH_X, y0 + DEPTH_Y, x1 + DEPTH_X, y0 + bh + DEPTH_Y, x1, y0 + bh], 'rgba(0, 0, 0, 0.16)');
          });
          bands(ctx, SAND_X0, x1, top, SAND_HEIGHT);
        }
        // Slices tip forward, toward the camera, and flatten onto the tray.
        slices.forEach(function (s) {
          const hh = Math.max(6, SAND_HEIGHT * Math.cos(s.ang));
          const bh = hh / s.colours.length;
          s.colours.forEach(function (c, i) {
            ctx.fillStyle = c;
            ctx.fillRect(s.x0, SAND_BOTTOM - hh + i * bh, s.x1 - s.x0, bh + 0.5);
          });
          ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.25 * Math.sin(s.ang)) + ')';
          ctx.fillRect(s.x0, SAND_BOTTOM - hh, s.x1 - s.x0, hh);
        });
        grains.forEach(function (p) {
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
          ctx.fillStyle = p.c;
          ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        });
        ctx.globalAlpha = 1;
        // The knife, edge on.
        const phase = t - Math.max(0, cut) * v.cut;
        const ky = knifeY(phase);
        const kx = cutAt;
        const blade = ctx.createLinearGradient(kx - 9, 0, kx + 9, 0);
        blade.addColorStop(0, '#9AA3AD');
        blade.addColorStop(0.5, '#F4F6F8');
        blade.addColorStop(1, '#8B949E');
        ctx.fillStyle = blade;
        ctx.fillRect(kx - 8, ky - 250, 16, 250);
        rrect(ctx, kx - 13, ky - 360, 26, 116, 9);
        ctx.fillStyle = '#2F2F35';
        ctx.fill();
      }
    };
  }

  // ---- Which colour wins? (a marble race through pegs) -------------------------------

  const PEG_R = 6;
  const BALL_R = 14;
  const FINISH = 820;
  const RELEASE = 2.4; // seconds of 3, 2, 1 before the gate opens

  // The race's board (background, walls, pegs, finish line), drawn once; each
  // frame then draws just this picture and the marbles.
  function raceBoard(pegs) {
    const c = root.document.createElement('canvas');
    c.width = Math.round(W * K.RES);
    c.height = Math.round(H * K.RES);
    const ctx = c.getContext('2d');
    ctx.setTransform(K.RES, 0, 0, K.RES, 0, 0);
    ctx.fillStyle = vgrad(ctx, 0, H, '#14141F', '#08080C');
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(34, 180, 6, FINISH - 180);
    ctx.fillRect(W - 40, 180, 6, FINISH - 180);
    pegs.forEach(function (p) { circle(ctx, p.x, p.y, PEG_R, '#E8E8F0'); });
    for (let k = 0; k < 24; k++) {
      ctx.fillStyle = k % 2 ? '#FFFFFF' : '#111111';
      ctx.fillRect(40 + k * 22, FINISH, 22, 8);
      ctx.fillStyle = k % 2 ? '#111111' : '#FFFFFF';
      ctx.fillRect(40 + k * 22, FINISH + 8, 22, 8);
    }
    return c;
  }

  function raceScene(v, st) {
    const rnd = CH.brainrot.random(v.seed);
    const pegs = [];
    for (let row = 0; row < 10; row++) {
      for (let c = 0; ; c++) {
        const x = 70 + c * 66 + (row % 2 ? 33 : 0);
        if (x > 545) break;
        pegs.push({ x: x, y: 260 + row * 56 });
      }
    }
    const hud = h('div', 'reel-hud reel-race-hud');
    const big = h('div', 'reel-hud-big', '3');
    hud.appendChild(big);
    hud.appendChild(h('div', 'reel-hud-label', 'which color wins?'));
    st.layer.appendChild(hud);
    const board = raceBoard(pegs);
    let ranks = []; // the 1, 2, 3… under finished marbles
    let balls = [];
    let order = [];
    let clock = 0;
    let doneFor = 0; // seconds since the last marble finished
    let clackAt = 0; // when the last clack sounded
    let shownBig = '';

    function reset() {
      balls = v.racers.map(function (r, i) {
        return { name: r.name, c: r.colour, x: 125 + i * 72 + (rnd() - 0.5) * 12, y: 205, vx: (rnd() - 0.5) * 30, vy: 0, done: false };
      });
      order = [];
      clock = 0;
      doneFor = 0;
      shownBig = '';
      ranks.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
      ranks = [];
    }
    reset();

    function setBig(text, colour) {
      if (text === shownBig) return;
      shownBig = text;
      big.textContent = text;
      big.style.color = colour || '';
    }

    function physics(dt) {
      balls.forEach(function (b) {
        if (b.done) return;
        b.vy += 400 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        pegs.forEach(function (p) {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const d2 = dx * dx + dy * dy;
          const min = BALL_R + PEG_R;
          if (d2 >= min * min) return;
          const d = Math.sqrt(d2) || 1;
          const nx = dx / d;
          const ny = dy / d;
          b.x = p.x + nx * min;
          b.y = p.y + ny * min;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= 1.5 * vn * nx;
            b.vy -= 1.5 * vn * ny;
            b.vx += (rnd() - 0.5) * 40;
            if (vn < -60 && clock - clackAt > 0.04) {
              clackAt = clock;
              SFX.clack(Math.floor(p.y / 56) % 6);
            }
          }
        });
        if (b.x < 40 + BALL_R) { b.x = 40 + BALL_R; b.vx = Math.abs(b.vx) * 0.6; }
        if (b.x > W - 40 - BALL_R) { b.x = W - 40 - BALL_R; b.vx = -Math.abs(b.vx) * 0.6; }
        const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (sp > 650) { b.vx *= 650 / sp; b.vy *= 650 / sp; }
      });
      // Marbles bump each other.
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i];
          const b = balls[j];
          if (a.done || b.done) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d >= BALL_R * 2) continue;
          const nx = dx / d;
          const ny = dy / d;
          const push = (BALL_R * 2 - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            a.vx += rel * nx; a.vy += rel * ny;
            b.vx -= rel * nx; b.vy -= rel * ny;
          }
        }
      }
    }

    return {
      update: function (dt) {
        clock += dt;
        if (clock < RELEASE) {
          const left = String(3 - Math.floor(clock / (RELEASE / 3)));
          if (left !== shownBig) SFX.tick();
          setBig(left);
          return;
        }
        if (shownBig === '1') {
          setBig('GO!');
          SFX.pop();
        }
        for (let k = 0; k < 3; k++) physics(dt / 3);
        balls.forEach(function (b) {
          if (!b.done && b.y - BALL_R > FINISH) {
            b.done = true;
            order.push(b);
            b.x = 70 + (order.length - 1) * 88;
            b.y = FINISH + 36;
            const rank = h('div', 'reel-race-rank', String(order.length));
            rank.style.left = (b.x - 20) + 'px';
            rank.style.top = (b.y + 18) + 'px';
            st.layer.appendChild(rank);
            ranks.push(rank);
            if (order.length === 1) SFX.ding();
            else SFX.pop();
          }
        });
        if (order.length) {
          setBig(order[0].name + ' WINS!', order[0].c);
        } else if (clock > RELEASE + 0.8) {
          // Name whoever is lowest: the lead changes are the point.
          let lead = balls[0];
          balls.forEach(function (b) { if (b.y > lead.y) lead = b; });
          setBig(lead.name, lead.c);
        }
        if (order.length === balls.length) {
          doneFor += dt;
          if (doneFor > 3) reset(); // and race again
        }
      },
      draw: function (ctx) {
        ctx.drawImage(board, 0, 0, W, H);
        if (clock < RELEASE) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(40, 226, W - 80, 5);
        }
        balls.forEach(function (b) {
          circle(ctx, b.x, b.y, BALL_R, b.c);
          circle(ctx, b.x - 4, b.y - 5, 4, 'rgba(255, 255, 255, 0.7)');
        });
      }
    };
  }

  // ---- Only 1% can find the odd one out ---------------------------------------------

  function oddScene(v, st) {
    const card = h('div', 'reel-odd-card');
    const cells = [];
    for (let i = 0; i < v.cols * v.rows; i++) {
      const cell = h('span', 'reel-odd-cell', i === v.odd ? v.pair[1] : v.pair[0]);
      cells.push(cell);
      card.appendChild(cell);
    }
    st.layer.appendChild(card);
    const timer = h('div', 'reel-odd-timer', '10');
    st.layer.appendChild(timer);
    let shown = 10;
    let revealed = false;
    return {
      update: function (dt, t) {
        const left = clamp(Math.ceil(10 - (t - v.start)), 0, 10);
        if (left !== shown) {
          shown = left;
          timer.textContent = String(left);
          if (left > 0) SFX.tick();
          timer.classList.toggle('is-low', left <= 3);
        }
        if (!revealed && t >= v.start + 10) {
          revealed = true;
          card.classList.add('is-revealed');
          cells[v.odd].classList.add('is-odd');
          SFX.buzzer();
          SFX.boom();
        }
      },
      draw: function (ctx, t) {
        const bg = ctx.createRadialGradient(W / 2, 500, 20, W / 2, 500, 760);
        bg.addColorStop(0, '#FFE066');
        bg.addColorStop(1, '#F76707');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.translate(W / 2, 500);
        ctx.rotate(t * 0.25);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        for (let k = 0; k < 16; k++) {
          const a = k * TAU / 16;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 900, a, a + TAU / 32);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    };
  }

  // ---- Sigma rule (black and white, grain, a moai, flashes on the beat) -------------

  // The moai, from the :moai: emoji's 24-unit drawing.
  const MOAI = {
    head: 'M7 4.5C7 3 8.5 2 12 2s5 1 5 2.5V20l1 2H6l1-2z',
    brow: 'M7 6.5h10v2.2H7z',
    face: 'M8.3 9.6h2.6v1.2H8.3zM13.1 9.6h2.6v1.2h-2.6zM11.2 10.5h1.6l.7 5h-3zM9.5 17.3h5v1.1h-5z'
  };
  let grainUrl = null;

  // Film grain as a small PNG, made once; CSS moves it (cheap on the TV,
  // where filling the canvas with a pattern every frame was far too slow).
  function grain() {
    if (grainUrl) return grainUrl;
    const c = root.document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainUrl = c.toDataURL('image/png');
    return grainUrl;
  }

  // The lit moai, painted once per video.
  function paintMoai(ctx) {
    const light = ctx.createRadialGradient(W / 2, 420, 30, W / 2, 420, 520);
    light.addColorStop(0, '#3A3A3A');
    light.addColorStop(1, '#0A0A0A');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, H);
    const head = new root.Path2D(MOAI.head);
    const s = 21;
    ctx.save();
    ctx.translate(W / 2 - 12 * s, 600 - 12 * s);
    ctx.scale(s, s);
    ctx.fillStyle = '#9A9A9A';
    ctx.fill(head);
    ctx.save();
    ctx.clip(head);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.fillRect(12.4, 0, 12, 24);
    ctx.restore();
    ctx.fillStyle = '#626262';
    ctx.fill(new root.Path2D(MOAI.brow));
    ctx.fillStyle = '#262626';
    ctx.fill(new root.Path2D(MOAI.face));
    ctx.restore();
    const vignette = ctx.createRadialGradient(W / 2, 560, 160, W / 2, 560, 700);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  // The picture is painted once; the slow zoom and the white flashes on the
  // beat are CSS transform and opacity, which the TV composites without
  // redrawing anything.
  function sigmaScene(v, st) {
    const flash = h('div', 'reel-flash');
    st.layer.appendChild(flash);
    const film = h('div', 'reel-grain');
    film.style.backgroundImage = 'url(' + grain() + ')';
    st.layer.appendChild(film);
    st.layer.appendChild(h('div', 'reel-sigma-title', 'SIGMA RULE #' + v.rule));
    const canvas = st.ctx.canvas;
    canvas.style.transformOrigin = (W / 2) + 'px 600px';
    canvas.style.willChange = 'transform';
    let painted = false;
    let beats = -1;
    return {
      update: function (dt, t) {
        const n = Math.floor(t / (BEAT * 4));
        if (n !== beats) {
          beats = n;
          SFX.boom();
          SFX.horn();
        }
      },
      draw: function (ctx, t) {
        if (!painted) {
          paintMoai(ctx);
          painted = true;
        }
        canvas.style.transform = 'scale(' + (1 + t * 0.014).toFixed(4) + ')';
        const f = Math.max(0, 1 - (t % (BEAT * 4)) / (BEAT * 4) * 5);
        flash.style.opacity = (f * 0.45).toFixed(3);
      }
    };
  }

  // ---- Two more Italian brainrot characters ------------------------------------------

  K.CHARACTERS.patapim = {
    bg: ['#B7E4C7', '#1B4332'],
    sound: 'stomp',
    draw: function (ctx, t) {
      // A tree with a face and enormous feet, stomping on the beat.
      const step = Math.sin(t * Math.PI / BEAT);
      [-1, 1].forEach(function (side) {
        const lift = Math.max(0, step * side) * 30;
        ctx.strokeStyle = '#7F5539';
        ctx.lineWidth = 18;
        ctx.beginPath();
        ctx.moveTo(side * 34, 150);
        ctx.lineTo(side * 52, 205 - lift);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(side * 70, 215 - lift, 62, 26, 0, 0, TAU);
        ctx.fillStyle = '#F4A6A6';
        ctx.fill();
      });
      ctx.strokeStyle = '#7F5539';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(-55, -60);
      ctx.lineTo(-150, -130 + step * 12);
      ctx.moveTo(55, -60);
      ctx.lineTo(150, -130 - step * 12);
      ctx.stroke();
      circle(ctx, -150, -140 + step * 12, 34, '#52B788');
      circle(ctx, 150, -140 - step * 12, 34, '#52B788');
      rrect(ctx, -62, -130, 124, 290, 40);
      ctx.fillStyle = '#7F5539';
      ctx.fill();
      ctx.strokeStyle = '#5E3B26';
      ctx.lineWidth = 4;
      [-30, 20].forEach(function (x) {
        ctx.beginPath();
        ctx.moveTo(x, 40);
        ctx.quadraticCurveTo(x + 10, 90, x - 4, 150);
        ctx.stroke();
      });
      [[-70, -180, 70], [0, -230, 80], [70, -180, 70], [-35, -140, 60], [40, -140, 60]].forEach(function (c) {
        circle(ctx, c[0], c[1], c[2], '#40916C');
      });
      ctx.beginPath();
      ctx.ellipse(0, -30, 52, 46, 0, 0, TAU);
      ctx.fillStyle = '#DDB892';
      ctx.fill();
      eye(ctx, -20, -45, 15, 1);
      eye(ctx, 20, -45, 15, 1);
      circle(ctx, -6, -18, 4, '#5E3B26');
      circle(ctx, 6, -18, 4, '#5E3B26');
      ctx.beginPath();
      ctx.ellipse(0, 2, 16, 8 + Math.abs(step) * 6, 0, 0, TAU);
      ctx.fillStyle = '#5E3B26';
      ctx.fill();
    }
  };

  K.CHARACTERS.assassino = {
    bg: ['#6C757D', '#0B0B0D'],
    sound: 'swish',
    draw: function (ctx, t) {
      // A cappuccino in a ninja suit, swinging two katanas.
      const slash = Math.sin(t * TAU / (BEAT * 2));
      [-1, 1].forEach(function (side) {
        ctx.save();
        ctx.translate(side * 62, -10);
        ctx.rotate(side * (0.5 + slash * 0.7));
        ctx.fillStyle = '#E9ECEF';
        ctx.fillRect(-4, -230, 8, 220);
        ctx.fillStyle = '#ADB5BD';
        ctx.fillRect(2, -230, 2, 220);
        ctx.fillStyle = '#C9A227';
        ctx.fillRect(-14, -12, 28, 8);
        ctx.fillStyle = '#212529';
        ctx.fillRect(-5, -4, 10, 40);
        ctx.restore();
      });
      ctx.strokeStyle = '#1F1F24';
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(-22, 110);
      ctx.lineTo(-40, 200);
      ctx.moveTo(22, 110);
      ctx.lineTo(40, 200);
      ctx.moveTo(-38, -20);
      ctx.lineTo(-62, 0);
      ctx.moveTo(38, -20);
      ctx.lineTo(62, 0);
      ctx.stroke();
      rrect(ctx, -46, -50, 92, 170, 26);
      ctx.fillStyle = '#1F1F24';
      ctx.fill();
      ctx.fillStyle = '#E63946';
      ctx.fillRect(-46, 20, 92, 12);
      poly(ctx, [-70, -210, 70, -210, 56, -60, -56, -60], '#F4EDE4');
      ctx.beginPath();
      ctx.ellipse(0, -210, 70, 16, 0, 0, TAU);
      ctx.fillStyle = '#6F4E37';
      ctx.fill();
      // The headband, its tails flying.
      ctx.fillStyle = '#E63946';
      poly(ctx, [-68, -175, 68, -175, 66, -152, -66, -152], '#E63946');
      ctx.strokeStyle = '#E63946';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(66, -165);
      ctx.quadraticCurveTo(120, -190 + slash * 20, 160, -150 + slash * 30);
      ctx.moveTo(66, -160);
      ctx.quadraticCurveTo(110, -150 - slash * 20, 150, -110 - slash * 20);
      ctx.stroke();
      eye(ctx, -22, -122, 13, 1);
      eye(ctx, 22, -122, 13, 1);
      ctx.strokeStyle = '#1F1F24';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-40, -146);
      ctx.lineTo(-8, -134);
      ctx.moveTo(40, -146);
      ctx.lineTo(8, -134);
      ctx.stroke();
    }
  };

  CH.reel.scenes.texting = textingScene;
  CH.reel.scenes.sand = sandScene;
  CH.reel.scenes.race = raceScene;
  CH.reel.scenes.odd = oddScene;
  CH.reel.scenes.sigma = sigmaScene;
})(typeof window !== 'undefined' ? window : globalThis);
