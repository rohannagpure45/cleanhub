"""Renders the Ambient screen's wallpapers, as stills and as moving layers:

  app/img/ambient-<id>.jpg      1920x1080 still (Wallpaper motion: Off)
  app/img/thumb-wall-<id>.jpg   240x135 swatch for the Settings row
  app/img/wall/<id>/*.jpg|webp  the layers the TV moves (Wallpaper motion: On)
  app/js/walls.js               where each layer goes and how it moves

Kinds, matching CH.options.wallpaper in app/js/options.js:
- dark (lamp, midnight; black needs no file): almost entirely pure black, so
  a local-dimming TV can switch most of its backlight zones off. Their motion
  is small: dust in the lamp light, twinkling stars and a shooting star.
- scenes (sunset, coast, dunes, aurora, rain, deco): full colour. Clouds,
  mist, aurora, sand and traffic drift left to right; glitter, stars and
  bokeh shimmer; Deco's sunburst turns and a sheen crosses its gold.

The TV only ever slides (transform) or fades (opacity) these layers, the
cheapest motion it can do. A drifting layer is two copies of a seamless
1920 px tile side by side, slid one tile per cycle, so it never jumps.

Everything is procedural, so there are no image licences to track.
  python3 scripts/gen-wallpapers.py                  # all of them
  python3 scripts/gen-wallpapers.py --only coast,deco
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
    repeats every k units in x: sample x as px * k / TILE for a seamless tile."""

    def __init__(self, seed, size=256, wrap_x=None):
        self.size = size
        self.wrap = wrap_x or size
        self.table = np.random.default_rng(seed).uniform(-1, 1, (size, self.wrap)).astype(np.float32)

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


# ---- Layered wallpapers ----------------------------------------------------------

# CSS animations (keyframes in app/css/app.css). Drifts move left to right.
def drift(seconds, delay=0.0, period=TILE):
    return f"wall-drift-{period} {seconds}s linear {-delay}s infinite"


def pulse(kind, seconds, delay=0.0):
    """kind: 'pulse' (to 12%), 'glimmer' (to 40%), 'breathe' (to 72%)."""
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

    def __init__(self, name, base):
        self.name = name
        self.base = base
        self.layers = []

    def add(self, key, pic, x=0, y=0, anim="", still=1.0, lossless=False, box=None, origin=None, sheen=None):
        """still: the layer's opacity in the still picture (Motion: Off).
        box: (x, y, w, h) that clips it. sheen: seconds per sweep of a soft
        band that shows it (app.css .wall-sheen)."""
        if anim.startswith("wall-drift"):
            check_seam(f"{self.name}/{key}", pic, int(anim.split()[0].rsplit("-", 1)[1]))
        self.layers.append(dict(key=key, pic=pic, x=x, y=y, anim=anim, still=still,
                                lossless=lossless, box=box, origin=origin, sheen=sheen))

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
            if l["box"]:
                bx, by, bw, bh = l["box"]
                pic = pic[max(-y, 0):bh - y, max(-x, 0):bw - x]
                x, y = bx + max(x, 0), by + max(y, 0)
            h, w = pic.shape[:2]
            x0, y0 = max(x, 0), max(y, 0)
            x1, y1 = min(x + w, W), min(y + h, H)
            if x1 <= x0 or y1 <= y0:
                continue
            part = pic[y0 - y:y1 - y, x0 - x:x1 - x]
            a = part[..., 3] * l["still"]
            img[y0:y1, x0:x1] = over(img[y0:y1, x0:x1], part[..., :3], a)
        return img


def save_rgb(img, path, quality=88):
    """Dithered to 8 bits (no banding in big skies), 4:4:4 so thin lines keep their colour."""
    rng = np.random.default_rng(99)
    arr = np.clip(img, 0, 1) * 255
    arr = arr + rng.uniform(-0.5, 0.5, arr.shape) + rng.uniform(-0.5, 0.5, arr.shape)
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


def write_scene(scene):
    """Writes the base, the layers and the still; returns walls.js entries."""
    folder = OUT / "wall" / scene.name
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    save_rgb(scene.base, folder / "base.jpg", quality=86)
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
            bx, by, bw, bh = l["box"]
            e["box"] = dict(x=bx, y=by, w=bw, h=bh)
        if l["sheen"]:
            e["sheen"] = l["sheen"]
        entries.append(e)
        pixels += w * h
    still = scene.still()
    out = save_rgb(still, OUT / f"ambient-{scene.name}.jpg")
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
    water, a hazy headland on the left. Clouds drift; the glitter and the
    waves shimmer."""
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
    # Water: two wave sheens fading in turn, so the surface seems to heave.
    sea_rows = slice(hz, H)
    zz, wxx, dd = z[sea_rows], wx[sea_rows], depth[sea_rows]
    for k, off in enumerate([0.0, 3.3]):
        sheen = np.clip((n.fbm(wxx / 1.6 + 30 + 11 * k, dd / 0.7 + 7 * k, 3) - 0.2) * 1.8, 0, 1) ** 1.5
        sheen = sheen * (0.045 + 0.035 * smoothstep(0, 200, zz))
        pic = light_rgba(sheen[..., None] * rgb("#CFE2F2"))
        scene.add(f"swell{k}", pic, 0, hz, pulse("pulse", 6.6, off), still=1.0 if k == 0 else 0.12)
    # The sun's path: two glitter patterns flickering in turn.
    span = (22 + 432 * 0.55) * 2.6
    x0, x1 = int(max(sx - span, 0)), int(min(sx + span, W))
    for k, off in enumerate([0.0, 1.2]):
        g = np.clip((n.fbm(wxx[:, x0:x1] / 0.45 + 50 + 40 * k, dd[:, x0:x1] / 0.22 + 13 * k, 3) - 0.22) * 4.5, 0, 1) ** 2
        shine = path[sea_rows, x0:x1] * g * np.exp(-zz[:, x0:x1] / 380) * 0.9
        pic = light_rgba(shine[..., None] * rgb("#FFDDA6"))
        scene.add(f"glint{k}", pic, x0, hz, pulse("pulse", 2.4, off), still=1.0 if k == 0 else 0.12)
    return scene


def dunes():
    """Bright desert: smooth dunes under a pale blue sky, each with a sunlit
    face and a shaded lee, fine ripples on the near ones. High cirrus drifts
    over, and the wind blows sand haze across the dunes."""
    n = Noise(37)
    pn8, pn3, pn2 = Noise(38, wrap_x=8), Noise(39, wrap_x=3), Noise(40, wrap_x=2)
    img = vertical([(0.0, "#3F7FC0"), (0.24, "#76A9D9"), (0.42, "#C9D7E0"), (0.50, "#F2D9BC"), (1.0, "#F2D9BC")])
    glow(img, 260, -200, 1000, "#FFF6E2", 0.22)
    haze = rgb("#EFD6BC")
    layers = [  # base, dune height, dune length, lit colour, shade colour, haze, lean, bend
        (0.535, 46, 520, "#EBC69C", "#D2A584", 0.50, 0.25, 0.10),
        (0.625, 92, 700, "#EDBC88", "#C88E68", 0.30, 0.35, 0.18),
        (0.760, 150, 900, "#EFB273", "#B9774E", 0.12, 0.40, 0.26),
        (0.960, 230, 1250, "#EDA562", "#A45F38", 0.0, 0.45, 0.30),
    ]
    xs = np.arange(W, dtype=np.float32)
    crest_at = 0.70  # the sharp crest sits 70% of the way along each dune

    def profile(t):
        """Height 0..1 along one dune: a long windward rise to a sharp crest,
        then a short steep slip face back down."""
        rise = np.sin(np.clip(t / crest_at, 0, 1) * math.pi / 2) ** 1.5
        fall = np.cos(np.clip((t - crest_at) / (1 - crest_at), 0, 1) * math.pi / 2) ** 0.8
        return np.where(t < crest_at, rise, fall)

    for i, (base, amp, length, lit, shade, hz, lean, bend) in enumerate(layers):
        seed = 5.1 * (i + 2)
        shift = 0.37 * (i + 1)

        def phase(x, length=length, seed=seed, shift=shift):
            # Position along the dune train, warped so no two dunes match.
            return x / length + shift + 0.35 * n.fbm(x / 900 + seed, seed, 3)

        def height(x, amp=amp, seed=seed):
            u = phase(x)
            # Each dune gets its own height.
            size = 0.65 + 0.35 * (0.5 + 0.5 * n(np.floor(u) * 3.1 + seed, seed * 1.7))
            return amp * size * profile(u - np.floor(u))

        def line(x, base=base):
            return base * H - height(x)

        cov = below(line)
        crest = line(xs)
        depth = np.maximum(YY - crest[None, :], 0)
        # The slip face: from each crest, a band of shade that leans to the
        # right as it comes down the dune (the crest line seen in perspective).
        u = phase(XX) - (depth * lean + depth * depth * bend / 400) / length
        t = u - np.floor(u)
        px = length  # pixels per unit of t, near enough
        into_shade = smoothstep(0, 1.6, (t - crest_at) * px)  # crisp at the crest line
        out_of_shade = smoothstep(0.84, 1.0, t) + (t < crest_at)  # soft where it meets the next rise
        # Sand bounces light into the far side of the slip face.
        shadow = into_shade * (1 - np.clip(out_of_shade, 0, 1)) * (1 - 0.35 * smoothstep(crest_at, 1.0, t))
        lit_c, shade_c = rgb(lit), rgb(shade)
        col = lit_c + (shade_c - lit_c) * shadow[..., None]
        # Lit sand is brightest just below the crest; the foot of each dune
        # sits a little darker.
        col = col * (1 + 0.06 * (1 - smoothstep(0, 90, depth)) * (1 - shadow))[..., None]
        col = col * (1 - 0.08 * smoothstep(40, 320, depth))[..., None]
        if i >= 2:
            # Wind ripples across the lit faces of the near dunes.
            wob = n.fbm(XX / 140, YY / 60 + 9 * i, 3)
            ripple = np.sin(depth * (0.30 - 0.04 * i) + XX * 0.012 + wob * 6)
            col = col * (1 + 0.03 * ripple * smoothstep(10, 60, depth) * (1 - shadow))[..., None]
        col = col * (1 - hz) + haze * hz
        img = over(img, col, cov)
    scene = Scene("dunes", img)
    # High cirrus: thin streaks, slow.
    r1 = int(0.40 * H)
    yy, xx = YY[:r1], XX[:r1]
    ci = pn3.fbm(xx * 3 / TILE, yy / 12, 5)
    stretch = pn2.fbm(xx * 2 / TILE + 4, yy / 60 + 2, 2)
    amount = np.clip((ci - 0.18) * 2.2, 0, 1) * np.clip(stretch + 0.6, 0, 1)
    amount *= smoothstep(0.03 * H, 0.10 * H, yy) * (1 - smoothstep(0.28 * H, 0.38 * H, yy)) * 0.42
    scene.add("cirrus", tile2(rgba(rgb("#FFFFFF"), amount)), 0, 0, drift(540, 200))
    # Sand blowing across the dunes: long thin streaks, gusting, quick.
    r0 = int(0.47 * H)
    yy, xx = YY[r0:], XX[r0:]
    streak = pn8.fbm(xx * 8 / TILE + 2, yy / 5, 4)
    gust = np.clip(pn2.fbm(xx * 2 / TILE + 7, yy / 140, 2) + 0.35, 0, 1)
    amount = np.clip((streak - 0.0) * 2.4, 0, 1) ** 1.4 * gust
    amount *= smoothstep(r0, r0 + 60, yy) * (0.22 + 0.12 * smoothstep(r0, H, yy))
    scene.add("sand", tile2(rgba(rgb("#FBE6CA"), amount)), 0, r0, drift(55, 20))
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
    stars, a spruce ridge, all mirrored in the water. The curtains drift
    and breathe, their reflection with them; some stars twinkle."""
    n = Noise(41)
    rays_n, fold_n, along_n = Noise(42, wrap_x=74), Noise(44, wrap_x=6), Noise(45, wrap_x=3)
    rng = np.random.default_rng(41)
    shore = int(0.79 * H)
    sky = vertical([(0.0, "#02050E"), (0.40, "#051326"), (0.70, "#0A2538"), (0.79, "#0D2B3C"), (1.0, "#0D2B3C")])
    # Stars, thinning towards the horizon; the brighter ones twinkle.
    stars = np.zeros((H, W), np.float32)
    twinkle = np.zeros((H, W), np.float32)
    for _ in range(520):
        x, y = rng.uniform(4, W - 4), rng.uniform(4, shore - 40)
        b = rng.pareto(2.2) * 0.18 + 0.12
        b *= 1 - 0.8 * smoothstep(0.50 * H, 0.76 * H, y)
        s = rng.uniform(0.55, 1.0)
        xi, yi = int(x), int(y)
        yy, xx = YY[yi - 3:yi + 4, xi - 3:xi + 4], XX[yi - 3:yi + 4, xi - 3:xi + 4]
        target = twinkle if b > 0.26 else stars
        target[yi - 3:yi + 4, xi - 3:xi + 4] += b * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * s * s))
    img = sky + stars[..., None] * rgb("#E6EEFF")
    # Faint green airglow low in the sky, so the dark below the curtains
    # reads as sky rather than as a hillside.
    air = np.exp(-((YY - (shore - 70)) / 150) ** 2) * 0.10
    img = screen(img, air[..., None] * rgb("#3FD9A0"))
    # The curtains: a seamless tile of folding ribbons. d = height above
    # each ribbon's lower edge.
    yy, xx = YY[:shore], XX[:shore]
    light = np.zeros((shore, W, 3), np.float32)
    # The main ribbon comes down behind the treeline, as in a photo: a level
    # ribbon higher up leaves dark sky under it that reads as hills.
    ribbons = [  # lower edge (fraction of height), fold, folds per tile, ray height, strength
        (0.665, 44, 2, 430, 1.0),
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
        light += i_[..., None] * col
    light = light * 0.9 + blur(light, 40, wrap=True) * 0.4
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
    scene.add("stars", light_rgba(twinkle[:shore - 30, :, None] * rgb("#E6EEFF")), 0, 0,
              pulse("glimmer", 5.5, 1.0))
    motion = drift(240, 90) + ", " + pulse("breathe", 13, 3)
    scene.add("curtains", tile2(light_rgba(light)), 0, 0, motion)
    lrefl, _ = mirror(light, shore, n)
    scene.add("mirror", tile2(light_rgba(lrefl * mdim)), 0, shore, motion)
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
    """City lights out of focus through a rainy window at night. Traffic
    streams by below, the nearer lights breathe in and out of focus, and
    drops run down the glass."""
    rng = np.random.default_rng(53)
    img = vertical([(0.0, "#070C18"), (0.45, "#0C1524"), (1.0, "#16121E")])
    palette = [("#FFA238", 0.34), ("#FFD9A0", 0.16), ("#FF4B36", 0.13), ("#2FD0BE", 0.11),
               ("#4C7DFF", 0.13), ("#E0499F", 0.07), ("#FFCF4A", 0.06)]
    names = [p[0] for p in palette]
    weights = np.array([p[1] for p in palette])
    pick = lambda: rgb(names[rng.choice(len(names), p=weights / weights.sum())])
    far = np.zeros((H, W, 3), np.float32)
    near = np.zeros((H, W, 3), np.float32)
    for _ in range(190):
        r = float(np.exp(rng.uniform(math.log(12), math.log(96))))
        x = rng.uniform(-r, W + r)
        y = H * (0.18 + 0.86 * rng.beta(2.4, 1.6))
        col = pick()
        # Big discs are nearer the lens: dimmer and softer.
        b = rng.uniform(0.35, 0.95) * (1.15 - 0.6 * (r - 12) / 84)
        soft = 1.0 + r * 0.035

        def bokeh(d, r=r, soft=soft, b=b):
            cov = np.clip((r - d) / soft + 0.5, 0, 1)
            rim = np.exp(-((r - d) / (0.10 * r + 1.5)) ** 2) * 0.35
            return (0.62 + rim) * cov * b * 0.72

        y0, y1 = max(int(y - r - 4), 0), min(int(y + r + 5), H)
        x0, x1 = max(int(x - r - 4), 0), min(int(x + r + 5), W)
        if y1 <= y0 or x1 <= x0:
            continue
        d = np.sqrt((XX[y0:y1, x0:x1] - x) ** 2 + (YY[y0:y1, x0:x1] - y) ** 2)
        (near if r > 44 else far)[y0:y1, x0:x1] += bokeh(d)[..., None] * col
    for _ in range(40):
        x, y = rng.uniform(0, W), H * (0.30 + 0.70 * rng.beta(2.4, 1.6))
        col = pick()
        r = rng.uniform(2.5, 6)
        y0, y1, x0, x1 = max(int(y - 12), 0), min(int(y + 13), H), max(int(x - 12), 0), min(int(x + 13), W)
        d = np.sqrt((XX[y0:y1, x0:x1] - x) ** 2 + (YY[y0:y1, x0:x1] - y) ** 2)
        far[y0:y1, x0:x1] += (np.clip((r - d) / 1.2 + 0.5, 0, 1) * rng.uniform(0.6, 1.0))[..., None] * col
    far = far + blur(far, 60) * 0.35
    vig = vignette_factor(0.45)
    img = screen(img, far) * vig[..., None]
    scene = Scene("rain", img)
    # Traffic on the street below: soft headlights and tail lights in a
    # seamless band, streaming left to right.
    t0, t1 = int(0.80 * H), int(0.97 * H)
    band = np.zeros((t1 - t0, TILE, 3), np.float32)
    for _ in range(46):
        r = rng.uniform(5, 16)
        x, y = rng.uniform(0, TILE), rng.uniform(r + 4, t1 - t0 - r - 4)
        col = rgb(["#FFE6B8", "#FFD08A", "#FF5236", "#FF7A3C"][rng.integers(0, 4)])
        b = rng.uniform(0.35, 0.8)
        h, w = band.shape[:2]
        for ox in (-w, 0, w):
            cx = x + ox
            xa, xb = max(int(cx - r - 3), 0), min(int(cx + r + 4), w)
            ya, yb = max(int(y - r - 3), 0), min(int(y + r + 4), h)
            if xb <= xa:
                continue
            gy, gx = np.mgrid[ya:yb, xa:xb].astype(np.float32)
            d = np.sqrt((gx - cx) ** 2 + (gy - y) ** 2)
            band[ya:yb, xa:xb] += (np.clip((r - d) / (1 + r * 0.08) + 0.5, 0, 1) * b * 0.7)[..., None] * col
    band = band + blur(band, 18, wrap=True) * 0.5
    scene.add("traffic", tile2(light_rgba(band)), 0, t0, drift(36, 5))
    scene.add("near", light_rgba((near + blur(near, 50) * 0.3) * vig[..., None]), 0, 0, pulse("breathe", 9, 2))
    # Raindrops on the glass: a little brighter inside, a dark lower rim and
    # a highlight where the window catches the light.
    glass = np.zeros((H, W, 4), np.float32)
    for _ in range(330):
        r = rng.uniform(2.0, 7.5)
        x, y = rng.uniform(10, W - 10), rng.uniform(10, H - 10)
        y0, y1, x0, x1 = int(y - r - 3), int(y + r + 4), int(x - r - 3), int(x + r + 4)
        yy, xx = YY[y0:y1, x0:x1], XX[y0:y1, x0:x1]
        d = np.sqrt((xx - x) ** 2 + ((yy - y) * 1.1) ** 2)
        inside = np.clip((r - d) / 0.8 + 0.5, 0, 1)
        lower = np.clip((yy - y) / r, 0, 1) * np.exp(-((r - d) / 1.2) ** 2)
        spot = np.exp(-(((xx - x + 0.35 * r) ** 2 + (yy - y + 0.4 * r) ** 2) / (0.09 * r * r + 0.3))) * inside
        # Dark where the rim is, light where the inside and highlight are.
        a = np.maximum(lower * 0.45, inside * 0.07 + spot * 0.55)
        light = (inside * 0.07 + spot * 0.55) / np.maximum(a, 1e-4)
        patch = glass[y0:y1, x0:x1]
        patch[..., :3] = np.where((a > patch[..., 3])[..., None],
                                  (light[..., None] * rgb("#F2F4FF")), patch[..., :3])
        patch[..., 3] = np.maximum(patch[..., 3], a)
    scene.add("glass", glass, 0, 0)
    # Drops running down the glass, drawn by CSS (app.css .wall-drop).
    drops = []
    for i in range(9):
        drops.append(dict(x=int(rng.uniform(60, W - 60)), dur=round(float(rng.uniform(7, 15)), 1),
                          delay=round(float(rng.uniform(0, 15)), 1), size=round(float(rng.uniform(0.7, 1.2)), 2)))
    scene.effect("drops", drops=drops)
    return scene


def deco():
    """A 1920s Art Deco sunrise in gold leaf on deep teal: a striped sun,
    rays and arches, inside a stepped double frame. The sunburst turns
    slowly, a sheen crosses the gold, and the sparkles twinkle."""
    img = vertical([(0.0, "#0F3236"), (0.6, "#0A2428"), (1.0, "#061519")])
    vig = vignette_factor(0.35)
    cx, cy = W / 2, H * 0.93
    dx, dy = XX - cx, cy - YY
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.arctan2(dx, dy)  # 0 = straight up
    # Metallic gold: the shade drifts with angle and radius, like leaf catching light.
    sheen = 0.5 + 0.5 * np.sin(theta * 4 + r * 0.006)
    gold = gradient([(0.0, "#9C6E28"), (0.55, "#D9AE58"), (1.0, "#F6DC94")], sheen)
    up = YY < cy
    step = math.pi / 30
    ink = np.zeros((H, W), np.float32)

    def ring(radius, width):
        return np.clip(width / 2 - np.abs(r - radius) + 0.5, 0, 1) * up

    # Rays: every 3rd wedge edge, long and short in turn.
    k = np.round(theta / (step * 3))
    perp = r * np.abs(np.sin(theta - k * step * 3))
    long_ray = (np.abs(k) % 2 == 0)
    reach = np.where(long_ray, 820, 700)
    rays = np.clip(1.0 - perp + 0.5, 0, 1) * (r > 300) * (r < reach) * up * (np.abs(theta) < math.pi / 2 - 0.05)
    ink = np.maximum(ink, rays * (1 - 0.6 * smoothstep(reach - 160, reach, r)))
    for radius, width in [(232, 3.0), (252, 1.4), (858, 2.4), (874, 1.2)]:
        ink = np.maximum(ink, ring(radius, width))
    # The sun: a gold half-disc cut by stripes that widen towards the horizon.
    sun = np.clip(204 - r + 0.5, 0, 1) * up
    h = (cy - YY) / 204
    stripes = np.ones((H, W), np.float32)
    for top, gap in [(0.42, 6), (0.30, 9), (0.19, 12), (0.09, 15)]:
        y_mid = cy - top * 204
        stripes *= 1 - np.clip(gap / 2 - np.abs(YY - y_mid) + 0.5, 0, 1)
    ink = np.maximum(ink, sun * stripes * (h > 0.02))
    ink = np.maximum(ink, np.clip(1.2 - np.abs(YY - cy) + 0.5, 0, 1) * (np.abs(XX - cx) < 900))

    def hline(y, x0, x1, width):
        along = np.clip(XX - x0 + 0.5, 0, 1) * np.clip(x1 - XX + 0.5, 0, 1)
        return np.clip(width / 2 - np.abs(YY - y) + 0.5, 0, 1) * along

    def vline(x, y0, y1, width):
        along = np.clip(YY - y0 + 0.5, 0, 1) * np.clip(y1 - YY + 0.5, 0, 1)
        return np.clip(width / 2 - np.abs(XX - x) + 0.5, 0, 1) * along

    def frame(inset, notch, width):
        a, n_ = inset, notch
        lines = [hline(a, a + n_, W - a - n_, width), hline(H - a, a + n_, W - a - n_, width),
                 vline(a, a + n_, H - a - n_, width), vline(W - a, a + n_, H - a - n_, width)]
        for cx_, sx_ in [(a, 1), (W - a, -1)]:
            for cy_, sy_ in [(a, 1), (H - a, -1)]:
                kx, ky = cx_ + sx_ * n_, cy_ + sy_ * n_
                lines.append(vline(kx, min(cy_, ky), max(cy_, ky), width))
                lines.append(hline(ky, min(cx_, kx), max(cx_, kx), width))
        return np.maximum.reduce(lines)

    ink = np.maximum(ink, frame(52, 34, 2.0))
    ink = np.maximum(ink, frame(64, 34, 1.0))
    scene = Scene("deco", img * vig[..., None])
    # Sunburst: lighter wedges on a disc that turns one wedge pair every two
    # minutes, inside a box that ends at the horizon.
    R, extra = 900, int(900 * math.sin(math.radians(14))) + 4
    wy, wx = np.mgrid[0:R + extra, 0:2 * R].astype(np.float32)
    wdx, wdy = wx - R, R - wy
    wr = np.sqrt(wdx * wdx + wdy * wdy)
    wt = np.arctan2(wdx, wdy)
    wedge = (np.floor((wt + math.pi) / step) % 2 == 0) & (wr < R)
    alpha = wedge * 0.03 * (1 - smoothstep(520, R, wr)) * (wr > 30)
    scene.add("wedges", rgba(rgb("#DDF3F0"), alpha.astype(np.float32)), 0, 0,
              "wall-spin 120s linear infinite", origin=f"{R}px {R}px",
              box=(int(cx - R), int(cy - R), 2 * R, R))
    gold_v = gold * vig[..., None]
    scene.add("ink", rgba(gold_v, ink), 0, 0, lossless=True)
    # The sheen: brighter gold, seen through a soft band that sweeps across
    # (app.css .wall-sheen).
    scene.add("sheen", rgba(rgb("#FFF1C4"), ink * 0.75), 0, 0, still=0, lossless=True, sheen=15)
    # Four-point sparkles in the sky, in two sets that twinkle in turn.
    rng = np.random.default_rng(61)
    s0, s1 = 120, int(cy - 600)
    sets = [np.zeros((s1 - s0, W), np.float32), np.zeros((s1 - s0, W), np.float32)]
    j = 0
    for _ in range(14):
        sx, sy = rng.uniform(180, W - 180), rng.uniform(140, cy - 640)
        if abs(sx - cx) < 200:
            continue
        s = rng.uniform(5, 11)
        adx, ady = np.abs(XX[s0:s1] - sx), np.abs(YY[s0:s1] - sy)
        star = np.clip(1 - (adx / s + ady / (s * 0.18)), 0, 1) + np.clip(1 - (ady / s + adx / (s * 0.18)), 0, 1)
        sets[j % 2] = np.maximum(sets[j % 2], np.clip(star * 1.6, 0, 1) * 0.85)
        j += 1
    for k, st in enumerate(sets):
        scene.add(f"sparkle{k}", rgba(rgb("#F6DC94"), st), 0, s0, pulse("pulse", 4.4, 2.2 * k),
                  still=1.0 if k == 0 else 0.12)
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
    light below; motion: dust drifting through its light. Midnight: a
    deep-blue haze at the floor and a few dim stars; motion: some twinkle,
    and now and then a shooting star. Dither only where there is light, so
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
    twinkle = np.zeros((H, W, 3), np.float32)
    for i in range(70):
        x, y = rng.integers(40, W - 40), rng.integers(30, int(H * 0.62))
        b = rng.uniform(18, 46)
        r = 1 if rng.random() < 0.8 else 2
        mid[y - r + 1:y + r, x - r + 1:x + r] += (b * 0.85, b * 0.9, b)
        if i % 3 == 0:  # a third of them twinkle
            twinkle[y - r + 1:y + r, x - r + 1:x + r] += (b * 0.85, b * 0.9, b)
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
    # Lamp: specks of dust in a seamless 960 px tile, seen only inside the
    # light (a mask on their box), drifting slowly right.
    period = 960
    dust = np.zeros((700, period, 3), np.float32)
    for _ in range(60):
        r = rng.uniform(0.8, 2.2)
        x, y = rng.uniform(0, period), rng.uniform(10, 690)
        b = rng.uniform(0.25, 0.7)
        for ox in (-period, 0, period):
            cx = x + ox
            xa, xb = max(int(cx - 5), 0), min(int(cx + 6), period)
            ya, yb = max(int(y - 5), 0), min(int(y + 6), 700)
            if xb <= xa:
                continue
            gy, gx = np.mgrid[ya:yb, xa:xb].astype(np.float32)
            d = np.sqrt((gx - cx) ** 2 + (gy - y) ** 2)
            dust[ya:yb, xa:xb] += (np.exp(-(d / r) ** 2) * b)[..., None] * rgb("#FFC890")
    save_rgba(tile2(light_rgba(dust)), OUT / "wall" / "lamp" / "dust.webp")
    mask = "radial-gradient(760px 760px at 800px -40px, #000 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 85%)"
    entries["lamp"] = [
        dict(src="img/ambient-lamp.jpg", x=0, y=0, w=W, h=H),
        dict(src="img/wall/lamp/dust.webp", x=0, y=0, w=2 * period, h=700,
             anim=drift(260, 30, period), box=dict(x=W - period, y=0, w=period, h=700, mask=mask)),
    ]
    save_rgba(light_rgba(twinkle[: int(H * 0.62)] / 255), OUT / "wall" / "midnight" / "twinkle.webp")
    calm = np.clip(walls["midnight"] - twinkle, 0, 255)
    lit = calm.max(axis=2, keepdims=True) > 0.2
    calm = np.where(lit, calm + (rng.uniform(-0.5, 0.5, calm.shape) + rng.uniform(-0.5, 0.5, calm.shape)), calm)
    Image.fromarray(np.clip(np.rint(calm), 0, 255).astype(np.uint8), "RGB").save(
        OUT / "wall" / "midnight" / "base.jpg", quality=90, optimize=True)
    entries["midnight"] = [
        dict(src="img/wall/midnight/base.jpg", x=0, y=0, w=W, h=H),
        dict(src="img/wall/midnight/twinkle.webp", x=0, y=0, w=W, h=int(H * 0.62),
             anim=pulse("pulse", 6.5, 1.5)),
        dict(kind="shoot", x=260, y=90, angle=16, length=760, dur=47, delay=12),
    ]
    return entries


SCENES = {"sunset": sunset, "coast": coast, "dunes": dunes, "aurora": aurora, "rain": rain, "deco": deco}


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
    for i, name in enumerate(["sunset", "aurora", "coast", "deco"]):
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
    if all((OUT / f"thumb-wall-{n}.jpg").exists() for n in ["sunset", "aurora", "coast", "deco"]):
        rotate_thumb()
    if args.sheet:
        contact_sheet(names)


if __name__ == "__main__":
    main()
