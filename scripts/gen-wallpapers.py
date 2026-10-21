"""Renders the Ambient screen's wallpapers, as stills and as moving layers:

  app/img/ambient-<id>.jpg      1920x1080 still (Wallpaper motion: Off)
  app/img/thumb-wall-<id>.jpg   240x135 swatch for the Settings row
  app/img/wall/<id>/*.jpg|webp  the layers the TV moves (Wallpaper motion: On)
  app/js/walls.js               where each layer goes and how it moves

Kinds, matching CH.options.wallpaper in app/js/options.js:
- dark (lamp, midnight; black needs no file): almost entirely pure black, so
  a local-dimming TV can switch most of its backlight zones off. Their motion
  is small: dust rising in the lamp light, stars twinkling in sets, the odd
  shooting star.
- night scenes (streetlamp, moonrise, lighthouse, fireflies): dark like
  Lamp, one light in the dark, but each a place. Snow falls through the
  lamplight, clouds cross the moon, the beam sweeps, fireflies blink.
- scenes (sunset, coast, dunes, aurora, rain): full colour, each moving the
  way its subject would: clouds and mist drift with the wind, swell rolls in
  to the shore, sand streams off the dune crests, the aurora's ribbons fold
  past each other, traffic runs both ways and drops cling then run.

The TV only ever slides (transform) or fades (opacity) these layers, the
cheapest motion it can do. A drifting layer is two copies of a seamless
tile side by side, slid one tile per cycle, so it never jumps; a rolling
one is the same top to bottom. Things that twinkle are split into sets on
unrelated periods, so nothing pulses in unison.

Everything is procedural, so there are no image licences to track.
  python3 scripts/gen-wallpapers.py                  # all of them
  python3 scripts/gen-wallpapers.py --only coast,dunes
  python3 scripts/gen-wallpapers.py --sheet          # also dist/wallpapers.jpg
Needs numpy, scipy and Pillow (with WebP).
"""
import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.interpolate import PchipInterpolator

W, H = 1920, 1080
TILE = W  # one period of a drifting layer
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "img"
WALLS_JS = ROOT / "app" / "js" / "walls.js"
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
THUMB = (240, 135)


# ---- Building blocks --------------------------------------------------------

def rgb(value):
    value = value.lstrip("#")
    return np.array([int(value[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def gradient(stops, at):
    """Colour along `at` (any shape) through [(position, '#rrggbb')] stops,
    with a smooth (monotone cubic) blend so no Mach bands show at the stops."""
    pos = np.array([s[0] for s in stops], np.float32)
    cols = np.array([rgb(s[1]) for s in stops])
    out = np.empty(np.shape(at) + (3,), np.float32)
    clipped = np.clip(at, pos[0], pos[-1])
    for c in range(3):
        out[..., c] = PchipInterpolator(pos, cols[:, c])(clipped)
    return out


def vertical(stops):
    """A full-frame top-to-bottom gradient; stop positions are 0..1 of the height."""
    col = gradient(stops, np.arange(H, dtype=np.float32) / H)
    return np.broadcast_to(col[:, None, :], (H, W, 3)).copy()


class Noise:
    """Value noise on a wrapping random lattice, smooth (quintic) between
    lattice points; fbm() sums octaves. Roughly -1..1. With wrap_x=k, it
    repeats every k units in x: sample x as px * k / TILE for a seamless tile;
    wrap_y does the same in y."""

    def __init__(self, seed, size=256, wrap_x=None, wrap_y=None):
        self.size = wrap_y or size
        self.wrap = wrap_x or size
        self.table = np.random.default_rng(seed).uniform(-1, 1, (self.size, self.wrap)).astype(np.float32)

    def __call__(self, x, y):
        x = np.asarray(x, np.float32)
        y = np.asarray(y, np.float32)
        x0 = np.floor(x)
        y0 = np.floor(y)
        fx = x - x0
        fy = y - y0
        fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        xi = x0.astype(np.int64) % self.wrap
        yi = y0.astype(np.int64) % self.size
        xj = (xi + 1) % self.wrap
        yj = (yi + 1) % self.size
        t = self.table
        top = t[yi, xi] + (t[yi, xj] - t[yi, xi]) * fx
        bottom = t[yj, xi] + (t[yj, xj] - t[yj, xi]) * fx
        return top + (bottom - top) * fy

    def fbm(self, x, y, octaves, gain=0.5):
        total = 0
        amp = 1.0
        norm = 0.0
        for o in range(octaves):
            f = 2 ** o
            # Offset each octave so their lattice points don't line up.
            total = total + amp * self(x * f + 17.3 * o, y * f + 31.7 * o)
            norm += amp
            amp *= gain
        return total / norm


def over(img, colour, alpha):
    """Paints `colour` (3,) or (..., 3) over img with coverage alpha (...)."""
    a = alpha[..., None]
    return img * (1 - a) + colour * a


def glow(img, cx, cy, radius, colour, strength):
    """Adds a soft Gaussian glow, the way light adds."""
    d2 = ((XX - cx) ** 2 + (YY - cy) ** 2) / (radius * radius)
    img += (np.exp(-d2 * 2.2) * strength)[..., None] * rgb(colour)


def screen(img, light):
    """Screen blend: light adds up without blowing out to flat white."""
    return 1 - (1 - np.clip(img, 0, 1)) * (1 - np.clip(light, 0, 1))


def blur(arr, radius, wrap=False, scale=4):
    """A wide Gaussian blur of an (h, w) or (h, w, 3) array, done downscaled.
    wrap=True treats the array as a seamless horizontal tile."""
    h, w = arr.shape[:2]
    pad = (-h) % scale
    a = np.concatenate([arr, np.repeat(arr[-1:], pad, axis=0)]) if pad else arr
    small = a.reshape((a.shape[0] // scale, scale, w // scale, scale) + a.shape[2:]).mean(axis=(1, 3))
    modes = ["nearest", "wrap"] + (["nearest"] if small.ndim == 3 else [])
    sigma = [radius / scale, radius / scale] + ([0] if small.ndim == 3 else [])
    small = gaussian_filter(small.astype(np.float32), sigma, mode=modes)
    # Back up to full size by linear interpolation, wrapping in x if asked.
    sy = (np.arange(a.shape[0]) + 0.5) / scale - 0.5
    sx = (np.arange(w) + 0.5) / scale - 0.5
    rows = np.empty((small.shape[0], w) + small.shape[2:], np.float32)
    xs = np.arange(small.shape[1], dtype=np.float32)
    for i in range(small.shape[0]):
        if small.ndim == 3:
            for c in range(small.shape[2]):
                rows[i, :, c] = np.interp(sx, xs, small[i, :, c], period=small.shape[1] if wrap else None)
        else:
            rows[i] = np.interp(sx, xs, small[i], period=small.shape[1] if wrap else None)
    y0 = np.clip(np.floor(sy).astype(int), 0, small.shape[0] - 1)
    y1 = np.clip(y0 + 1, 0, small.shape[0] - 1)
    fy = np.clip(sy - np.floor(sy), 0, 1).reshape((-1, 1) + (1,) * (small.ndim - 2))
    out = rows[y0] * (1 - fy) + rows[y1] * fy
    return out[:h]


def below(line, supersample=3):
    """Antialiased coverage (H, W) of everything below a skyline. `line(x)`
    gives the skyline's y for float x; sampled several times per pixel so
    steep slopes stay smooth too."""
    cov = np.zeros((H, W), np.float32)
    for k in range(supersample):
        x = np.arange(W, dtype=np.float32) + (k + 0.5) / supersample - 0.5
        cov += np.clip(YY - line(x)[None, :] + 0.5, 0, 1)
    return cov / supersample


def disc(cx, cy, r, soft=1.0):
    """Antialiased filled circle coverage (H, W)."""
    d = np.sqrt((XX - cx) ** 2 + (YY - cy) ** 2)
    return np.clip((r - d) / soft + 0.5, 0, 1)


def vignette_factor(strength):
    d = np.sqrt(((XX - W / 2) / (W / 2)) ** 2 + ((YY - H / 2) / (H / 2)) ** 2) / math.sqrt(2)
    return 1 - strength * smoothstep(0.45, 1.0, d)


def light_rgba(light):
    """Light that adds onto what's below, as colour + alpha: over a dark
    background it composites the way screen blending would."""
    a = np.clip(light.max(axis=-1), 0, 1)
    c = np.clip(light / np.maximum(a, 1e-4)[..., None], 0, 1)
    return np.concatenate([c, a[..., None]], axis=-1)


def rgba(colour, alpha):
    colour = np.broadcast_to(colour, alpha.shape + (3,))
    return np.concatenate([colour, np.clip(alpha, 0, 1)[..., None]], axis=-1).astype(np.float32)


def tile2(arr):
    """Two copies of a seamless tile side by side: what a drifting layer shows."""
    return np.concatenate([arr, arr], axis=1)


def tile2v(arr):
    """Two copies of a seamless tile, one above the other: a sinking layer."""
    return np.concatenate([arr, arr], axis=0)


# ---- Layered wallpapers ----------------------------------------------------------

# CSS animations (keyframes in app/css/app.css). Drifts move left to right.
def drift(seconds, delay=0.0, period=TILE):
    return f"wall-drift-{period} {seconds}s linear {-delay}s infinite"


def roll(seconds, delay=0.0, period=240):
    """Slides a layer down one tile per cycle (keyframes wall-roll-<period>)."""
    return f"wall-roll-{period} {seconds}s linear {-delay}s infinite"


def sink(seconds, delay=0.0, period=720):
    """Slides down one tile per cycle (snow)."""
    return f"wall-sink-{period} {seconds}s linear {-delay}s infinite"


def pulse(kind, seconds, delay=0.0):
    """kind: 'pulse' (to 12%), 'glimmer' (to 40%) or 'breathe' (to 72%)."""
    return f"wall-{kind} {seconds}s ease-in-out {-delay}s infinite"


def check_seam(name, pic, period):
    """A drifting layer must be a seamless tile: crossing from its last
    column to its first may change no more than neighbouring columns do."""
    assert pic.shape[1] == 2 * period, f"{name}: {pic.shape[1]} px wide, not two {period} px tiles"
    seam = np.abs(pic[:, period - 1] - pic[:, period]).max()
    steps = np.abs(np.diff(pic[:, :period], axis=1)).max(axis=(0, 2))
    allowed = np.percentile(steps, 99.5) * 1.5 + 1e-3
    if seam > allowed:
        raise SystemExit(f"{name}: seam {seam:.4f} where neighbouring columns differ by up to {allowed:.4f}")


class Scene:
    """A wallpaper as a static base and layers above it. Each layer is a
    picture (rgba, straight alpha) placed at x, y, with a CSS animation, or
    an effect drawn by CSS alone (raindrops, a shooting star)."""

    def __init__(self, name, base, dark=False):
        self.name = name
        self.base = base
        self.dark = dark  # dither only where there is light: black stays black
        self.layers = []

    def add(self, key, pic, x=0, y=0, anim="", still=1.0, lossless=False, box=None, mask=None, origin=None):
        """still: the layer's opacity in the still picture (Motion: Off).
        box: (x, y, w, h) that clips it, maybe with a CSS mask as a fifth item.
        mask: an (h, w) coverage the size of the box that stays put while the
        picture moves under it. origin: the CSS transform-origin it turns about."""
        if anim.startswith("wall-drift"):
            check_seam(f"{self.name}/{key}", pic, int(anim.split()[0].rsplit("-", 1)[1]))
        if anim.startswith("wall-roll") or anim.startswith("wall-sink"):
            check_seam(f"{self.name}/{key}", pic.transpose(1, 0, 2), int(anim.split()[0].rsplit("-", 1)[1]))
        self.layers.append(dict(key=key, pic=pic, x=x, y=y, anim=anim, still=still,
                                lossless=lossless, box=box, mask=mask, origin=origin))

    def effect(self, kind, **params):
        self.layers.append(dict(key=kind, kind=kind, params=params))

    def still(self):
        """The first frame: base plus every picture layer where it starts
        (a drift starts one tile left, which looks the same: it's seamless)."""
        img = self.base.copy()
        for l in self.layers:
            if "pic" not in l or l["still"] <= 0:
                continue
            pic, x, y = l["pic"], l["x"], l["y"]
            mask = None
            if l["box"]:
                bx, by, bw, bh = l["box"][:4]
                pic = pic[max(-y, 0):bh - y, max(-x, 0):bw - x]
                x, y = bx + max(x, 0), by + max(y, 0)
                if l["mask"] is not None:
                    mask = np.zeros((H, W), np.float32)
                    mask[by:by + bh, bx:bx + bw] = l["mask"][:H - by, :W - bx]
            h, w = pic.shape[:2]
            x0, y0 = max(x, 0), max(y, 0)
            x1, y1 = min(x + w, W), min(y + h, H)
            if x1 <= x0 or y1 <= y0:
                continue
            part = pic[y0 - y:y1 - y, x0 - x:x1 - x]
            a = part[..., 3] * l["still"]
            if mask is not None:
                a = a * mask[y0:y1, x0:x1]
            img[y0:y1, x0:x1] = over(img[y0:y1, x0:x1], part[..., :3], a)
        return img


def save_rgb(img, path, quality=88, keep_black=False):
    """Dithered to 8 bits (no banding in big skies), 4:4:4 so thin lines keep
    their colour. keep_black: no dither where it's black."""
    rng = np.random.default_rng(99)
    arr = np.clip(img, 0, 1) * 255
    noise = rng.uniform(-0.5, 0.5, arr.shape) + rng.uniform(-0.5, 0.5, arr.shape)
    arr = np.where(arr.max(axis=-1, keepdims=True) > 0.2, arr + noise, arr) if keep_black else arr + noise
    out = Image.fromarray(np.clip(np.rint(arr), 0, 255).astype(np.uint8), "RGB")
    out.save(path, quality=quality, optimize=True, progressive=True, subsampling=0)
    return out


def save_rgba(pic, path, lossless=False):
    rng = np.random.default_rng(98)
    arr = np.clip(pic, 0, 1) * 255
    arr[..., :3] += rng.uniform(-0.5, 0.5, arr[..., :3].shape) + rng.uniform(-0.5, 0.5, arr[..., :3].shape)
    im = Image.fromarray(np.clip(np.rint(arr), 0, 255).astype(np.uint8), "RGBA")
    if lossless:
        im.save(path, "WEBP", lossless=True, quality=100, method=6)
    else:
        im.save(path, "WEBP", quality=88, alpha_quality=90, method=6)


def save_mask(cov, path):
    """A CSS mask: white, with the coverage as alpha."""
    a = np.clip(np.rint(np.clip(cov, 0, 1) * 255), 0, 255).astype(np.uint8)
    im = Image.fromarray(np.dstack([np.full_like(a, 255)] * 3 + [a]), "RGBA")
    im.save(path, "WEBP", quality=80, alpha_quality=70, method=6)


def write_scene(scene):
    """Writes the base, the layers and the still; returns walls.js entries."""
    folder = OUT / "wall" / scene.name
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    save_rgb(scene.base, folder / "base.jpg", quality=86, keep_black=scene.dark)
    entries = [dict(src=f"img/wall/{scene.name}/base.jpg", x=0, y=0, w=W, h=H)]
    pixels = W * H
    for l in scene.layers:
        if "kind" in l:
            entries.append(dict(kind=l["kind"], **l["params"]))
            continue
        pic = l["pic"]
        h, w = pic.shape[:2]
        name = f"{l['key']}.webp"
        save_rgba(pic, folder / name, l["lossless"])
        e = dict(src=f"img/wall/{scene.name}/{name}", x=l["x"], y=l["y"], w=w, h=h)
        if l["anim"]:
            e["anim"] = l["anim"]
        if l["origin"]:
            e["origin"] = l["origin"]
        if l["box"]:
            bx, by, bw, bh = l["box"][:4]
            e["box"] = dict(x=bx, y=by, w=bw, h=bh)
            if len(l["box"]) > 4:
                e["box"]["mask"] = l["box"][4]
            if l["mask"] is not None:
                mname = f"{l['key']}-mask.webp"
                save_mask(l["mask"], folder / mname)
                e["box"]["maskSrc"] = f"img/wall/{scene.name}/{mname}"
        entries.append(e)
        pixels += w * h
    still = scene.still()
    out = save_rgb(still, OUT / f"ambient-{scene.name}.jpg", keep_black=scene.dark)
    out.resize(THUMB, Image.LANCZOS).save(OUT / f"thumb-wall-{scene.name}.jpg", quality=88)
    size = sum(f.stat().st_size for f in folder.iterdir()) // 1024
    print(f"{scene.name}: {len(scene.layers)} layers, {pixels / 1e6:.1f} MP to composite, {size} KB "
          f"(still: average level {still.mean() * 100:.0f}%)")
    return entries


# ---- Scenes -----------------------------------------------------------------

def sunset():
    """Layered hills at sundown: the sun half behind the far ridge. Long thin
    clouds drift across, and mist drifts through each valley, the nearer
    the faster."""
    n = Noise(11)
    pn = Noise(12, wrap_x=3)
    img = vertical([(0.0, "#1C1846"), (0.22, "#3A2A6E"), (0.40, "#7E3F7F"), (0.52, "#C85A78"),
                    (0.60, "#F08A62"), (0.66, "#FFBE7E"), (1.0, "#FFD8A2")])
    sx, sy = 0.66 * W, 0.585 * H
    glow(img, sx, sy, 900, "#FF8F5A", 0.30)
    glow(img, sx, sy, 300, "#FFD29A", 0.40)
    img = over(img, rgb("#FFF2D2"), disc(sx, sy, 62, 1.2))
    fog = rgb("#F5A882")
    ridges = [  # base (fraction of height), height of hills (px), feature size (px), colour
        (0.600, 58, 520, "#C27493"),
        (0.655, 80, 460, "#94508A"),
        (0.725, 96, 420, "#6A3878"),
        (0.805, 104, 400, "#452760"),
        (0.900, 120, 460, "#251640"),
    ]
    xs = np.arange(W, dtype=np.float32)
    scene = Scene("sunset", None)
    # Clouds: a band of long thin streaks, lit from below by the low sun.
    r0, r1 = int(0.10 * H), int(0.50 * H)
    yy, xx = YY[r0:r1], XX[r0:r1]
    cl = pn.fbm(xx * 3 / TILE, yy / 26, 5)
    band = smoothstep(0.14 * H, 0.26 * H, yy) * (1 - smoothstep(0.40 * H, 0.48 * H, yy))
    amount = np.clip((cl - 0.12) * 2.4, 0, 1) * band * 0.6
    tint = gradient([(0.10, "#7A4A8E"), (0.32, "#D97C98"), (0.50, "#FFB68C")], yy / H)
    scene.add("clouds", tile2(rgba(tint, amount)), 0, r0, drift(300, 40))
    for i, (base, amp, size, colour) in enumerate(ridges):
        seed = 3.7 * (i + 1)

        def line(x, base=base, amp=amp, size=size, seed=seed):
            hills = n.fbm(x / size + seed, seed * 2, 5, 0.45)
            return base * H - amp * (0.55 + 0.75 * hills)

        cov = below(line)
        crest = line(xs)
        depth = YY - crest[None, :]
        # Mist in the valley in front of each ridge: lighter towards its foot.
        mist = smoothstep(0, 240, depth) * (0.42 - 0.07 * i)
        col = rgb(colour)[None, None, :] * (1 - mist[..., None]) + fog * mist[..., None]
        if i < 2:
            img = over(img, col, cov)
        else:
            # Mist drifting through the valley behind this ridge, then the ridge.
            mid = float(crest.mean())
            m0, m1 = int(mid - 120), int(mid + 70)
            my, mx = YY[m0:m1], XX[m0:m1]
            dens = pn.fbm(mx * 3 / TILE + 9 * i, my / 22 + 5 * i, 4)
            profile = np.exp(-((my - (mid - 18)) / 52) ** 2)
            alpha = np.clip((dens + 0.15) * 1.3, 0, 1) * profile * (0.30 + 0.05 * i)
            speed = {2: 260, 3: 200, 4: 150}[i]
            scene.add(f"mist{i}", tile2(rgba(rgb("#F7B394"), alpha)), 0, m0, drift(speed, 70 * i))
            top = int(crest.min()) - 2
            pic = rgba(col[top:], cov[top:])
            scene.add(f"ridge{i}", pic, 0, top)
    scene.base = img
    return scene


def coast():
    """Golden hour over open sea: a low sun, its path glittering on the
    water, a hazy headland on the left. Clouds drift, swell rolls in to the
    shore and the glitter sparkles."""
    n = Noise(23)
    pn = Noise(24, wrap_x=4)
    hz = int(0.60 * H)
    img = vertical([(0.0, "#28588A"), (0.25, "#5F8DB8"), (0.45, "#B4B6C2"), (0.56, "#EAC39E"),
                    (0.60, "#F6CF9E"), (1.0, "#F6CF9E")])
    sx, sy = 0.70 * W, hz - 64
    # Screen-blended, so the glow never goes flat white and the sun's disc
    # stays the brightest thing in the sky.
    light = np.zeros((H, W, 3), np.float32)
    glow(light, sx, sy, 1000, "#FF9E5E", 0.22)
    glow(light, sx, sy, 230, "#FFD9A0", 0.30)
    img = screen(img, light)
    img = over(img, rgb("#FFF8E8"), disc(sx, sy, 40, 1.2))

    def head(x):
        rise = (1 - smoothstep(0.12 * W, 0.40 * W, x)) * 52
        return hz - rise * (0.7 + 0.3 * n.fbm(x / 140, 5.5, 4)) + 1
    img = over(img, rgb("#7F8CA6"), below(head) * (YY < hz + 2))
    # Sea: hazy at the horizon, deep blue in front. Waves are noise laid out
    # in perspective: rows stretch apart as they come towards the viewer.
    z = np.maximum(YY - hz, 0)
    sea = gradient([(0.0, "#9DA7B4"), (12, "#6F8BA3"), (80, "#3C6385"), (432, "#17375A")], z)
    depth = 2600 / (z + 12)
    wx = (XX - W / 2) / (z + 12) * 7
    waves = n.fbm(wx / 6, depth / 1.4, 5)
    water = sea * (1 + 0.10 * waves[..., None])
    path = np.exp(-((XX - sx) / (22 + z * 0.55)) ** 2)
    water = water + (path * 0.18 * np.exp(-z / 380) * 0.9)[..., None] * rgb("#FFDDA6")
    water = over(water, rgb("#F2C29A"), np.exp(-z / 26) * 0.55)
    img = np.where((YY >= hz)[..., None], water, img)
    img = over(img, rgb("#D9B8A0"), np.exp(-((YY - hz) / 1.2) ** 2) * 0.35)
    scene = Scene("coast", img)
    # Clouds, warm underneath, drifting.
    r1 = int(0.50 * H)
    yy, xx = YY[:r1], XX[:r1]
    cl = pn.fbm(xx * 4 / TILE, yy / 90, 6)
    band = smoothstep(0.06 * H, 0.16 * H, yy) * (1 - smoothstep(0.36 * H, 0.48 * H, yy))
    amount = np.clip((cl - 0.05) * 1.8, 0, 1) * band * 0.75
    shade = gradient([(0.0, "#A9B9CF"), (0.30, "#E7C9B6"), (0.45, "#FBD7B2")], yy / H)
    scene.add("clouds", tile2(rgba(shade, amount)), 0, 0, drift(420, 120))
    # Swell rolling in. Waves come towards the shore at one speed, which on
    # screen is slow at the horizon and quicker close by, so the sea is cut
    # into bands, each a tile seamless top to bottom that slides down at its
    # own distance's speed; their soft edges overlap. Inside a band the
    # perspective is straightened out around its middle, close enough.
    P, toward = 240, 0.24  # tile height (px); swell speed (depth units a second)
    bands = [(10, 44), (36, 100), (90, 214), (200, 432)]  # rows below the horizon
    for k, (z0, z1) in enumerate(bands):
        zc = (z0 + z1) / 2
        lattice = max(1, round(P * 2600 / (zc + 12) ** 2 / 0.7))  # wave rows per tile
        per_px = lattice * 0.7 / P  # depth units per pixel
        wn = Noise(60 + k, wrap_y=lattice)
        j = np.arange(2 * P, dtype=np.float32)[:, None]
        v = (2600 / (zc + 12)) / 0.7 - (j - zc + z0) * per_px / 0.7
        u = ((XX[:1] - W / 2) / (zc + 12) * 7) / 3.2 + 30 + 11 * k
        # Ridged noise: long crests with troughs between them.
        crest = 1 - np.abs(wn.fbm(np.broadcast_to(u, (2 * P, W)), np.broadcast_to(v, (2 * P, W)), 3))
        sheen = np.clip((crest - 0.66) * 2.9, 0, 1) ** 1.6
        sheen = sheen * (0.045 + 0.045 * smoothstep(0, 200, zc))
        over_top = 0 if k == 0 else bands[k - 1][1] - z0
        over_bottom = 0 if k == len(bands) - 1 else z1 - bands[k + 1][0]
        hb = z1 - z0
        fade = np.ones(hb, np.float32)
        if over_top:
            fade *= smoothstep(0, over_top, np.arange(hb, dtype=np.float32))
        if over_bottom:
            fade *= 1 - smoothstep(hb - over_bottom, hb, np.arange(hb, dtype=np.float32))
        if k == 0:
            fade *= smoothstep(0, hb, np.arange(hb, dtype=np.float32))  # into the haze
        secs = round(P * per_px / toward, 1)
        scene.add(f"swell{k}", light_rgba(sheen[..., None] * rgb("#CFE2F2")), 0, 0, roll(secs, secs * 0.37 * k, P),
                  box=(0, hz + z0, W, hb), mask=np.broadcast_to(fade[:, None], (hb, W)))
    # The sun's path: three glitter patterns, each flickering on its own
    # period, so it sparkles without ever pulsing as one.
    span = (22 + 432 * 0.55) * 2.6
    x0, x1 = int(max(sx - span, 0)), int(min(sx + span, W))
    sea_rows = slice(hz, H)
    zz, wxx, dd = z[sea_rows], wx[sea_rows], depth[sea_rows]
    for k, (secs, delay) in enumerate([(1.9, 0.0), (2.6, 0.9), (3.5, 2.1)]):
        g = np.clip((n.fbm(wxx[:, x0:x1] / 0.45 + 50 + 40 * k, dd[:, x0:x1] / 0.22 + 13 * k, 3) - 0.22) * 4.5, 0, 1) ** 2
        shine = path[sea_rows, x0:x1] * g * np.exp(-zz[:, x0:x1] / 380) * 0.75
        pic = light_rgba(shine[..., None] * rgb("#FFDDA6"))
        scene.add(f"glint{k}", pic, x0, hz, pulse("glimmer", secs, delay), still=1.0 if k == 0 else 0.7)
    return scene


def dunes():
    """Bright desert in the afternoon: a field of crescent dunes in
    perspective, rendered from a height map, each with a long sunlit windward
    slope, a sharp crest and a steep slip face in shade, ripples on the near
    ones. The wind blows left to right: sand streams off the near crests and
    high cirrus drifts over."""
    hz = 0.455 * H  # the horizon
    f, cam = 1150.0, 64.0  # focal length (px) and eye height (m)
    lam, amp, crest_at = 170.0, 30.0, 0.74  # dune spacing and height (m); crest along each dune
    wa = math.radians(28)  # the wind blows right and a little away
    wx, wz = math.cos(wa), math.sin(wa)
    warp, ampn, roll = Noise(37), Noise(38), Noise(39)

    def profile(t):
        """Height 0..1 along one dune: a long windward rise to a sharp crest,
        then a short steep slip face back down."""
        rise = np.sin(np.clip(t / crest_at, 0, 1) * math.pi / 2) ** 1.6
        fall = np.cos(np.clip((t - crest_at) / (1 - crest_at), 0, 1) * math.pi / 2) ** 0.7
        return np.where(t < crest_at, rise, fall)

    def field(X, Z):
        """Ground height (m), and phase along the dune train, at world X, Z."""
        along = X * wx + Z * wz
        across = Z * wx - X * wz
        s = along / lam + 0.55 * warp.fbm(across / 520, along / 900, 3)
        k = np.floor(s)
        size = 0.55 + 0.45 * (0.5 + 0.5 * ampn.fbm(across / 380 + k * 3.1, k * 1.7, 2))
        ground = 4 * roll.fbm(X / 1400, Z / 1400, 2)
        return size * amp * profile(s - k) + ground, s, size

    # March each column of pixels (at 2x, for smooth edges) from near to far:
    # a row shows the nearest ground that rises into it.
    ss = 2
    cols = (np.arange(W * ss, dtype=np.float32) + 0.5) / ss - W / 2
    zs = np.geomspace(6, 9000, 1600).astype(np.float32)
    h_s, _, _ = field(cols[None, :] * zs[:, None] / f, zs[:, None])
    y_s = hz + (cam - h_s) * f / zs[:, None]
    ybuf = np.minimum.accumulate(y_s, axis=0)
    rows = (np.arange(H * ss, dtype=np.float32) + 0.5) / ss
    zhit = np.full((H * ss, W * ss), np.inf, np.float32)
    for c in range(W * ss):
        k = np.searchsorted(-ybuf[:, c], -rows, side="left")
        hit = k < len(zs)
        k1 = np.clip(k, 1, len(zs) - 1)
        k0 = k1 - 1
        # Where the ray from this pixel meets the ground between two samples.
        d0 = cam - (rows - hz) * zs[k0] / f - h_s[k0, c]
        d1 = cam - (rows - hz) * zs[k1] / f - h_s[k1, c]
        t = np.clip(d0 / np.where(d0 - d1 == 0, 1, d0 - d1), 0, 1)
        z = zs[k0] + t * (zs[k1] - zs[k0])
        zhit[:, c] = np.where(hit, np.where(k == 0, zs[0], z), np.inf)
    ground = np.isfinite(zhit)
    Zg = np.where(ground, zhit, 1.0)
    Xg = (cols[None, :] * Zg) / f
    hgt, s, size = field(Xg, Zg)
    e = 0.25
    hx = (field(Xg + e, Zg)[0] - field(Xg - e, Zg)[0]) / (2 * e)
    hzd = (field(Xg, Zg + e)[0] - field(Xg, Zg - e)[0]) / (2 * e)
    # Ripples on the windward slopes near by, fading before they'd alias.
    t = s - np.floor(s)
    along = Xg * wx + Zg * wz
    near = 1 - smoothstep(160, 460, Zg)
    rip = np.sin(along / 1.9 * 2 * math.pi + 5 * warp.fbm(Xg / 14 + 7, Zg / 14, 3))
    rip = rip * near * (t < crest_at - 0.03) * 0.06 * (0.4 + 0.6 * smoothstep(-0.3, 0.4, roll.fbm(Xg / 40, Zg / 40, 2)))
    hx, hzd = hx + rip * wx, hzd + rip * wz
    nrm = np.stack([-hx, np.ones_like(hx), -hzd])
    nrm /= np.linalg.norm(nrm, axis=0)
    sun = np.array([-0.66, 0.30, -0.22], np.float32)  # low, behind the left shoulder
    sun /= np.linalg.norm(sun)
    lam_ = np.clip(np.tensordot(sun, nrm, 1), 0, 1)
    # The slip face's shadow reaches onto the next windward slope when the sun
    # is lower than the face is steep: compare the crest's height with the
    # sun's rise over the distance back to it.
    sun_up = sun[1] / math.hypot(sun[0], sun[2])
    sun_wind = max(-(sun[0] * wx + sun[2] * wz) / math.hypot(sun[0], sun[2]), 0.2)
    back = np.where(t >= crest_at, t - crest_at, t + 1 - crest_at) * lam / sun_wind
    crest_h = size * amp
    cast = smoothstep(-0.6, 0.6, crest_h * (1 - profile(t)) - back * sun_up)
    cast = cast * (t < 0.42)  # only onto the foot of the next windward slope
    light = lam_ * (1 - cast)
    lit, shade, bounce = rgb("#F4BC7E"), rgb("#9C6448"), rgb("#C98A62")
    col = shade + (lit - shade) * np.clip(light * 1.35, 0, 1)[..., None]
    # Sand lights up the slip faces a little from below.
    col = col + (bounce - shade) * (0.35 * (1 - light) * smoothstep(0.6, 1.0, nrm[1]))[..., None]
    # Air: distant dunes pale into the haze of the horizon.
    haze = 1 - np.exp(-Zg / 2600)
    col = col * (1 - haze[..., None] * 0.85) + rgb("#F1D8BE") * (haze[..., None] * 0.85)
    sky = vertical([(0.0, "#3D7DC0"), (0.24, "#73A7D8"), (0.40, "#C3D5E2"), (0.455, "#F2DCC2"), (1.0, "#F2DCC2")])
    glow(sky, 260, -200, 1000, "#FFF6E2", 0.22)
    big = np.where(ground[..., None], col, np.repeat(np.repeat(sky, ss, 0), ss, 1))
    img = big.reshape(H, ss, W, ss, 3).mean(axis=(1, 3))
    scene = Scene("dunes", img)
    # High cirrus: thin streaks, slow.
    pn3, pn2 = Noise(40, wrap_x=3), Noise(41, wrap_x=2)
    r1 = int(0.40 * H)
    yy, xx = YY[:r1], XX[:r1]
    ci = pn3.fbm(xx * 3 / TILE, yy / 20, 5)
    stretch = pn2.fbm(xx * 2 / TILE + 4, yy / 60 + 2, 2)
    amount = np.clip((ci - 0.18) * 2.2, 0, 1) * np.clip(stretch + 0.6, 0, 1)
    amount *= smoothstep(0.03 * H, 0.10 * H, yy) * (1 - smoothstep(0.28 * H, 0.38 * H, yy)) * 0.42
    scene.add("cirrus", tile2(rgba(rgb("#FFFFFF"), amount)), 0, 0, drift(540, 200))
    # Spindrift: sand streaming off the near crests. Fine streaks race left
    # to right under a mask that only opens just downwind of each crest, so
    # the plumes stay on the ridges while the sand in them flies.
    crest = np.exp(-(((t - crest_at) * lam * size) / 2.2) ** 2) * (1 - smoothstep(380, 800, Zg)) * ground
    crest = crest.reshape(H, ss, W, ss).mean(axis=(1, 3))
    plume = np.zeros_like(crest)
    for dx, dy, wgt in [(0, 0, 1.0), (30, -4, 0.8), (70, -9, 0.55), (120, -15, 0.3), (180, -22, 0.15)]:
        plume = np.maximum(plume, np.roll(np.roll(crest, dx, axis=1), dy, axis=0) * wgt)
    plume = blur(plume, 10)
    plume = np.clip(plume / max(float(np.percentile(plume, 99.7)), 1e-3), 0, 1)
    r0 = int(hz) - 30
    mask = plume[r0:]
    pn8 = Noise(42, wrap_x=5)
    yy, xx = YY[r0:], XX[r0:]
    streak = pn8.fbm(xx * 5 / TILE, yy / 3.5, 3)
    amount = blur(np.clip((streak + 0.1) * 1.8, 0, 1) ** 1.4, 3, wrap=True, scale=1) * 0.42
    scene.add("drift", tile2(rgba(rgb("#FFF0DA"), amount)), 0, 0, drift(30, 10),
              box=(0, r0, W, H - r0), mask=mask, still=0.5)
    return scene


def spruce_line(n, ridge, count, rng):
    """Spruce silhouettes standing on a ridge: (H, W) coverage."""
    cov = np.zeros((H, W), np.float32)
    xs = np.sort(rng.uniform(0, W, count))
    for x0 in xs:
        # Taller at the sides, a gap in the middle for the view.
        edge = abs(x0 - W / 2) / (W / 2)
        ht = rng.uniform(40, 80) + 150 * edge ** 2.2 * rng.uniform(0.6, 1.1)
        base = float(ridge(np.array([x0], np.float32))[0]) + 6
        top = base - ht
        half = ht * rng.uniform(0.16, 0.22)
        y0, y1 = int(top) - 1, int(base) + 2
        x_lo, x_hi = int(x0 - half) - 2, int(x0 + half) + 3
        y0, x_lo, x_hi = max(y0, 0), max(x_lo, 0), min(x_hi, W)
        if x_hi <= x_lo:
            continue
        yy, xx = YY[y0:y1, x_lo:x_hi], XX[y0:y1, x_lo:x_hi]
        t = np.clip((yy - top) / ht, 0, 1)
        tier = ht / rng.uniform(6, 9)
        jag = 0.62 + 0.38 * (((yy - top) % tier) / tier)
        width = half * t * jag + 0.6
        c = np.clip(width - np.abs(xx - x0) + 0.5, 0, 1) * (yy >= top)
        cov[y0:y1, x_lo:x_hi] = np.maximum(cov[y0:y1, x_lo:x_hi], c)
    return cov


def mirror(rows_above, shore, n):
    """The rows above the shore, mirrored into the lake below it and broken
    by ripples (each row shifted sideways a little; shifts wrap)."""
    rows = np.arange(shore, H)
    src = np.clip(2 * shore - rows - 1, 0, shore - 1)
    refl = rows_above[src].copy()
    zr = (rows - shore).astype(np.float32)
    shift = (np.sin(zr * 0.9) * 1.5 + n.fbm(zr / 3, 4.4, 3) * 4) * smoothstep(0, 120, zr)
    for j, s in enumerate(shift.astype(int)):
        refl[j] = np.roll(refl[j], s, axis=0)
    return refl, zr


def aurora():
    """Northern lights over a still lake: green curtains fading to violet,
    stars, a spruce ridge, all mirrored in the water. Its two ribbons drift
    against each other and breathe out of step, the reflection with the
    low one; the brighter stars twinkle in sets."""
    n = Noise(41)
    rays_n, fold_n, along_n = Noise(42, wrap_x=74), Noise(44, wrap_x=6), Noise(45, wrap_x=3)
    rng = np.random.default_rng(41)
    shore = int(0.79 * H)
    sky = vertical([(0.0, "#02050E"), (0.40, "#051326"), (0.70, "#0A2538"), (0.79, "#0D2B3C"), (1.0, "#0D2B3C")])
    # Stars, thinning towards the horizon; the brighter ones twinkle.
    stars = np.zeros((H, W), np.float32)
    twinkle = [np.zeros((H, W), np.float32) for _ in range(3)]
    for i in range(520):
        x, y = rng.uniform(4, W - 4), rng.uniform(4, shore - 40)
        b = rng.pareto(2.2) * 0.18 + 0.12
        b *= 1 - 0.8 * smoothstep(0.50 * H, 0.76 * H, y)
        s = rng.uniform(0.55, 1.0)
        xi, yi = int(x), int(y)
        yy, xx = YY[yi - 3:yi + 4, xi - 3:xi + 4], XX[yi - 3:yi + 4, xi - 3:xi + 4]
        target = twinkle[i % 3] if b > 0.26 else stars
        target[yi - 3:yi + 4, xi - 3:xi + 4] += b * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * s * s))
    img = sky + stars[..., None] * rgb("#E6EEFF")
    # Faint green airglow low in the sky, so the dark below the curtains
    # reads as sky rather than as a hillside.
    air = np.exp(-((YY - (shore - 70)) / 150) ** 2) * 0.10
    img = screen(img, air[..., None] * rgb("#3FD9A0"))
    # The curtains: a seamless tile of folding ribbons. d = height above
    # each ribbon's lower edge.
    yy, xx = YY[:shore], XX[:shore]
    lights = []
    # The main ribbon comes down behind the treeline, as in a photo: a level
    # ribbon higher up leaves dark sky under it that reads as hills.
    ribbons = [  # lower edge (fraction of height), fold, folds per tile, ray height, strength
        (0.735, 40, 2, 500, 1.0),
        (0.40, 30, 3, 260, 0.42),
    ]
    for k, (level, amp, folds, tall, strength) in enumerate(ribbons):
        phase = 1.3 + 2.1 * k
        edge = (level * H + amp * np.sin(2 * math.pi * folds * xx / TILE + phase)
                + 34 * fold_n.fbm(xx * 6 / TILE + 10 * k, 3.3 * k, 3))
        d = edge - yy
        upper = np.exp(-np.maximum(d, 0) / tall)
        # Rays: fine vertical streaks, leaning slightly with height.
        rays = 0.45 + 0.55 * np.clip(0.5 + 0.9 * rays_n.fbm((xx + d * 0.18) * 74 / TILE + 70 * k, 1.7 * k, 4), 0, 1)
        # The lower fringe is ragged, the rays poking down through it, so it
        # never reads as the smooth outline of a hill.
        lower = smoothstep(-14, 6, d + 26 * (rays - 0.72)) ** 1.4
        along = np.clip(0.30 + 1.0 * along_n.fbm(xx * 3 / TILE + 40 * k, 8.8 * k, 3), 0, 1)
        # Light scattered below the fringe: the edge reads as something
        # glowing, not as a shape in front of it.
        spill = np.exp(np.minimum(d, 0) / 150) * 0.32 * (1 - lower)
        i_ = (lower * upper * rays + spill) * along * strength
        t = np.clip(d / (tall * 1.4), 0, 1)
        col = gradient([(0.0, "#46FFA8"), (0.25, "#2EE8B0"), (0.55, "#2FB8C8"), (1.0, "#8E5BFF")], t)
        one = i_[..., None] * col
        lights.append(one * 0.9 + blur(one, 40, wrap=True) * 0.4)
    # Ridge and trees, black against the glow.
    def ridge(x):
        return shore - 16 - 38 * (0.5 + 0.5 * n.fbm(x / 380 + 2.2, 9.1, 4)) * (0.4 + 0.6 * (np.abs(x - W / 2) / (W / 2)))
    land = np.maximum(below(ridge), spruce_line(n, ridge, 120, rng))
    # Lake: the sky (and stars, and airglow) mirrored, darkened, rippled.
    refl, zr = mirror(img[:shore], shore, n)
    dim = (0.55 - 0.15 * smoothstep(0, H - shore, zr))[:, None, None]
    ripple = np.clip(n.fbm(XX[shore:] / 300, (YY[shore:] - shore) / 4, 3) - 0.35, 0, 1)
    dim = dim * (1 - 0.35 * ripple[..., None])
    img[shore:] = refl * dim
    scene = Scene("aurora", img)
    # The moving reflection carries its own (seamless) ripples.
    rn = Noise(43, wrap_x=6)
    mdim = (0.55 - 0.15 * smoothstep(0, H - shore, zr))[:, None, None]
    mdim = mdim * (1 - 0.35 * np.clip(rn.fbm(XX[shore:] * 6 / TILE, (YY[shore:] - shore) / 4, 3) - 0.35, 0, 1)[..., None])
    # The brighter stars twinkle in three sets, each on its own period.
    for k, (secs, delay) in enumerate([(4.7, 1.0), (6.9, 3.1), (9.1, 6.0)]):
        scene.add(f"stars{k}", light_rgba(twinkle[k][:shore - 30, :, None] * rgb("#E6EEFF")), 0, 0,
                  pulse("glimmer", secs, delay))
    # The two ribbons drift against each other and breathe out of step, so
    # the curtains seem to fold rather than slide as one sheet. The main one
    # comes down to the trees, so its reflection moves with it; the high one
    # is reflected beyond the bottom of the screen.
    main = drift(240, 90) + ", " + pulse("breathe", 13, 3)
    scene.add("curtains", tile2(light_rgba(lights[0])), 0, 0, main)
    lrefl, _ = mirror(lights[0], shore, n)
    scene.add("mirror", tile2(light_rgba(lrefl * mdim)), 0, shore, main)
    top = int(0.66 * H)
    high = lights[1][:top] * (1 - smoothstep(top - 140, top, YY[:top]))[..., None]
    scene.add("curtains-high", tile2(light_rgba(high)), 0, 0,
              drift(410, 160) + " reverse, " + pulse("breathe", 17, 9))
    # Land in front, and its reflection, dark and broken by the same ripples.
    lref, _ = mirror(land[:shore][..., None], shore, n)
    shade = np.zeros((H, W), np.float32)
    shade[:shore] = land[:shore]
    shade[shore:] = lref[..., 0] * 0.92
    shade = np.maximum(shade, np.exp(-((YY - shore) / 1.5) ** 2) * 0.8)
    top = int(np.argmax(shade.max(axis=1) > 0.01)) - 2
    scene.add("land", rgba(rgb("#03080D"), shade[top:]), 0, top)
    return scene


def rain():
    """City lights out of focus through a rainy window at night: mostly warm
    street lamps and windows, a few signs. Traffic streams both ways on the
    street below, the nearer lights breathe in and out of focus in two sets,
    and drops cling to the glass, then run."""
    rng = np.random.default_rng(53)
    img = vertical([(0.0, "#05080F"), (0.40, "#0A111D"), (0.75, "#16131C"), (1.0, "#1E1517")])
    # The city's glow, low down.
    glow(img, W * 0.55, H * 1.05, 1100, "#5A3A24", 0.30)
    palette = [("#FFA238", 0.38), ("#FFD9A0", 0.24), ("#FF5236", 0.11), ("#2FD0BE", 0.06),
               ("#5C86FF", 0.09), ("#E0499F", 0.04), ("#FFCF4A", 0.08)]
    names = [p[0] for p in palette]
    weights = np.array([p[1] for p in palette])
    pick = lambda: rgb(names[rng.choice(len(names), p=weights / weights.sum())])
    far = np.zeros((H, W, 3), np.float32)
    near = [np.zeros((H, W, 3), np.float32), np.zeros((H, W, 3), np.float32)]
    for i in range(100):
        r = float(np.exp(rng.uniform(math.log(10), math.log(80))))
        x = rng.uniform(-r, W + r)
        y = H * (0.36 + 0.62 * rng.beta(2.6, 1.5))
        col = pick()
        # Big discs are nearer the lens: dimmer and softer.
        b = rng.uniform(0.45, 1.0) * (1.15 - 0.55 * (r - 10) / 70)
        soft = 1.0 + r * 0.035

        def bokeh(d, r=r, soft=soft, b=b):
            cov = np.clip((r - d) / soft + 0.5, 0, 1)
            rim = np.exp(-((r - d) / (0.10 * r + 1.5)) ** 2) * 0.30
            return (0.55 + rim) * cov * b * 0.85

        y0, y1 = max(int(y - r - 4), 0), min(int(y + r + 5), H)
        x0, x1 = max(int(x - r - 4), 0), min(int(x + r + 5), W)
        if y1 <= y0 or x1 <= x0:
            continue
        d = np.sqrt((XX[y0:y1, x0:x1] - x) ** 2 + (YY[y0:y1, x0:x1] - y) ** 2)
        target = near[i % 2] if r > 40 else far
        target[y0:y1, x0:x1] += bokeh(d)[..., None] * col
    # Small sharp lights: windows high up, lamps further down the street.
    for _ in range(46):
        x, y = rng.uniform(0, W), H * (0.42 + 0.56 * rng.beta(2.0, 1.4))
        col = pick()
        r = rng.uniform(2.0, 5)
        y0, y1, x0, x1 = max(int(y - 12), 0), min(int(y + 13), H), max(int(x - 12), 0), min(int(x + 13), W)
        d = np.sqrt((XX[y0:y1, x0:x1] - x) ** 2 + (YY[y0:y1, x0:x1] - y) ** 2)
        far[y0:y1, x0:x1] += (np.clip((r - d) / 1.2 + 0.5, 0, 1) * rng.uniform(0.5, 0.9))[..., None] * col
    far = far + blur(far, 60) * 0.35
    vig = vignette_factor(0.45)
    img = screen(img, far) * vig[..., None]
    scene = Scene("rain", img)
    # Traffic on the street below, in two soft lanes of a seamless band: tail
    # lights going right in the far lane, headlights coming left in the near.
    for lane, (y_lane, cols, count, secs, rev) in enumerate([
            (0.835, ["#FF5236", "#FF7A3C", "#FF3B2A"], 20, 44, False),
            (0.905, ["#FFE6B8", "#FFF2D8", "#FFD08A"], 18, 31, True)]):
        bh = 110
        band = np.zeros((bh, TILE, 3), np.float32)
        for _ in range(count):
            r = rng.uniform(6, 15) * (1.0 + 0.3 * lane)
            x, y = rng.uniform(0, TILE), bh / 2 + rng.uniform(-14, 14)
            col = rgb(cols[rng.integers(0, len(cols))])
            b = rng.uniform(0.35, 0.8)
            for ox in (-TILE, 0, TILE):
                for px in (x + ox, x + ox + r * 2.6):  # a pair of lights per car
                    xa, xb = max(int(px - r - 3), 0), min(int(px + r + 4), TILE)
                    if xb <= xa:
                        continue
                    gy, gx = np.mgrid[0:bh, xa:xb].astype(np.float32)
                    d = np.sqrt((gx - px) ** 2 + (gy - y) ** 2)
                    band[:, xa:xb] += (np.clip((r - d) / (1 + r * 0.08) + 0.5, 0, 1) * b * 0.6)[..., None] * col
        band = band + blur(band, 18, wrap=True) * 0.5
        anim = drift(secs, 5 + 7 * lane) + (" reverse" if rev else "")
        scene.add(f"traffic{lane}", tile2(light_rgba(band)), 0, int(y_lane * H - bh / 2), anim)
    # The near lights breathe in and out of focus, two sets out of step.
    for k, (secs, off) in enumerate([(9, 2), (13, 7)]):
        scene.add(f"near{k}", light_rgba((near[k] + blur(near[k], 50) * 0.3) * vig[..., None]), 0, 0,
                  pulse("breathe", secs, off))
    # Raindrops on the glass: a little brighter inside, a dark lower rim and
    # a highlight where the window catches the light.
    glass = np.zeros((H, W, 4), np.float32)
    for _ in range(300):
        r = rng.uniform(2.0, 7.5)
        x, y = rng.uniform(10, W - 10), rng.uniform(10, H - 10)
        y0, y1, x0, x1 = int(y - r - 3), int(y + r + 4), int(x - r - 3), int(x + r + 4)
        yy, xx = YY[y0:y1, x0:x1], XX[y0:y1, x0:x1]
        d = np.sqrt((xx - x) ** 2 + ((yy - y) * 1.1) ** 2)
        inside = np.clip((r - d) / 0.8 + 0.5, 0, 1)
        lower = np.clip((yy - y) / r, 0, 1) * np.exp(-((r - d) / 1.2) ** 2)
        spot = np.exp(-(((xx - x + 0.35 * r) ** 2 + (yy - y + 0.4 * r) ** 2) / (0.09 * r * r + 0.3))) * inside
        # Dark where the rim is, light where the inside and highlight are.
        a = np.maximum(lower * 0.45, inside * 0.07 + spot * 0.45)
        light = (inside * 0.07 + spot * 0.45) / np.maximum(a, 1e-4)
        patch = glass[y0:y1, x0:x1]
        patch[..., :3] = np.where((a > patch[..., 3])[..., None],
                                  (light[..., None] * rgb("#F2F4FF")), patch[..., :3])
        patch[..., 3] = np.maximum(patch[..., 3], a)
    scene.add("glass", glass, 0, 0)
    # Drops running down the glass, drawn by CSS (app.css .wall-drop): each
    # clings, slips, clings again, then runs off the bottom.
    drops = []
    for i in range(9):
        drops.append(dict(x=int(rng.uniform(60, W - 60)), y=int(rng.uniform(-140, 10)),
                          dur=round(float(rng.uniform(11, 19)), 1),
                          delay=round(float(rng.uniform(0, 19)), 1), size=round(float(rng.uniform(0.7, 1.2)), 2)))
    scene.effect("drops", drops=drops)
    return scene


# ---- Night scenes ---------------------------------------------------------------
# Like Lamp: almost all black, lit by one light, but each one a place.

def rect(x0, x1, y0, y1):
    """Antialiased filled rectangle coverage (H, W)."""
    return (np.clip(XX - x0 + 0.5, 0, 1) * np.clip(x1 - XX + 0.5, 0, 1)
            * np.clip(YY - y0 + 0.5, 0, 1) * np.clip(y1 - YY + 0.5, 0, 1))


def taper(x, y0, y1, w0, w1):
    """A vertical bar centred on x, w0 wide at y0 and w1 at y1 (y0 < y1)."""
    t = np.clip((YY - y0) / max(y1 - y0, 1e-3), 0, 1)
    half = (w0 + (w1 - w0) * t) / 2
    return np.clip(half - np.abs(XX - x) + 0.5, 0, 1) * np.clip(YY - y0 + 0.5, 0, 1) * np.clip(y1 - YY + 0.5, 0, 1)


def segment(cov, x0, y0, x1, y1, w0, w1):
    """Adds a tapering stroke from (x0, y0), w0 wide, to (x1, y1), w1 wide."""
    pad = max(w0, w1) / 2 + 2
    xa, xb = int(max(min(x0, x1) - pad, 0)), int(min(max(x0, x1) + pad + 1, W))
    ya, yb = int(max(min(y0, y1) - pad, 0)), int(min(max(y0, y1) + pad + 1, H))
    if xb <= xa or yb <= ya:
        return
    px, py = XX[ya:yb, xa:xb], YY[ya:yb, xa:xb]
    dx, dy = x1 - x0, y1 - y0
    t = np.clip(((px - x0) * dx + (py - y0) * dy) / max(dx * dx + dy * dy, 1e-6), 0, 1)
    d = np.sqrt((px - x0 - t * dx) ** 2 + (py - y0 - t * dy) ** 2)
    c = np.clip((w0 + (w1 - w0) * t) / 2 - d + 0.5, 0, 1)
    cov[ya:yb, xa:xb] = np.maximum(cov[ya:yb, xa:xb], c)


def soft_dots(shape, dots, colour, wrap_x=False, wrap_y=False):
    """Light (h, w, 3) of soft round dots: (x, y, radius, brightness) each,
    a bright core in a faint halo. wrap_*: the picture is a seamless tile."""
    h, w = shape
    out = np.zeros((h, w, 3), np.float32)
    for x, y, r, b in dots:
        reach = int(r * 5) + 2
        for ox in ((-w, 0, w) if wrap_x else (0,)):
            for oy in ((-h, 0, h) if wrap_y else (0,)):
                cx, cy = x + ox, y + oy
                xa, xb = max(int(cx - reach), 0), min(int(cx + reach + 1), w)
                ya, yb = max(int(cy - reach), 0), min(int(cy + reach + 1), h)
                if xb <= xa or yb <= ya:
                    continue
                gy, gx = np.mgrid[ya:yb, xa:xb].astype(np.float32)
                d2 = ((gx - cx) ** 2 + (gy - cy) ** 2) / (r * r)
                out[ya:yb, xa:xb] += ((np.exp(-d2 * 1.4) + 0.16 * np.exp(-d2 / 9)) * b)[..., None] * colour
    return out


def faint_stars(img, rng, count, y1, avoid=None, level=(0.04, 0.16)):
    """Adds dim single-pixel stars above y1 (not within avoid=(x, y, r))."""
    for _ in range(count):
        x, y = int(rng.uniform(8, W - 8)), int(rng.uniform(8, y1))
        if avoid and (x - avoid[0]) ** 2 + (y - avoid[1]) ** 2 < avoid[2] ** 2:
            continue
        b = rng.uniform(*level) * (1 - 0.7 * y / y1)
        img[y, x] += b * rgb("#DDE6FF")
        if b > 0.12:
            img[y - 1:y + 2, x] += b * 0.3 * rgb("#DDE6FF")
            img[y, x - 1:x + 2] += b * 0.3 * rgb("#DDE6FF")


def streetlamp():
    """A cast-iron street lamp on a foggy winter night. Its light falls in a
    cone through the mist onto wet cobbles and an empty bench; further along
    the path, three more lamps. Snow drifts down through the light."""
    n = Noise(71)
    rng = np.random.default_rng(71)
    hy = 600  # eye level: the cobbles recede to here
    ground, lx = 930, 600  # where the near lamp stands
    vx = 1660  # the path's vanishing point
    lamps = [(lx, ground, 1.0)] + [(vx + (lx - vx) * s, hy + (ground - hy) * s, s) for s in (0.40, 0.22, 0.12)]
    iron = np.zeros((H, W), np.float32)
    glass = np.zeros((H, W), np.float32)
    fog = np.zeros((H, W, 3), np.float32)
    pool = np.zeros((H, W), np.float32)
    fogn = 0.7 + 0.3 * n.fbm(XX / 260, YY / 180, 4)
    bulbs = []
    for x, base, s in lamps:
        # Plinth, post, collar, lantern (a glass box wider at the top), cap.
        top = base - 646 * s
        iron = np.maximum(iron, rect(x - 15 * s, x + 15 * s, base - 30 * s, base))
        iron = np.maximum(iron, taper(x, base - 590 * s, base - 30 * s, 9 * s, 16 * s))
        iron = np.maximum(iron, rect(x - 10 * s, x + 10 * s, base - 598 * s, base - 588 * s))
        pane = taper(x, top, base - 598 * s, 40 * s, 26 * s)
        bars = np.maximum(taper(x - 8 * s, top, base - 598 * s, 2 * s, 2 * s), taper(x + 8 * s, top, base - 598 * s, 2 * s, 2 * s))
        glass = np.maximum(glass, pane * (1 - bars))
        iron = np.maximum(iron, taper(x, top - 26 * s, top + 2 * s, 8 * s, 56 * s))
        iron = np.maximum(iron, disc(x, top - 30 * s, 4 * s))
        by = base - 620 * s
        bulbs.append((x, by, s))
        # The light: a halo in the fog round the lantern (dimmer above the
        # cap), and a cone of lit fog below it that fades out at the ground.
        d = np.sqrt((XX - x) ** 2 + (YY - by) ** 2)
        above = 1 - 0.55 * smoothstep(by - 20 * s, by - 90 * s, YY)
        halo = (np.exp(-(d / (120 * s)) ** 2 * 2.2) * 0.22 + np.exp(-(d / (420 * s)) ** 2 * 2.2) * 0.035) * above
        ang = np.arctan2(XX - x, np.maximum(YY - by, 1e-3))
        cone = (np.exp(-(ang / 0.44) ** 4) * (YY > by) / (1 + (d / (300 * s)) ** 2)
                * smoothstep(20 * s, 110 * s, d) * (1 - smoothstep(base - 90 * s, base + 30 * s, YY)))
        fog += ((halo + cone * 0.24) * fogn * (0.55 + 0.45 * s))[..., None] * rgb("#FFB26C")
        # Its pool of light on the ground, longer towards us than away.
        ry = np.where(YY < base, 46 * s, 130 * s)
        pool += np.exp(-(((XX - x) / (420 * s)) ** 2 + ((YY - base - 12 * s) / ry) ** 2) * 2.4) * (0.5 + 0.5 * s)
    # Cobbles in perspective: rows close up towards eye level, each row set
    # off by its own amount, each stone rounded, worn and its own shade.
    yb = np.maximum(YY - hy, 1)
    gz = 6806 / yb
    row = np.floor(gz)
    gx = (XX - lx) * (380 / yb) / 46 * (1 + 0.18 * n(row * 1.7, 2.2)) + 3.7 * n(row * 2.9, 5.5)
    gx = gx + 0.12 * n.fbm(gx * 2, gz * 2, 2)
    fx, fz = gx - np.floor(gx) - 0.5, gz - row - 0.5
    rough = 0.05 * n.fbm(gx * 6, gz * 6, 2)
    stone = smoothstep(0.5, 0.30, (np.abs(fx) ** 3 + np.abs(fz) ** 3) ** (1 / 3) + rough)
    shade = 0.72 + 0.28 * n(np.floor(gx) * 7.1, row * 3.3)
    cob = (0.45 + 0.55 * stone * shade) * (YY > hy)
    ground_light = (pool * cob * 0.26)[..., None] * rgb("#FFAE68")
    # Wet stones: the near lantern smeared into a broken streak towards us.
    below_lamp = np.maximum(YY - ground, 0)
    streak = (np.exp(-((XX - lx) / (7 + below_lamp * 0.10)) ** 2) * (YY > ground - 6) * np.exp(-below_lamp / 220)
              * np.clip(0.55 + 0.9 * n.fbm(XX / 9, YY / 2.5, 3), 0, 1) * stone)
    ground_light += (streak * 0.42)[..., None] * rgb("#FFC890")
    # The bench, right of the lamp, and its shadow thrown away from it.
    bench = np.zeros((H, W), np.float32)
    for y0 in (800, 818, 836):
        bench = np.maximum(bench, rect(772, 1000, y0, y0 + 10))
    bench = np.maximum(bench, rect(760, 1012, 862, 872))
    for x0, y0, y1 in ((778, 800, 924), (992, 800, 924), (766, 868, 932), (1004, 868, 932)):
        bench = np.maximum(bench, rect(x0 - 3, x0 + 3, y0, y1))
    shadow = np.clip(rect(800, 1080, 924, 946) * 0.85, 0, 1)
    ground_light *= (1 - blur(shadow, 6))[..., None]
    img = ground_light + fog
    # Iron and wood, almost black; a little lamplight on their top edges.
    solid = np.maximum(iron, bench)
    img = over(img, rgb("#060505"), solid * 0.94)
    edge = np.clip(bench - np.roll(bench, 2, axis=0), 0, 1)
    img += (edge * 0.20 * np.exp(-((XX - lx) / 520) ** 2))[..., None] * rgb("#FFB878")
    # The lanterns' glass, bright, and the bulbs' glare over everything.
    img = over(img, rgb("#FFD9A6"), glass * 0.92)
    light = np.zeros((H, W, 3), np.float32)
    for x, by, s in bulbs:
        glow(light, x, by, 26 * s, "#FFF2DA", 0.95)
        glow(light, x, by, 70 * s, "#FFC88A", 0.25)
    img = screen(img, light)
    scene = Scene("streetlamp", img, dark=True)
    # Snow, only seen where the near lamp lights it: two seamless tiles
    # sinking at different speeds, each masked to the cone of light.
    bx, by0, bw, bh = lx - 420, 280, 840, 720
    mask = f"radial-gradient(400px 540px at 420px 240px, #000 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 100%)"
    for key, count, rad, bright, secs in (("snow-far", 170, (0.8, 1.5), (0.35, 0.6), 70),
                                          ("snow-near", 46, (1.8, 3.0), (0.45, 0.8), 38)):
        dots = [(rng.uniform(0, bw), rng.uniform(0, bh), rng.uniform(*rad), rng.uniform(*bright)) for _ in range(count)]
        snow = soft_dots((bh, bw), dots, rgb("#FFE8CC"), wrap_x=True, wrap_y=True)
        scene.add(key, tile2v(light_rgba(snow)), 0, 0, sink(secs, rng.uniform(0, secs)), still=0,
                  box=(bx, by0, bw, bh, mask))
    return scene


def moonrise():
    """A full moon just risen over still water, its path broken into
    glitter; a far shore with two lit windows. Thin clouds cross the moon,
    lit only near it, and the path glitters."""
    n = Noise(81)
    pn = Noise(82, wrap_x=3)
    rng = np.random.default_rng(81)
    hz = int(0.62 * H)
    mx, my, mr = 1210, 548, 46
    img = np.zeros((H, W, 3), np.float32)
    sky = YY < hz
    img += (sky * np.exp(-(hz - YY) / 140) * 0.035)[..., None] * rgb("#5A6E9A")
    faint_stars(img, rng, 110, hz - 60, avoid=(mx, my, 380))
    light = np.zeros((H, W, 3), np.float32)
    glow(light, mx, my, 240, "#F2D7A6", 0.12)
    glow(light, mx, my, 760, "#7A7468", 0.03)
    img = screen(img, light * sky[..., None])
    # The moon: maria, a darker limb.
    d = np.sqrt((XX - mx) ** 2 + (YY - my) ** 2)
    maria = 1 - 0.10 * smoothstep(-0.05, 0.4, n.fbm((XX - mx) / 30 + 40, (YY - my) / 30 + 40, 3))
    limb = 0.82 + 0.18 * np.sqrt(np.clip(1 - (d / mr) ** 2, 0, 1))
    moon = rgb("#F6E3BA") * (maria * limb)[..., None]
    img = over(img, moon, disc(mx, my, mr, 1.2))
    # The far shore: low hills on the left, a flat point on the right; two
    # windows lit on the left.
    def shore(x):
        left = (1 - smoothstep(380, 900, x)) * (16 + 22 * (0.5 + 0.5 * n.fbm(x / 210, 3.3, 4)))
        right = smoothstep(1560, 1800, x) * 9
        return hz - left - right + 0.5
    img = over(img, rgb("#010102"), below(shore) * (YY < hz + 1))
    water = YY >= hz
    z = np.maximum(YY - hz, 0)
    img = np.where(water[..., None], (np.exp(-z / 40) * 0.05)[..., None] * rgb("#3E4A66"), img)
    lights = np.zeros((H, W, 3), np.float32)
    for wx_, wy in ((300, hz - 9), (342, hz - 6)):
        lights += rect(wx_ - 1.5, wx_ + 1.5, wy - 1.5, wy + 1.5)[..., None] * rgb("#FFB65C") * 0.9
        glow(lights, wx_, wy, 10, "#FFB65C", 0.25)
        # Their reflections: short broken streaks.
        r_ = np.exp(-((XX - wx_) / 2.2) ** 2) * (YY > hz + 1) * np.exp(-(YY - hz) / 26)
        lights += (r_ * np.clip(0.5 + n.fbm(XX / 3, YY / 1.6, 2) * 1.5, 0, 1) * 0.5)[..., None] * rgb("#FFB65C")
    img = screen(img, lights)
    # The moon's path: noise laid out in perspective, as in Coast.
    depth = 2600 / (z + 12)
    wx = (XX - W / 2) / (z + 12) * 7
    path = np.exp(-((XX - mx) / (12 + z * 0.40)) ** 2) * water
    near = 0.6 * np.exp(-z / 500) + 0.4
    calm = path * np.exp(-z / 30) * 0.30  # a steady sheen right under the moon
    img = screen(img, ((path * 0.05 * near + calm))[..., None] * rgb("#F4DDB0"))
    scene = Scene("moonrise", img, dark=True)
    rows = slice(hz, H)
    span = int(12 + (H - hz) * 0.40) * 3
    x0, x1 = mx - span, mx + span
    for k, off in enumerate([0.0, 1.4]):
        # Long thin slivers: the noise is stretched along the swells.
        g = np.clip((n.fbm(wx[rows, x0:x1] / 1.3 + 50 + 40 * k, depth[rows, x0:x1] / 0.07 + 13 * k, 3) - 0.24) * 4, 0, 1) ** 2
        shine = path[rows, x0:x1] * g * near[rows, x0:x1] * 0.75
        scene.add(f"glint{k}", light_rgba(shine[..., None] * rgb("#F6E2B8")), x0, hz,
                  pulse("pulse", 2.8, off), still=1.0 if k == 0 else 0.12)
    # Thin clouds, drifting; a mask round the moon so they show only where
    # its light catches them.
    c0, c1 = 420, 680
    yy, xx = YY[c0:c1], XX[c0:c1]
    # Wisps: stretched sideways, but not into ruled lines.
    wisp = Noise(83, wrap_x=7).fbm(xx * 7 / TILE, yy / 30, 5) + 0.35 * pn.fbm(xx * 3 / TILE + 4, yy / 70, 2)
    band = smoothstep(c0 + 20, c0 + 90, yy) * (1 - smoothstep(c1 - 110, c1 - 30, yy))
    amount = np.clip((wisp - 0.12) * 1.7, 0, 1) ** 1.3 * band * 0.42
    mask = "radial-gradient(560px 190px at 700px 128px, #000 0%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0) 100%)"
    scene.add("clouds", tile2(rgba(rgb("#BFB29C"), amount)), 0, 0, drift(320, 110), still=0,
              box=(mx - 700, c0, 1400, c1 - c0, mask))
    return scene


def lighthouse():
    """A lighthouse on a headland at night, a keeper's cottage beside it
    with one window lit, the sea dark below. The beam sweeps round: out
    across the sea to the left, a flash as it faces us, then to the right.
    The surf at the rocks glimmers."""
    n = Noise(91)
    rng = np.random.default_rng(91)
    hz = int(0.66 * H)
    tx, ty = 1540, 337  # the lantern
    img = np.zeros((H, W, 3), np.float32)
    sky = YY < hz
    img += (sky * (np.exp(-(hz - YY) / 120) * 0.07 + np.exp(-(hz - YY) / 380) * 0.05))[..., None] * rgb("#4A6088")
    faint_stars(img, rng, 150, hz - 80, avoid=(tx, ty, 260))
    z = np.maximum(YY - hz, 0)
    # The sea: the horizon's glow on long low swells.
    swell = np.clip(n.fbm(XX / 420, z / 5 + 2600 / (z + 30), 3) * 0.5 + 0.5, 0, 1)
    img += ((YY >= hz) * np.exp(-z / 90) * 0.045 * (0.5 + swell))[..., None] * rgb("#42577E")
    # The lantern's reflection: a glitter column right down the water.
    col = np.exp(-((XX - tx) / (5 + z * 0.08)) ** 2) * (YY > hz)
    glit = np.clip((n.fbm((XX - tx) / 4, 2600 / (z + 12) / 0.3, 3) - 0.1) * 3, 0, 1)
    img = screen(img, (col * glit * (0.12 + 0.25 * smoothstep(0, 360, z)))[..., None] * rgb("#FFD49A"))
    # The headland, a sea stack, the tower, the cottage.
    def land(x):
        rise = smoothstep(1130, 1420, x)
        return hz - rise * (118 + 14 * n.fbm(x / 70, 7.7, 4)) - 6 * n.fbm(x / 18, 2.2, 2) * rise + 0.5
    cover = below(land) * (YY < hz + 1)
    cover = np.maximum(cover, np.clip(1 - (((XX - 1062) / 22) ** 2 + ((YY - hz) / 34) ** 2), 0, 1) * 4 * (YY < hz + 1)).clip(0, 1)
    base_y = float(land(np.array([tx], np.float32))[0]) + 6
    tower = taper(tx, ty + 22, base_y, 30, 50)
    cot_x0, cot_x1 = 1648, 1752
    cot_y = float(land(np.array([1700.0], np.float32))[0]) + 4
    house = np.maximum(rect(cot_x0, cot_x1, cot_y - 52, cot_y), taper(1700, cot_y - 84, cot_y - 50, 4, 118))
    chimney = rect(1726, 1738, cot_y - 92, cot_y - 70)
    shapes = np.maximum.reduce([cover, house, chimney])
    img = over(img, rgb("#020304"), shapes)
    # The tower, faintly white, lit from the lantern above: brighter at the
    # top, a dark band round its middle.
    fall = np.exp(-(YY - ty) / 160)
    band = 1 - 0.55 * rect(0, W, ty + 120, ty + 160)
    side = 0.75 + 0.25 * np.clip((XX - tx) / 22, -1, 1)
    img = over(img, (rgb("#6C6458") * (0.12 + 0.55 * fall * band * side)[..., None]), tower)
    # Gallery, lantern (glazed, with mullions), dome and finial.
    gallery = np.maximum(rect(tx - 27, tx + 27, ty + 18, ty + 24), rect(tx - 25, tx + 25, ty + 6, ty + 7.5))
    for k in range(-5, 6):
        gallery = np.maximum(gallery, rect(tx + k * 5 - 0.6, tx + k * 5 + 0.6, ty + 6, ty + 18))
    pane = rect(tx - 15, tx + 15, ty - 18, ty + 18)
    mull = np.maximum.reduce([rect(tx + m - 1, tx + m + 1, ty - 18, ty + 18) for m in (-8, 0, 8)])
    dome = np.clip(1 - (((XX - tx) / 18) ** 2 + ((YY - (ty - 18)) / 16) ** 2), 0, 1) * 6 * (YY < ty - 18)
    finial = rect(tx - 1, tx + 1, ty - 42, ty - 30)
    img = over(img, rgb("#FFE6B8"), pane * (1 - mull))
    img = over(img, rgb("#0A0908"), np.maximum.reduce([gallery, dome.clip(0, 1), finial, mull * pane]))
    # The cottage window.
    win = rect(1688, 1704, cot_y - 36, cot_y - 18)
    sash = np.maximum(rect(1695.4, 1696.6, cot_y - 36, cot_y - 18), rect(1688, 1704, cot_y - 27.6, cot_y - 26.4))
    img = over(img, rgb("#FFAE58"), win * (1 - sash) * 0.9)
    light = np.zeros((H, W, 3), np.float32)
    glow(light, 1696, cot_y - 27, 26, "#FFAE58", 0.10)
    glow(light, tx, ty, 34, "#FFF2D6", 0.55)
    glow(light, tx, ty, 150, "#FFC27A", 0.12)
    glow(light, tx, ty, 520, "#FF9E55", 0.03)
    img = screen(img, light)
    scene = Scene("lighthouse", img, dark=True)
    # Surf where the rocks meet the sea.
    sy0 = hz - 8
    yy, xx = YY[sy0:hz + 10], XX[sy0:hz + 10]
    foam = np.clip(n.fbm(xx / 14, yy / 3 + 5, 3) * 1.6 + 0.3, 0, 1) * np.exp(-((yy - hz) / 3.5) ** 2)
    foam *= smoothstep(1110, 1200, xx) * (1 - smoothstep(1880, 1920, xx))
    foam = np.maximum(foam, np.exp(-(((xx - 1062) / 26) ** 2 + ((yy - hz) / 3) ** 2)) * 0.8)
    scene.add("surf", rgba(rgb("#9AAFC6"), foam * 0.32), 0, sy0, pulse("glimmer", 7.5, 2))
    # The beam: a long cone of lit haze, one picture each way from the
    # lantern. Each stretches out from the lantern and back (app.css
    # wall-beam); the flash comes between them, as it faces us.
    period = 24
    ext = 210
    def beam(length, sign):
        ys, xs = np.mgrid[0:2 * ext, 0:length].astype(np.float32)
        L = (length - xs) if sign < 0 else xs
        cy = ext - L * 0.035
        hw = 6 + L * 0.075
        across = (ys - cy) / hw
        haze = 0.75 + 0.25 * n.fbm(xs / 140 + 5 * sign, ys / 60, 3)
        i_ = np.exp(-across ** 2 * 1.6) * (0.42 * np.exp(-L / 650) + 0.10 * np.exp(-L / 2200)) * smoothstep(0, 30, L) * haze
        # Fade out before the picture ends: while the beam is drawn in, its
        # end shows on screen.
        i_ = i_ * (1 - smoothstep(0.55 * length, length, L))
        return light_rgba(i_[..., None] * rgb("#FFE4B6"))
    t0 = 0.2 * period  # the first frame: the beam most of the way out to the left
    scene.add("beam-left", beam(tx, -1), 0, ty - ext, f"wall-beam {period}s ease-in-out {-t0}s infinite",
              origin=f"{tx}px {ext}px", still=0.9)
    scene.add("beam-right", beam(W - tx, 1), tx, ty - ext,
              f"wall-beam {period}s ease-in-out {-(t0 + period / 2)}s infinite", origin=f"0px {ext}px", still=0)
    fr = 260
    fy, fx = np.mgrid[0:2 * fr, 0:2 * fr].astype(np.float32)
    fd = np.sqrt((fx - fr) ** 2 + (fy - fr) ** 2)
    flash = np.exp(-(fd / 60) ** 2) * 0.55 + np.exp(-(fd / 170) ** 2) * 0.18 + np.exp(-((fy - fr) / 3) ** 2 - ((fx - fr) / 150) ** 2) * 0.4
    # Down to nothing well inside its square, or the square shows.
    flash = flash * np.clip(1 - (fd / fr) ** 2, 0, 1) ** 2
    scene.add("flash", light_rgba(flash[..., None] * rgb("#FFEFD0")), tx - fr, ty - fr,
              f"wall-flash {period}s linear {-t0}s infinite", still=0)
    return scene


def fireflies():
    """A meadow just after dusk: the last light low in the sky behind tall
    grass and an old oak. Fireflies blink in the grass, each set to its own
    rhythm."""
    n = Noise(101)
    rng = np.random.default_rng(101)
    img = vertical([(0.0, "#000000"), (0.30, "#000104"), (0.55, "#040C1A"), (0.70, "#0B1E31"),
                    (0.78, "#12293B"), (1.0, "#12293B")])
    glow(img, 260, 0.80 * H, 700, "#3A2630", 0.10)  # afterglow, where the sun went down
    faint_stars(img, rng, 70, int(0.45 * H), level=(0.03, 0.12))
    xs = np.arange(W, dtype=np.float32)

    def hill(x):
        return 0.775 * H - 26 * (0.5 + 0.5 * n.fbm(x / 520 + 3, 1.1, 4)) - 3 * n.fbm(x / 6, 4.4, 2)
    sil = below(hill)
    # The oak: limbs forking from a short trunk, leaves in clumps at the
    # ends of the twigs, so the crown is ragged with sky showing through.
    ox, ground = 1470, float(hill(np.array([1470.0], np.float32))[0])
    limbs = np.zeros((H, W), np.float32)
    tips = []
    trng = np.random.default_rng(7)

    def branch(x, y, angle, length, width, depth):
        # Two strokes with a kink, so no limb is ruler-straight.
        bend = angle + trng.normal(0, 0.18)
        mx_, my_ = x + math.cos(angle) * length * 0.5, y + math.sin(angle) * length * 0.5
        ex, ey_ = mx_ + math.cos(bend) * length * 0.5, my_ + math.sin(bend) * length * 0.5
        segment(limbs, x, y, mx_, my_, width, width * 0.85)
        segment(limbs, mx_, my_, ex, ey_, width * 0.85, width * 0.7)
        if depth == 0:
            tips.append((ex, ey_, length))
            return
        kids = 3 if depth >= 3 and trng.random() < 0.5 else 2
        for k in range(kids):
            spread = (k - (kids - 1) / 2) * trng.uniform(0.55, 0.85) + trng.normal(0, 0.12)
            a = min(max(bend + spread, -math.pi + 0.18), -0.18)
            # Outer limbs spread wide and level, the way an oak in the open does.
            a = a + (0.25 if a > -math.pi / 2 else -0.25) * (depth <= 3)
            a = min(max(a, -math.pi + 0.12), -0.12)
            branch(ex, ey_, a, length * trng.uniform(0.66, 0.8), width * 0.62, depth - 1)

    segment(limbs, ox, ground + 4, ox, ground - 20, 64, 46)  # the flare at its foot
    branch(ox, ground + 2, -math.pi / 2, 150, 44, 5)
    e = np.full((H, W), -9, np.float32)
    for tx_, ty_, ln in tips:
        r = 42 + ln * 1.05
        e = np.maximum(e, 1 - ((XX - tx_) / r) ** 2 - ((YY - ty_ + r * 0.25) / (r * 0.75)) ** 2)
    leafy = e + 0.45 * n.fbm(XX / 40 + 9, YY / 40 + 9, 5) + 0.22 * n.fbm(XX / 9, YY / 9, 3)
    crown = np.clip((leafy - 0.16) * 9, 0, 1)
    sil = np.maximum.reduce([sil, crown, limbs])
    # Tall grass in front: blades curving in the breeze, some with seed heads.
    grass = np.zeros((H, W), np.float32)
    for _ in range(900):
        x0 = rng.uniform(-40, W + 40)
        tall = rng.uniform(90, 330) * (1.25 if rng.random() < 0.15 else 1)
        lean = rng.normal(0.25, 0.35) * tall * 0.35
        y_end = H + 20 - tall
        y0 = int(max(y_end, 0))
        ys = np.arange(y0, H, dtype=np.float32)
        t = np.clip((H + 20 - ys) / tall, 0, 1)
        centre = x0 + lean * t * t
        width = 0.6 + rng.uniform(1.4, 3.2) * (1 - t)
        xa, xb = int(max(min(x0, x0 + lean) - 6, 0)), int(min(max(x0, x0 + lean) + 7, W))
        if xb <= xa:
            continue
        gx = XX[y0:H, xa:xb]
        c = np.clip(width[:, None] / 2 - np.abs(gx - centre[:, None]) + 0.5, 0, 1)
        grass[y0:H, xa:xb] = np.maximum(grass[y0:H, xa:xb], c)
        if rng.random() < 0.22:
            hx, hy_ = x0 + lean, y_end
            hl = rng.uniform(14, 26)
            ang = math.atan2(lean * 2 / tall, 1)
            segment(grass, hx - math.sin(ang) * 2, hy_ + 4, hx + math.sin(ang) * hl * 0.6, hy_ - hl, 4.5, 1.5)
    sil = np.maximum(sil, grass)
    img = over(img, rgb("#000000"), sil)
    scene = Scene("fireflies", img, dark=True)
    # Fireflies: five sets, each blinking on its own beat (app.css
    # wall-blink). They stay put: on the TV, five drifting double-width
    # tiles were too much for the compositor.
    f0, f1 = int(0.40 * H), H - 30
    for k, (beat, still) in enumerate(((4.7, 0.9), (5.9, 0.0), (7.3, 0.6), (8.6, 0.0), (11.2, 0.3))):
        dots = []
        for _ in range(13):
            y = f0 + (f1 - f0) * rng.beta(2.6, 1.4)
            near = (y - f0) / (f1 - f0)
            dots.append((rng.uniform(12, W - 12), y - f0, 1.4 + 1.6 * near, rng.uniform(0.6, 1.0)))
        flies = soft_dots((f1 - f0, W), dots, rgb("#D6F46A"))
        anim = f"wall-blink {beat}s ease-out {-rng.uniform(0, beat):.1f}s infinite"
        scene.add(f"flies{k}", light_rgba(flies), 0, f0, anim, still=still)
    return scene


# ---- Dark (low power) wallpapers ------------------------------------------------

def dark_glow(img_arr, cx, cy, radius, colour, peak):
    """Adds a soft radial glow (smoothstep falloff) to a 0..255 float RGB array."""
    d = np.sqrt((XX - cx) ** 2 + (YY - cy) ** 2) / radius
    t = np.clip(1 - d, 0, 1)
    w = t * t * (3 - 2 * t) * peak
    for c in range(3):
        img_arr[..., c] += w * colour[c]


def dark():
    """Lamp: a warm lamp just out of frame, top right, and its faint pool of
    light below; motion: dust at two depths rising through its light.
    Midnight: a deep-blue haze at the floor and a few dim stars; motion:
    half of them twinkle, in three sets, and two shooting stars come by. Dither only where there is light, so
    black stays exactly black. Returns the walls.js entries."""
    rng = np.random.default_rng(7)
    walls = {}
    lamp = np.zeros((H, W, 3), np.float32)
    dark_glow(lamp, 1760, -40, 760, (255, 170, 95), 0.13)
    dark_glow(lamp, 1650, 1120, 520, (255, 150, 80), 0.045)
    walls["lamp"] = lamp
    mid = np.zeros((H, W, 3), np.float32)
    yy = np.arange(H, dtype=np.float32)[:, None]
    haze = np.clip((yy - 720) / 360, 0, 1) ** 2 * 0.05
    mid[..., 0] += haze * 60
    mid[..., 1] += haze * 90
    mid[..., 2] += haze * 160
    twinkle = [np.zeros((H, W, 3), np.float32) for _ in range(3)]
    for i in range(70):
        x, y = rng.integers(40, W - 40), rng.integers(30, int(H * 0.62))
        b = rng.uniform(18, 46)
        r = 1 if rng.random() < 0.8 else 2
        mid[y - r + 1:y + r, x - r + 1:x + r] += (b * 0.85, b * 0.9, b)
        if i % 2 == 0:  # half of them twinkle, in three sets out of step
            twinkle[i // 2 % 3][y - r + 1:y + r, x - r + 1:x + r] += (b * 0.85, b * 0.9, b)
    walls["midnight"] = mid
    entries = {}
    for name, arr in walls.items():
        # Triangular dither (±1 level) hides the 8-bit steps of a very dark
        # gradient, which otherwise show as rings in a dark room.
        lit = arr.max(axis=2, keepdims=True) > 0.2
        noise = (rng.uniform(-0.5, 0.5, size=arr.shape) + rng.uniform(-0.5, 0.5, size=arr.shape)).astype(np.float32)
        arr = np.where(lit, arr + noise, arr)
        out = Image.fromarray(np.clip(np.rint(arr), 0, 255).astype(np.uint8), "RGB")
        out.save(OUT / f"ambient-{name}.jpg", quality=90, optimize=True)
        out.resize(THUMB, Image.LANCZOS).save(OUT / f"thumb-wall-{name}.jpg", quality=88)
        apl = float(np.clip(arr, 0, 255).mean() / 255 * 100)
        print(f"ambient-{name}: wrote (average picture level {apl:.2f}%)")
    Image.new("RGB", THUMB, (0, 0, 0)).save(OUT / "thumb-wall-black.jpg", quality=88)
    # Motion: the still underneath, then the moving parts.
    for name in walls:
        folder = OUT / "wall" / name
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
    # Lamp: specks of dust in the lamp light, at two depths: fine far ones
    # drifting slowly, a few big soft near ones faster. Each is a seamless
    # 1200 px tile sliding along a frame turned a little uphill, so the dust
    # rises on the lamp's warm air; a mask on the box keeps it in the light.
    period, tall, tilt = 1200, 1000, -9
    entries["lamp"] = [dict(src="img/ambient-lamp.jpg", x=0, y=0, w=W, h=H)]
    mask = "radial-gradient(760px 760px at 800px -40px, #000 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 85%)"
    for key, count, size, bright, soft, secs, delay in [("dust", 60, (0.8, 2.2), (0.25, 0.7), 1.0, 300, 30),
                                                          ("dust-near", 12, (2.6, 4.6), (0.18, 0.4), 2.2, 120, 70)]:
        dust = np.zeros((tall, period, 3), np.float32)
        for _ in range(count):
            r = rng.uniform(*size)
            x, y = rng.uniform(0, period), rng.uniform(160, tall - 160)
            b = rng.uniform(*bright)
            reach = int(r * soft * 3) + 3
            for ox in (-period, 0, period):
                cx = x + ox
                xa, xb = max(int(cx - reach), 0), min(int(cx + reach + 1), period)
                ya, yb = max(int(y - reach), 0), min(int(y + reach + 1), tall)
                if xb <= xa:
                    continue
                gy, gx = np.mgrid[ya:yb, xa:xb].astype(np.float32)
                d = np.sqrt((gx - cx) ** 2 + (gy - y) ** 2)
                dust[ya:yb, xa:xb] += (np.exp(-(d / (r * soft)) ** 2) * b)[..., None] * rgb("#FFC890")
        save_rgba(tile2(light_rgba(dust)), OUT / "wall" / "lamp" / f"{key}.webp")
        # The picture overhangs the box, so the turned frame still covers it.
        entries["lamp"].append(dict(src=f"img/wall/lamp/{key}.webp", x=-120, y=-150, w=2 * period, h=tall,
                                    anim=drift(secs, delay, period), tilt=tilt,
                                    box=dict(x=W - 960, y=0, w=960, h=700, mask=mask)))
    for k, twk in enumerate(twinkle):
        save_rgba(light_rgba(twk[: int(H * 0.62)] / 255), OUT / "wall" / "midnight" / f"twinkle{k}.webp")
    calm = np.clip(walls["midnight"] - sum(twinkle), 0, 255)
    lit = calm.max(axis=2, keepdims=True) > 0.2
    calm = np.where(lit, calm + (rng.uniform(-0.5, 0.5, calm.shape) + rng.uniform(-0.5, 0.5, calm.shape)), calm)
    Image.fromarray(np.clip(np.rint(calm), 0, 255).astype(np.uint8), "RGB").save(
        OUT / "wall" / "midnight" / "base.jpg", quality=90, optimize=True)
    # Each set twinkles on its own period, so the sky never pulses as one.
    entries["midnight"] = [dict(src="img/wall/midnight/base.jpg", x=0, y=0, w=W, h=H)] + [
        dict(src=f"img/wall/midnight/twinkle{k}.webp", x=0, y=0, w=W, h=int(H * 0.62),
             anim=pulse("glimmer", secs, delay))
        for k, (secs, delay) in enumerate([(5.3, 1.5), (7.9, 4.0), (11.3, 8.2)])
    ] + [
        # Two shooting stars on clocks that rarely line up.
        dict(kind="shoot", x=260, y=90, angle=16, length=760, dur=47, delay=12),
        dict(kind="shoot", x=1180, y=150, angle=31, length=760, dur=67, delay=45),
    ]
    return entries


SCENES = {"streetlamp": streetlamp, "moonrise": moonrise, "lighthouse": lighthouse, "fireflies": fireflies,
          "sunset": sunset, "coast": coast, "dunes": dunes, "aurora": aurora, "rain": rain}


def write_walls_js(entries):
    body = json.dumps(entries, indent=2)
    WALLS_JS.write_text("\n".join([
        "// Generated by scripts/gen-wallpapers.py: the moving layers of each Ambient",
        "// wallpaper, bottom to top. src/x/y/w/h place a picture; anim is its CSS",
        "// animation (keyframes in app.css); box clips it (and may mask it); kind",
        "// marks an effect drawn by CSS alone. Wallpaper motion: Off shows the stills.",
        "(function (root) {",
        "  'use strict';",
        "  const CH = root.CleanHub = root.CleanHub || {};",
        "  CH.wallLayers = " + body.replace("\n", "\n  ") + ";",
        "})(typeof window !== 'undefined' ? window : globalThis);",
        "",
    ]))
    print(f"wrote app/js/walls.js ({len(entries)} wallpapers)")


def rotate_thumb():
    """Rotate's swatch: four of the scenes in a grid."""
    tw, th = THUMB
    sheet = Image.new("RGB", THUMB)
    for i, name in enumerate(["sunset", "aurora", "coast", "rain"]):
        tile = Image.open(OUT / f"thumb-wall-{name}.jpg").resize((tw // 2, th // 2 + 1), Image.LANCZOS)
        sheet.paste(tile, ((i % 2) * tw // 2, (i // 2) * th // 2))
    sheet.save(OUT / "thumb-wall-rotate.jpg", quality=88)


def contact_sheet(names):
    tiles = [Image.open(OUT / f"ambient-{n}.jpg").resize((960, 540), Image.LANCZOS) for n in names]
    cols = 2
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (960 * cols, 540 * rows))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 960, (i // cols) * 540))
    (ROOT / "dist").mkdir(exist_ok=True)
    sheet.save(ROOT / "dist" / "wallpapers.jpg", quality=85)
    print("wrote dist/wallpapers.jpg")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated scene ids (keeps walls.js entries for the rest)")
    ap.add_argument("--sheet", action="store_true", help="also write a contact sheet to dist/wallpapers.jpg")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    names = args.only.split(",") if args.only else list(SCENES)
    unknown = [n for n in names if n not in SCENES]
    if unknown:
        raise SystemExit(f"unknown scene(s): {', '.join(unknown)}; choose from {', '.join(SCENES)}")
    entries = {}
    if args.only and WALLS_JS.exists():
        text = WALLS_JS.read_text()
        entries = json.loads(text[text.index("CH.wallLayers = ") + 16: text.rindex("};") + 1])
    if not args.only:
        entries.update(dark())
    for name in names:
        entries[name] = write_scene(SCENES[name]())
    order = ["lamp", "midnight"] + list(SCENES)
    write_walls_js({k: entries[k] for k in order if k in entries})
    if all((OUT / f"thumb-wall-{n}.jpg").exists() for n in ["sunset", "aurora", "coast", "rain"]):
        rotate_thumb()
    if args.sheet:
        contact_sheet(names)


if __name__ == "__main__":
    main()
