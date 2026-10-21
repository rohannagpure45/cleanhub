"""Fetches the app icons Clean Hub shows for the apps it recognises, so a tile
never depends on the icon the TV hands a web app (on the QN85B, YouTube's is
Tizen's placeholder pinwheel and Prime Video's won't load at all):

  python3 scripts/fetch-icons.py            # download (once) + process
  python3 scripts/fetch-icons.py --offline  # process what's already downloaded
  python3 scripts/fetch-icons.py --force    # download everything again

Sources are listed in scripts/app-icons.json: each app's own App Store icon
(through Apple's public iTunes Search API), or its Google Play icon for apps
with no iOS version. Downloads go to dist/icons-raw/ (ignored by git); each
is checked to be an image and written as a square, opaque SIZE x SIZE PNG to
app/img/apps/<key>.png; an icon drawn as a circle or rounded square gets its
corners filled with its own edge colour. Rounding is left to the CSS. Needs
Pillow.
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "scripts" / "app-icons.json"
RAW = ROOT / "dist" / "icons-raw"
OUT = ROOT / "app" / "img" / "apps"
SIZE = 192  # the dock tile is 148 px on the TV's 1920-wide page
USER_AGENT = "Mozilla/5.0 (Macintosh) CleanHubPersonal/0.1 (personal TV launcher)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.headers.get("Content-Type", ""), r.read()


def appstore_url(bundle_id, country):
    query = urllib.parse.urlencode({"bundleId": bundle_id, "country": country})
    _, body = get("https://itunes.apple.com/lookup?" + query)
    results = json.loads(body).get("results", [])
    if not results or not results[0].get("artworkUrl512"):
        raise SystemExit(f"App Store has no app {bundle_id!r} in {country!r}")
    # .../512x512bb.jpg -> .../512x512bb.png: the same artwork, losslessly.
    return re.sub(r"/\d+x\d+bb\.\w+$", "/512x512bb.png", results[0]["artworkUrl512"])


def play_url(package):
    query = urllib.parse.urlencode({"id": package, "hl": "en_US", "gl": "US"})
    _, body = get("https://play.google.com/store/apps/details?" + query)
    found = re.search(r'<meta property="og:image" content="(https://play-lh\.googleusercontent\.com/[^"=]+)',
                      body.decode("utf-8", "replace"))
    if not found:
        raise SystemExit(f"Google Play has no icon for {package!r}")
    return found.group(1) + "=s512"


def source_url(src):
    if "appstore" in src:
        return appstore_url(src["appstore"], src.get("country", "us"))
    if "play" in src:
        return play_url(src["play"])
    return src["url"]


def download(key, src, force):
    RAW.mkdir(parents=True, exist_ok=True)
    dest = RAW / (key + ".img")
    if dest.exists() and not force:
        return dest
    url = source_url(src)
    kind, body = get(url)
    if not kind.startswith("image/"):
        raise SystemExit(f"{key}: expected an image, got {kind!r} from {url}")
    dest.write_bytes(body)
    return dest


def fill_colour(img):
    """The colour just inside the middle of each edge (the median of the four),
    for the corners of an icon drawn as a circle or rounded square."""
    w, h = img.size
    samples = [img.getpixel((w // 2, round(h * 0.04))), img.getpixel((w // 2, round(h * 0.96))),
               img.getpixel((round(w * 0.04), h // 2)), img.getpixel((round(w * 0.96), h // 2))]
    return tuple(sorted(c[i] for c in samples)[1] for i in range(3)) + (255,)


def process(key, raw):
    img = Image.open(raw)
    img.load()
    img = img.convert("RGBA")
    side = min(img.size)
    img = img.crop(((img.width - side) // 2, (img.height - side) // 2,
                    (img.width + side) // 2, (img.height + side) // 2))
    flat = Image.new("RGBA", img.size, fill_colour(img))
    flat.alpha_composite(img)
    out = flat.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / (key + ".png"), optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--offline", action="store_true", help="only process icons already downloaded")
    parser.add_argument("--force", action="store_true", help="download every icon again")
    args = parser.parse_args()
    sources = {k: v for k, v in json.loads(SOURCES.read_text()).items() if not k.startswith("_")}
    missing = []
    for key, src in sources.items():
        raw = RAW / (key + ".img")
        if not args.offline:
            raw = download(key, src, args.force)
        if not raw.exists():
            missing.append(key)
            continue
        process(key, raw)
        print(f"  {key}")
    stale = sorted(p.stem for p in OUT.glob("*.png") if p.stem not in sources)
    for key in stale:
        (OUT / (key + ".png")).unlink()
    if stale:
        print("Removed icons no longer listed: " + ", ".join(stale))
    if missing:
        sys.exit("Not downloaded yet (run without --offline): " + ", ".join(missing))
    print(f"Wrote {len(sources)} icons to {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
