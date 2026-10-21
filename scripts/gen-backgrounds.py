"""Renders the theme backgrounds as files, so the TV never draws gradients or
blurs live. For each theme it writes:

  app/img/bg-<id>.jpg       1920x1080 background
  app/img/bg-<id>-blur.jpg  the same image heavily blurred, used for fake glass
  app/img/thumb-<id>.jpg    240x135 swatch for the settings screen

and the 512x512 app icon (app/icon.png) shown in Samsung's app bar, plus the
Ambient screen's wallpapers (app/img/ambient-<id>.jpg): almost entirely pure
black, so a local-dimming TV can switch most of its backlight zones off.

Everything is procedural (soft colour fields plus fine grain), so there are
no photo licences to track. Run: python3 scripts/gen-backgrounds.py
"""
from pathlib import Path
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

W, H = 1920, 1080
OUT = Path(__file__).resolve().parent.parent / "app" / "img"

# (base colour, [(x, y, radius, colour, strength)], grain strength)
THEMES = {
    "dusk": ("#090C1F", [
        (0.22, 0.18, 0.34, "#33287A", 0.85),
        (0.86, 0.30, 0.30, "#8E3B70", 0.65),
        (0.74, 1.00, 0.30, "#C4664A", 0.50),
        (0.02, 0.98, 0.26, "#1B3A80", 0.55),
    ], 0.035),
    "tide": ("#03121A", [
        (0.18, 0.22, 0.34, "#0C5563", 0.85),
        (0.88, 0.18, 0.28, "#17708F", 0.60),
        (0.62, 0.98, 0.34, "#113A6A", 0.80),
        (0.98, 0.86, 0.20, "#2A9488", 0.40),
    ], 0.035),
    "ember": ("#120805", [
        (0.16, 0.86, 0.36, "#6E2410", 0.85),
        (0.88, 0.26, 0.30, "#9E461B", 0.60),
        (0.52, 0.02, 0.26, "#4E1A28", 0.60),
        (0.98, 0.98, 0.22, "#C27D44", 0.40),
    ], 0.035),
    "night": ("#000000", [
        (0.50, 0.42, 0.42, "#101014", 0.70),
    ], 0.02),
    "paper": ("#ECE6DB", [
        (0.14, 0.18, 0.34, "#E0D2BB", 0.85),
        (0.88, 0.82, 0.34, "#D6C6AC", 0.75),
        (0.92, 0.08, 0.24, "#F5F1EA", 0.70),
    ], 0.025),
}


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def field(base, blobs):
    img = Image.new("RGB", (W, H), hex_rgb(base))
    for x, y, r, colour, strength in blobs:
        mask = Image.new("L", (W, H), 0)
        rad = int(r * W)
        cx, cy = int(x * W), int(y * H)
        ImageDraw.Draw(mask).ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=int(255 * strength))
        # Blur in a downscaled copy: same look, a fraction of the time.
        small = mask.resize((W // 8, H // 8), Image.BILINEAR).filter(ImageFilter.GaussianBlur(rad / 8 * 0.6))
        mask = small.resize((W, H), Image.BICUBIC)
        img = Image.composite(Image.new("RGB", (W, H), hex_rgb(colour)), img, mask)
    return img


def grain(img, amount, seed):
    """Adds fine signed noise (a few levels either way). Besides the film look,
    it dithers the 8-bit gradients so dark themes don't band on the panel."""
    if amount <= 0:
        return img
    random.seed(seed)
    noise = Image.effect_noise((W, H), amount * 100).convert("RGB")  # centred on 128
    return ImageChops.add(img, noise, 1.0, -128)


def icon():
    """Three bars on the Dusk field, the top one lit: a list with focus."""
    size = 512
    img = Image.open(OUT / "bg-dusk-blur.jpg").crop((240, 0, 240 + 1080, 1080)).resize((size, size), Image.LANCZOS)
    shade = Image.new("RGB", (size, size), (10, 12, 30))
    img = Image.blend(img, shade, 0.25)
    draw = ImageDraw.Draw(img, "RGBA")
    left, height, gap = 132, 56, 34
    top = (size - (3 * height + 2 * gap)) // 2
    bars = [(288, (255, 255, 255, 255)), (224, (255, 255, 255, 120)), (160, (255, 255, 255, 120))]
    for i, (width, colour) in enumerate(bars):
        y = top + i * (height + gap)
        draw.rounded_rectangle((left, y, left + width, y + height), radius=height // 2, fill=colour)
    draw.rounded_rectangle((left - 40, top + 8, left - 22, top + height - 8), radius=9, fill=(242, 180, 156, 255))
    img.save(OUT.parent / "icon.png", optimize=True)
    print("icon: wrote app/icon.png")


def dark_glow(img_arr, cx, cy, radius, rgb, peak):
    """Adds a soft radial glow (smoothstep falloff) to a float RGB array."""
    import numpy as np
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / radius
    t = np.clip(1 - d, 0, 1)
    w = t * t * (3 - 2 * t) * peak
    for c in range(3):
        img_arr[..., c] += w * rgb[c]


def ambient():
    """Lamp: a warm lamp just out of frame, top right, and its faint pool of
    light below. Midnight: a deep-blue haze at the floor and a few dim stars.
    Dither only where there is light, so black stays exactly black."""
    import numpy as np
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
        apl = float(np.clip(arr, 0, 255).mean() / 255 * 100)
        print(f"ambient-{name}: wrote (average picture level {apl:.2f}%)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (name, (base, blobs, amount)) in enumerate(THEMES.items()):
        smooth = field(base, blobs)
        img = grain(smooth, amount, seed=i)
        img.save(OUT / f"bg-{name}.jpg", quality=84, optimize=True, progressive=True)
        blur = smooth.resize((W // 4, H // 4), Image.BILINEAR).filter(ImageFilter.GaussianBlur(14)).resize((W, H), Image.BICUBIC)
        blur.save(OUT / f"bg-{name}-blur.jpg", quality=80, optimize=True, progressive=True)
        img.resize((240, 135), Image.LANCZOS).save(OUT / f"thumb-{name}.jpg", quality=85)
        print(f"{name}: wrote bg, blur and thumb")
    icon()
    ambient()


if __name__ == "__main__":
    main()
