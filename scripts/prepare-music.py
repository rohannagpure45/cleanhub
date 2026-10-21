"""Fetches the public-domain and CC0 recordings listed in scripts/music/<set>.json
and prepares them for the Ambient screen, one set per Settings → Ambient music
choice (vintage = 1920s, classical, piano, ragtime, bigband, ambient):

  python3 scripts/prepare-music.py                  # every set: download (once) + process
  python3 scripts/prepare-music.py piano ragtime    # just these sets
  python3 scripts/prepare-music.py --offline        # process what's already downloaded

Downloads go to dist/music-raw/<set>/ (ignored by git). Each recording is
decoded, trimmed, cleaned for its kind (a set's "profile": "78rpm" filters
shellac hiss and rumble and folds to mono; "modern" keeps stereo), levelled to
sit with the other tracks, and encoded as AAC into app/music/<set>/. Writes
app/music/<set>.js, which adds the set to the playlist. Needs numpy, scipy and
macOS's afconvert/afinfo.
"""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "scripts" / "music"
RAW = ROOT / "dist" / "music-raw"
MUSIC = ROOT / "app" / "music"
SR = 44100
USER_AGENT = "CleanHubPersonal/0.1 (personal TV launcher)"

# How each kind of recording is cleaned. Levels sit a touch under the
# originals (-19 dBFS): mono 78s read louder, and quiet classical shouldn't
# be pushed into its limiter.
# A track can name its own "profile" (a set of piano renderings with a few
# 78s, say); a set's "bitrate" applies to tracks on the set's own profile.
PROFILES = {
    # Shellac: rumble below 60 Hz and hiss above ~7 kHz carry no music.
    "78rpm": {"channels": 1, "band": (60, 7000), "rms_db": -21.0, "floor": 0.03, "bitrate": 64000},
    # Modern recordings only lose subsonic rumble; a low trim threshold keeps
    # quiet openings and reverb tails.
    "modern": {"channels": 2, "band": (25, None), "rms_db": -21.0, "floor": 0.003, "bitrate": 96000},
}
AUDIO_EXTS = (".mp3", ".flac", ".wav", ".m4a", ".aac")


def raw_path(set_id, track):
    ext = Path(urllib.parse.urlparse(track["url"]).path).suffix.lower()
    return RAW / set_id / (track["id"] + (ext if ext in AUDIO_EXTS else ".mp3"))


def download(set_id, track):
    dest = raw_path(set_id, track)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 100_000:
        return dest
    req = urllib.request.Request(track["url"], headers={"User-Agent": USER_AGENT})
    tmp = dest.with_suffix(".part")
    # Wikimedia rate-limits bursts (HTTP 429): wait as asked, then retry.
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                kind = r.headers.get("Content-Type", "")
                if not (kind.startswith("audio/") or kind == "application/octet-stream"):
                    raise SystemExit(f"{track['id']}: expected audio, got {kind!r} from {track['url']}")
                shutil.copyfileobj(r, f, 1 << 16)
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 5:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
            print(f"  {track['id']}: rate-limited, retrying in {wait}s")
            time.sleep(wait)
    tmp.rename(dest)
    time.sleep(3)  # be gentle between files
    return dest


def decode(src, channels, tmp):
    wav = Path(tmp) / "decoded.wav"
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{SR}", "-c", str(channels), str(src), str(wav)],
                   check=True, capture_output=True)
    with warnings.catch_warnings():  # afconvert adds a padding chunk scipy doesn't know
        warnings.simplefilter("ignore", wavfile.WavFileWarning)
        rate, x = wavfile.read(wav)
    assert rate == SR, rate
    x = x.astype(np.float32) / 32768
    return x.reshape(len(x), -1)  # (samples, channels), mono included


def frame_rms(x, win):
    mono = x.mean(axis=1)
    n = len(mono) // win * win
    return np.sqrt(np.mean(mono[:n].reshape(-1, win) ** 2, axis=1))


def clean(x, profile):
    """Filter for the profile, trim near-silent lead-in/out, level by the loud
    passages, soft-limit, short fades."""
    low, high = profile["band"]
    if high:
        sos = butter(2, [low, high], btype="band", fs=SR, output="sos")
    else:
        sos = butter(2, low, btype="high", fs=SR, output="sos")
    x = sosfiltfilt(sos, x, axis=0).astype(np.float32)
    win = SR // 10
    frames = frame_rms(x, win)
    loud = np.nonzero(frames > frames.max() * profile["floor"])[0]
    start, end = max(0, loud[0] - 2) * win, min(len(x), (loud[-1] + 3) * win)
    x = x[start:end]
    # Level by the loud passages (ignore the quiet tail of the distribution).
    frames = frame_rms(x, win)
    level = np.sqrt(np.mean(np.sort(frames)[len(frames) // 4:] ** 2))
    x = x * (10 ** (profile["rms_db"] / 20) / max(level, 1e-9))
    x = np.tanh(x * 1.1) / 1.1
    fade_in, fade_out = int(0.3 * SR), int(1.5 * SR)
    x[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)[:, None]
    x[-fade_out:] *= np.linspace(1, 0, fade_out, dtype=np.float32)[:, None]
    peak = float(np.abs(x).max())
    if peak > 0.89:
        x *= 0.89 / peak
    return x


def encode(x, out, bitrate, tmp):
    wav = Path(tmp) / "clean.wav"
    wavfile.write(wav, SR, (x * 32767).astype(np.int16))
    enc = Path(tmp) / out.name
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", str(bitrate), "-s", "0", str(wav), str(enc)],
                   check=True, capture_output=True)
    subprocess.run(["afinfo", str(enc)], check=True, capture_output=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    os.replace(enc, out)  # same volume (dist/ is in the repo), so atomic


def write_playlist(set_id, spec, entries):
    lines = [
        f"// Generated by scripts/prepare-music.py from scripts/music/{set_id}.json: {spec['summary']},",
        f"// added to the Ambient playlist as the '{set_id}' set (Settings → Ambient music → {spec['name']}).",
        "(function (root) {",
        "  'use strict';",
        "  const CH = root.CleanHub = root.CleanHub || {};",
        "  CH.playlist = (CH.playlist || []).concat(" + json.dumps(entries, indent=2).replace("\n", "\n  ") + ");",
        "})(typeof window !== 'undefined' ? window : globalThis);",
        "",
    ]
    (MUSIC / f"{set_id}.js").write_text("\n".join(lines))


def prepare(set_id, offline):
    spec = json.loads((SOURCES / f"{set_id}.json").read_text())
    entries, total_bytes, total_s = [], 0, 0.0
    for n, t in enumerate(spec["tracks"], 1):
        src = raw_path(set_id, t) if offline else download(set_id, t)
        if not src.exists():
            raise SystemExit(f"missing {src}; run without --offline")
        kind = t.get("profile", spec["profile"])
        profile = PROFILES[kind]
        bitrate = spec.get("bitrate", profile["bitrate"]) if kind == spec["profile"] else profile["bitrate"]
        out = MUSIC / set_id / f"{n:02d}-{t['id']}.m4a"
        with tempfile.TemporaryDirectory(dir=ROOT / "dist") as tmp:
            x = clean(decode(src, profile["channels"], tmp), profile)
            encode(x, out, bitrate, tmp)
        size = out.stat().st_size
        total_bytes += size
        total_s += len(x) / SR
        print(f"  {out.name}: {len(x) / SR:5.0f}s, {size // 1024:5d} KB  ({src.stat().st_size // 1024} KB source)")
        entries.append({"file": f"{set_id}/{out.name}", "title": t["title"], "artist": t["artist"],
                        "year": t.get("year", ""), "set": set_id,
                        "credit": f"{t.get('license', spec['license'])}. Source: {t['page']}"})
    # Files from an older, longer list would ship unused.
    keep = {Path(e["file"]).name for e in entries}
    for old in (MUSIC / set_id).glob("*.m4a"):
        if old.name not in keep:
            old.unlink()
    write_playlist(set_id, spec, entries)
    print(f"wrote app/music/{set_id}.js ({len(entries)} tracks, {total_s / 60:.1f} min, {total_bytes / 1e6:.1f} MB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sets", nargs="*", help="set ids (scripts/music/<id>.json); default: all")
    ap.add_argument("--offline", action="store_true", help="don't download; use dist/music-raw")
    args = ap.parse_args()
    if not shutil.which("afconvert"):
        raise SystemExit("afconvert (macOS) is needed; nothing was changed.")
    sets = args.sets or sorted(p.stem for p in SOURCES.glob("*.json"))
    for set_id in sets:
        if not (SOURCES / f"{set_id}.json").exists():
            raise SystemExit(f"no scripts/music/{set_id}.json")
    (ROOT / "dist").mkdir(exist_ok=True)
    for set_id in sets:
        print(f"{set_id}:")
        prepare(set_id, args.offline)


if __name__ == "__main__":
    main()
