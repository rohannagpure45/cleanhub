"""Renders the Ambient screen's wallpapers into app/img/:

  ambient-<id>.jpg     1920x1080 wallpaper
  thumb-wall-<id>.jpg  240x135 swatch for the Settings row

Two kinds, matching CH.options.wallpaper in app/js/options.js:
- dark (lamp, midnight; black needs no file): almost entirely pure black, so
  a local-dimming TV can switch most of its backlight zones off.
- scenes (sunset, coast, dunes, aurora, rain, deco): full-colour pictures for
  when power doesn't matter. Rotate shows them in turn.

Everything is procedural, so there are no image licences to track.
  python3 scripts/gen-wallpapers.py                  # all of them
  python3 scripts/gen-wallpapers.py --only coast,deco
  python3 scripts/gen-wallpapers.py --sheet          # also dist/wallpapers.jpg
Needs numpy, scipy and Pillow.
"""
import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.interpolate import PchipInterpolator

W, H = 1920, 1080
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "img"
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
    lattice points; fbm() sums octaves. Roughly -1..1."""

    def __init__(self, seed, size=256):
        self.size = size
        self.table = np.random.default_rng(seed).uniform(-1, 1, (size, size)).astype(np.float32)

    def __call__(self, x, y):
        x = np.asarray(x, np.float32)
        y = np.asarray(y, np.float32)
        x0 = np.floor(x)
        y0 = np.floor(y)
        fx = x - x0
        fy = y - y0
        fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        s = self.size
        xi = x0.astype(np.int64) % s
        yi = y0.astype(np.int64) % s
        xj = (xi + 1) % s
        yj = (yi + 1) % s
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
    """Paints `colour` (3,) or (H, W, 3) over img with coverage alpha (H, W)."""
    a = alpha[..., None]
    return img * (1 - a) + colour * a


def glow(img, cx, cy, radius, colour, strength):
    """Adds a soft Gaussian glow, the way light adds."""
    d2 = ((XX - cx) ** 2 + (YY - cy) ** 2) / (radius * radius)
    img += (np.exp(-d2 * 2.2) * strength)[..., None] * rgb(colour)


def screen(img, light):
    """Screen blend: light adds up without blowing out to flat white."""
    return 1 - (1 - np.clip(img, 0, 1)) * (1 - np.clip(light, 0, 1))


def blur(arr, radius, scale=4):
    """A wide Gaussian blur of an (H, W) or (H, W, 3) array, done downscaled."""
    chans = [arr] if arr.ndim == 2 else [arr[..., c] for c in range(arr.shape[2])]
    out = []
    for ch in chans:
        small = ch.reshape(H // scale, scale, W // scale, scale).mean(axis=(1, 3))
        small = gaussian_filter(small.astype(np.float32), radius / scale, mode="nearest")
        big = Image.fromarray(small, "F").resize((W, H), Image.BICUBIC)
        out.append(np.asarray(big, np.float32))
    return out[0] if arr.ndim == 2 else np.stack(out, axis=2)


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


def vignette(img, strength):
    d = np.sqrt(((XX - W / 2) / (W / 2)) ** 2 + ((YY - H / 2) / (H / 2)) ** 2) / math.sqrt(2)
    return img * (1 - strength * smoothstep(0.45, 1.0, d))[..., None]


# ---- Scenes -----------------------------------------------------------------

def sunset():
    """Layered hills at sundown: the sun half behind the far ridge, mist
    pooling in each valley, the near hills deep plum."""
    n = Noise(11)
    img = vertical([(0.0, "#1C1846"), (0.22, "#3A2A6E"), (0.40, "#7E3F7F"), (0.52, "#C85A78"),
                    (0.60, "#F08A62"), (0.66, "#FFBE7E"), (1.0, "#FFD8A2")])
    sx, sy = 0.66 * W, 0.585 * H
    glow(img, sx, sy, 900, "#FF8F5A", 0.30)
    glow(img, sx, sy, 300, "#FFD29A", 0.40)
    img = over(img, rgb("#FFF2D2"), disc(sx, sy, 62, 1.2))
    # Long thin clouds, lit from below by the low sun.
    cl = n.fbm(XX / 700, YY / 26, 5)
    band = smoothstep(0.14 * H, 0.26 * H, YY) * (1 - smoothstep(0.46 * H, 0.56 * H, YY))
    amount = np.clip((cl - 0.12) * 2.4, 0, 1) * band * 0.6
    tint = gradient([(0.10, "#7A4A8E"), (0.32, "#D97C98"), (0.50, "#FFB68C")], YY / H)
    img = over(img, tint, amount)
    fog = rgb("#F5A882")
    layers = [  # base (fraction of height), height of hills (px), feature size (px), colour
        (0.600, 58, 520, "#C27493"),
        (0.655, 80, 460, "#94508A"),
        (0.725, 96, 420, "#6A3878"),
        (0.805, 104, 400, "#452760"),
        (0.900, 120, 460, "#251640"),
    ]
    for i, (base, amp, size, colour) in enumerate(layers):
        seed = 3.7 * (i + 1)

        def line(x, base=base, amp=amp, size=size, seed=seed):
            hills = n.fbm(x / size + seed, seed * 2, 5, 0.45)
            return base * H - amp * (0.55 + 0.75 * hills)

        cov = below(line)
        depth = YY - line(np.arange(W, dtype=np.float32))[None, :]
        # Mist in the valley in front of each ridge: lighter towards its foot.
        mist = smoothstep(0, 240, depth) * (0.42 - 0.07 * i)
        col = rgb(colour)[None, None, :] * (1 - mist[..., None]) + fog * mist[..., None]
        img = over(img, col, cov)
    return img


def coast():
    """Golden hour over open sea: a low sun, its path glittering on the
    water, a hazy headland on the left."""
    n = Noise(23)
    hz = 0.60 * H
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
    # Soft clouds, warm underneath.
    cl = n.fbm(XX / 520, YY / 90, 6)
    band = smoothstep(0.06 * H, 0.16 * H, YY) * (1 - smoothstep(0.36 * H, 0.48 * H, YY))
    amount = np.clip((cl - 0.05) * 1.8, 0, 1) * band
    shade = gradient([(0.0, "#A9B9CF"), (0.30, "#E7C9B6"), (0.45, "#FBD7B2")], YY / H)
    img = over(img, shade, amount * 0.75)
    # Headland: a low hazy ridge on the left, meeting the horizon.
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
    # The sun's path: a widening band of glints below it.
    path = np.exp(-((XX - sx) / (22 + z * 0.55)) ** 2)
    glint = np.clip((n.fbm(wx / 0.45 + 50, depth / 0.22, 3) - 0.22) * 4.5, 0, 1) ** 2
    shine = path * (0.18 + glint) * np.exp(-z / 380) * 0.9
    water = water + shine[..., None] * rgb("#FFDDA6")
    # Warm sky light on the water near the horizon.
    water = over(water, rgb("#F2C29A"), np.exp(-z / 26) * 0.55)
    img = np.where((YY >= hz)[..., None], water, img)
    # Soften the horizon line by a pixel.
    edge = np.exp(-((YY - hz) / 1.2) ** 2) * 0.35
    img = over(img, rgb("#D9B8A0"), edge)
    return img


def dunes():
    """Bright desert: smooth dunes under a pale blue sky, each with a sunlit
    face and a shaded lee, fine ripples on the near ones."""
    n = Noise(37)
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
    return img


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


def aurora():
    """Northern lights over a still lake: green curtains fading to violet,
    stars, a spruce ridge, all mirrored in the water."""
    n = Noise(41)
    rng = np.random.default_rng(41)
    shore = int(0.79 * H)
    img = vertical([(0.0, "#02050E"), (0.40, "#051326"), (0.70, "#0A2538"), (0.79, "#0D2B3C"), (1.0, "#0D2B3C")])
    # Stars, thinning towards the horizon.
    stars = np.zeros((H, W), np.float32)
    for _ in range(520):
        x, y = rng.uniform(4, W - 4), rng.uniform(4, shore - 40)
        b = rng.pareto(2.2) * 0.18 + 0.12
        b *= 1 - 0.8 * smoothstep(0.50 * H, 0.76 * H, y)
        s = rng.uniform(0.55, 1.0)
        xi, yi = int(x), int(y)
        yy, xx = YY[yi - 3:yi + 4, xi - 3:xi + 4], XX[yi - 3:yi + 4, xi - 3:xi + 4]
        stars[yi - 3:yi + 4, xi - 3:xi + 4] += b * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * s * s))
    img = img + stars[..., None] * rgb("#E6EEFF")
    # Two curtains. d = height above each curtain's lower edge.
    light = np.zeros((H, W, 3), np.float32)
    curtains = [  # lower edge at the left and right (fractions of height), fold, fold length, ray height, strength
        (0.66, 0.24, 46, 760, 380, 1.0),
        (0.20, 0.40, 26, 560, 240, 0.45),
    ]
    for k, (y_left, y_right, amp, period, tall, strength) in enumerate(curtains):
        phase = 1.3 + 2.1 * k
        # A folding ribbon sweeping across the sky on a slant. (Level with
        # the horizon, its lower edge reads as the outline of hills.)
        slant = H * (y_left + (y_right - y_left) * XX / W)
        edge = (slant + amp * np.sin(2 * math.pi * XX / period + phase)
                + 30 * n.fbm(XX / 300 + 10 * k, 3.3 * k, 3))
        d = edge - YY
        upper = np.exp(-np.maximum(d, 0) / tall)
        # Rays: fine vertical streaks, leaning slightly with height.
        rays = 0.45 + 0.55 * np.clip(0.5 + 0.9 * n.fbm((XX + d * 0.18) / 26 + 70 * k, 1.7 * k, 4), 0, 1)
        # The lower fringe is ragged, the rays poking down through it, so it
        # never reads as the smooth outline of a hill.
        lower = smoothstep(-14, 6, d + 26 * (rays - 0.72)) ** 1.4
        along = np.clip(0.35 + 0.9 * n.fbm(XX / 650 + 40 * k, 8.8 * k, 3), 0, 1)
        # Light scattered below the fringe: the edge reads as something
        # glowing, not as a shape in front of it.
        spill = np.exp(np.minimum(d, 0) / 150) * 0.32 * (1 - lower)
        i_ = (lower * upper * rays + spill) * along * strength
        t = np.clip(d / (tall * 1.4), 0, 1)
        col = gradient([(0.0, "#46FFA8"), (0.25, "#2EE8B0"), (0.55, "#2FB8C8"), (1.0, "#8E5BFF")], t)
        light += i_[..., None] * col
    light = light * 0.9 + blur(light, 40) * 0.4
    # Faint green airglow low in the sky, so the dark below the curtains
    # reads as sky rather than as a hillside.
    air = np.exp(-((YY - (shore - 70)) / 150) ** 2) * 0.10
    light += air[..., None] * rgb("#3FD9A0")
    img = screen(img, light)
    # Ridge and trees, black against the glow.
    def ridge(x):
        return shore - 16 - 38 * (0.5 + 0.5 * n.fbm(x / 380 + 2.2, 9.1, 4)) * (0.4 + 0.6 * (np.abs(x - W / 2) / (W / 2)))
    land = np.maximum(below(ridge), spruce_line(n, ridge, 120, rng))
    img = over(img, rgb("#03080D"), land)
    # Lake: the scene above, mirrored, darkened, broken by faint ripples.
    rows = np.arange(shore, H)
    src = np.clip(2 * shore - rows - 1, 0, shore - 1)
    refl = img[src].copy()
    zr = (rows - shore).astype(np.float32)
    shift = (np.sin(zr * 0.9) * 1.5 + n.fbm(zr / 3, 4.4, 3) * 4) * smoothstep(0, 120, zr)
    for j, s in enumerate(shift.astype(int)):
        refl[j] = np.roll(refl[j], s, axis=0)
    refl = refl * (0.55 - 0.15 * smoothstep(0, H - shore, zr))[:, None, None]
    ripple = np.clip(n.fbm(XX[shore:] / 300, (YY[shore:] - shore) / 4, 3) - 0.35, 0, 1)
    refl = refl * (1 - 0.35 * ripple[..., None])
    img[shore:] = refl
    img = over(img, rgb("#02060A"), np.exp(-((YY - shore) / 1.5) ** 2) * 0.8)
    return img


def rain():
    """City lights out of focus through a rainy window at night."""
    n = Noise(53)
    rng = np.random.default_rng(53)
    img = vertical([(0.0, "#070C18"), (0.45, "#0C1524"), (1.0, "#16121E")])
    palette = [("#FFA238", 0.34), ("#FFD9A0", 0.16), ("#FF4B36", 0.13), ("#2FD0BE", 0.11),
               ("#4C7DFF", 0.13), ("#E0499F", 0.07), ("#FFCF4A", 0.06)]
    names = [p[0] for p in palette]
    weights = np.array([p[1] for p in palette])
    light = np.zeros((H, W, 3), np.float32)
    for _ in range(190):
        r = float(np.exp(rng.uniform(math.log(12), math.log(96))))
        x = rng.uniform(-r, W + r)
        y = H * (0.18 + 0.86 * rng.beta(2.4, 1.6))
        col = rgb(names[rng.choice(len(names), p=weights / weights.sum())])
        # Big discs are nearer the lens: dimmer and softer.
        b = rng.uniform(0.35, 0.95) * (1.15 - 0.6 * (r - 12) / 84)
        soft = 1.0 + r * 0.035
        y0, y1 = max(int(y - r - 4), 0), min(int(y + r + 5), H)
        x0, x1 = max(int(x - r - 4), 0), min(int(x + r + 5), W)
        if y1 <= y0 or x1 <= x0:
            continue
        d = np.sqrt((XX[y0:y1, x0:x1] - x) ** 2 + (YY[y0:y1, x0:x1] - y) ** 2)
        cov = np.clip((r - d) / soft + 0.5, 0, 1)
        rim = np.exp(-((r - d) / (0.10 * r + 1.5)) ** 2) * 0.35
        light[y0:y1, x0:x1] += ((0.62 + rim) * cov * b)[..., None] * col * 0.72
    # A scatter of small, sharp, bright lights further off.
    for _ in range(40):
        x, y = rng.uniform(0, W), H * (0.30 + 0.70 * rng.beta(2.4, 1.6))
        col = rgb(names[rng.choice(len(names), p=weights / weights.sum())])
        r = rng.uniform(2.5, 6)
        y0, y1, x0, x1 = max(int(y - 12), 0), min(int(y + 13), H), max(int(x - 12), 0), min(int(x + 13), W)
        d = np.sqrt((XX[y0:y1, x0:x1] - x) ** 2 + (YY[y0:y1, x0:x1] - y) ** 2)
        light[y0:y1, x0:x1] += (np.clip((r - d) / 1.2 + 0.5, 0, 1) * rng.uniform(0.6, 1.0))[..., None] * col
    light = light + blur(light, 60) * 0.35
    img = screen(img, light)
    img = vignette(img, 0.45)
    # Raindrops on the glass: a little brighter inside, a dark lower rim and
    # a highlight where the window catches the light.
    for _ in range(330):
        r = rng.uniform(2.0, 7.5)
        x, y = rng.uniform(10, W - 10), rng.uniform(10, H - 10)
        y0, y1, x0, x1 = int(y - r - 3), int(y + r + 4), int(x - r - 3), int(x + r + 4)
        yy, xx = YY[y0:y1, x0:x1], XX[y0:y1, x0:x1]
        d = np.sqrt((xx - x) ** 2 + ((yy - y) * 1.1) ** 2)
        inside = np.clip((r - d) / 0.8 + 0.5, 0, 1)
        lower = np.clip((yy - y) / r, 0, 1) * np.exp(-((r - d) / 1.2) ** 2)
        spot = np.exp(-(((xx - x + 0.35 * r) ** 2 + (yy - y + 0.4 * r) ** 2) / (0.09 * r * r + 0.3)))
        patch = img[y0:y1, x0:x1]
        patch = patch * (1 + 0.18 * inside)[..., None]
        patch = patch * (1 - 0.45 * lower)[..., None]
        patch = patch + (spot * 0.55 * inside)[..., None] * rgb("#F2F4FF")
        img[y0:y1, x0:x1] = patch
    # A few trickles.
    for _ in range(16):
        x = rng.uniform(40, W - 40)
        y_top = rng.uniform(0, H * 0.7)
        length = rng.uniform(90, 320)
        rows = np.arange(int(y_top), min(int(y_top + length), H))
        cx = x + 3 * n.fbm(rows / 40.0, x, 3)
        for yy, c in zip(rows, cx):
            fade = 1 - (yy - y_top) / length
            for dx in range(-2, 3):
                xi = int(c) + dx
                w = max(0.0, 1 - abs(xi + 0.5 - c) / 1.6)
                img[yy, xi] = img[yy, xi] * (1 + 0.22 * w * fade) + 0.02 * w * fade
    return img


def deco():
    """A 1920s Art Deco sunrise in gold leaf on deep teal: a striped sun,
    rays and arches, inside a stepped double frame."""
    img = vertical([(0.0, "#0F3236"), (0.6, "#0A2428"), (1.0, "#061519")])
    cx, cy = W / 2, H * 0.93
    dx, dy = XX - cx, cy - YY
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.arctan2(dx, dy)  # 0 = straight up
    # Metallic gold: the shade drifts with angle and radius, like leaf catching light.
    sheen = 0.5 + 0.5 * np.sin(theta * 4 + r * 0.006)
    gold = gradient([(0.0, "#9C6E28"), (0.55, "#D9AE58"), (1.0, "#F6DC94")], sheen)
    up = YY < cy
    # Sunburst: alternate wedges a shade lighter.
    step = math.pi / 30
    wedge = (np.floor((theta + math.pi) / step) % 2 == 0) & up & (r < 900)
    img = img * (1 + 0.07 * wedge * (1 - smoothstep(500, 900, r)))[..., None]
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
    # Horizon rule.
    ink = np.maximum(ink, np.clip(1.2 - np.abs(YY - cy) + 0.5, 0, 1) * (np.abs(XX - cx) < 900))
    # Stepped double frame: each corner turns inward around a small square.
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
    # A few four-point sparkles in the sky.
    rng = np.random.default_rng(61)
    for _ in range(14):
        sx, sy = rng.uniform(180, W - 180), rng.uniform(140, cy - 640)
        if abs(sx - cx) < 200:
            continue
        s = rng.uniform(5, 11)
        adx, ady = np.abs(XX - sx), np.abs(YY - sy)
        star = np.clip(1 - (adx / s + ady / (s * 0.18)), 0, 1) + np.clip(1 - (ady / s + adx / (s * 0.18)), 0, 1)
        ink = np.maximum(ink, np.clip(star * 1.6, 0, 1) * 0.85)
    img = over(img, gold, ink)
    return vignette(img, 0.35)


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
    light below. Midnight: a deep-blue haze at the floor and a few dim stars.
    Dither only where there is light, so black stays exactly black."""
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
    for _ in range(70):
        x, y = rng.integers(40, W - 40), rng.integers(30, int(H * 0.62))
        b = rng.uniform(18, 46)
        r = 1 if rng.random() < 0.8 else 2
        mid[y - r + 1:y + r, x - r + 1:x + r] += (b * 0.85, b * 0.9, b)
    walls["midnight"] = mid
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


SCENES = {"sunset": sunset, "coast": coast, "dunes": dunes, "aurora": aurora, "rain": rain, "deco": deco}


def save_scene(name, img):
    """Dithered to 8 bits (no banding in the big skies), 4:4:4 JPEG so thin
    gold lines and star points keep their colour."""
    rng = np.random.default_rng(99)
    arr = np.clip(img, 0, 1) * 255
    arr += rng.uniform(-0.5, 0.5, arr.shape) + rng.uniform(-0.5, 0.5, arr.shape)
    out = Image.fromarray(np.clip(np.rint(arr), 0, 255).astype(np.uint8), "RGB")
    out.save(OUT / f"ambient-{name}.jpg", quality=88, optimize=True, progressive=True, subsampling=0)
    out.resize(THUMB, Image.LANCZOS).save(OUT / f"thumb-wall-{name}.jpg", quality=88)
    size = (OUT / f"ambient-{name}.jpg").stat().st_size
    print(f"ambient-{name}: wrote ({size // 1024} KB, average level {arr.mean() / 2.55:.0f}%)")


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
    ap.add_argument("--only", help="comma-separated scene ids (skips the dark ones)")
    ap.add_argument("--sheet", action="store_true", help="also write a contact sheet to dist/wallpapers.jpg")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    names = args.only.split(",") if args.only else list(SCENES)
    unknown = [n for n in names if n not in SCENES]
    if unknown:
        raise SystemExit(f"unknown scene(s): {', '.join(unknown)}; choose from {', '.join(SCENES)}")
    if not args.only:
        dark()
    for name in names:
        save_scene(name, SCENES[name]())
    if all((OUT / f"thumb-wall-{n}.jpg").exists() for n in ["sunset", "aurora", "coast", "deco"]):
        rotate_thumb()
    if args.sheet:
        contact_sheet(names)


if __name__ == "__main__":
    main()
