"""Composes and renders Brainrot mode's soundtrack: three short, loud, original
loops in the styles that soundtrack brainrot edits (drift phonk with a cowbell
lead, Brazilian funk, hyperpop), written here so nothing needs licensing and
nothing is downloaded.

  python3 scripts/gen-brainrot.py            # all tracks -> app/music/brainrot/*.m4a + app/music/brainrot.js
  python3 scripts/gen-brainrot.py --only 2   # one track (1-based), for quick listening
  python3 scripts/gen-brainrot.py --wav      # also keep the .wav masters in dist/music-wav

Seeded, so a run always produces the same tracks. Needs numpy, scipy and
macOS's afconvert; the filters and the sanity check come from gen-jazz.py.
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "music" / "brainrot"

_spec = importlib.util.spec_from_file_location("gen_jazz", Path(__file__).with_name("gen-jazz.py"))
jazz = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(jazz)
SR = jazz.SR
bandpass, highpass, lowpass, midi_hz = jazz.bandpass, jazz.highpass, jazz.lowpass, jazz.midi_hz


def times(dur):
    return np.arange(int(dur * SR), dtype=np.float32) / SR


def env(t, attack, decay):
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def fade_tail(y, rel=0.01):
    r = min(len(y), int(rel * SR))
    if r:
        y[-r:] *= np.linspace(1, 0, r, dtype=np.float32)
    return y


def square(phase, duty=0.5):
    return np.where((phase / (2 * np.pi)) % 1 < duty, 1.0, -1.0).astype(np.float32)


def saw(phase):
    return (2 * ((phase / (2 * np.pi)) % 1) - 1).astype(np.float32)


# ---- Instruments -------------------------------------------------------------------

def kick(vel, punch=1.0):
    t = times(0.5)
    f = 46 + 130 * punch * np.exp(-t / 0.03)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.001, 0.22)
    y += 0.4 * np.exp(-t / 0.004) * np.sin(2 * np.pi * 1800 * t)
    return (np.tanh(y * 2.2) / np.tanh(2.2) * vel).astype(np.float32)


def bass808(m, dur, vel, glide_from=None, drive=3.5):
    """Sine 808 with a long tail, an optional glide up or down into the note,
    and heavy saturation so its harmonics carry on small TV speakers."""
    t = times(dur + 0.05)
    f = np.full(len(t), midi_hz(m), np.float32)
    if glide_from is not None:
        g = min(len(t), int(0.09 * SR))
        f[:g] = np.geomspace(midi_hz(glide_from), midi_hz(m), g)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.004, 1.4)
    y = np.tanh(y * drive) / np.tanh(drive)
    y = sosfilt(lowpass(2600), y)
    return fade_tail(y.astype(np.float32) * vel, 0.03)


def cowbell(m, dur, vel):
    """The drift-phonk cowbell: two detuned square waves (an 808 cowbell
    tuned to the melody), band-passed, with a short clank and a ring."""
    t = times(min(dur, 0.5) + 0.25)
    f = midi_hz(m)
    y = square(2 * np.pi * f * t) + 0.8 * square(2 * np.pi * f * 1.483 * t)
    y = sosfilt(bandpass(f * 0.9, min(f * 6, 16000)), y)
    e = 0.65 * np.exp(-t / 0.035) + 0.35 * np.exp(-t / 0.22)
    return fade_tail((y * e * vel * 0.5).astype(np.float32), 0.02)


def clap(vel, rng):
    t = times(0.35)
    n = rng.uniform(-1, 1, len(t)).astype(np.float32)
    e = np.zeros(len(t), np.float32)
    for k, d in enumerate((0.0, 0.011, 0.022)):
        i = int(d * SR)
        e[i:] += (0.8 ** k) * np.exp(-(t[i:] - d) / 0.008)
    e += 0.6 * np.exp(-np.maximum(0, t - 0.03) / 0.09) * (t > 0.03)
    return (sosfilt(bandpass(900, 4200), n) * e * vel * 0.9).astype(np.float32)


def snare(vel, rng):
    t = times(0.3)
    n = sosfilt(bandpass(1500, 8000), rng.uniform(-1, 1, len(t)).astype(np.float32)) * env(t, 0.001, 0.07)
    body = np.sin(2 * np.pi * 190 * t) * env(t, 0.001, 0.05)
    return ((n * 0.9 + body * 0.6) * vel).astype(np.float32)


def hat(vel, rng, open_=False):
    t = times(0.35 if open_ else 0.06)
    n = sosfilt(highpass(7000), rng.uniform(-1, 1, len(t)).astype(np.float32))
    return (n * env(t, 0.0005, 0.16 if open_ else 0.018) * vel * 0.5).astype(np.float32)


def tom(m, vel):
    t = times(0.4)
    f = midi_hz(m) * (1 + 0.5 * np.exp(-t / 0.02))
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.001, 0.12) * vel * 0.8).astype(np.float32)


def stab(m, dur, vel):
    """Brazilian-funk bass stab: a distorted square that growls."""
    t = times(dur)
    y = square(2 * np.pi * midi_hz(m) * t, 0.4) + 0.5 * saw(2 * np.pi * midi_hz(m) * 1.005 * t)
    y = np.tanh(y * 2.5) * env(t, 0.003, dur * 0.7)
    return fade_tail(sosfilt(lowpass(1800), y).astype(np.float32) * vel * 0.55, 0.02)


def whistle(m, dur, vel):
    """A bright sine lead with vibrato, like the funk whistle synth."""
    t = times(dur)
    vib = 1 + 0.012 * np.sin(2 * np.pi * 6 * t) * np.minimum(1, t / 0.15)
    y = np.sin(2 * np.pi * midi_hz(m) * np.cumsum(vib) / SR) * env(t, 0.01, 0.6)
    return fade_tail(y.astype(np.float32) * vel * 0.35, 0.03)


def supersaw(notes, dur, vel, rng):
    t = times(dur)
    y = np.zeros(len(t), np.float32)
    for m in notes:
        for d in (-0.18, -0.07, 0.0, 0.07, 0.18):
            ph = 2 * np.pi * midi_hz(m + d) * t + rng.uniform(0, 6.28)
            y += saw(ph)
    y = sosfilt(lowpass(5200), y) / (5 * len(notes))
    return fade_tail((y * np.minimum(1, t / 0.01) * vel).astype(np.float32), 0.02)


def chip(m, dur, vel):
    """Hyperpop/chiptune arpeggio: a thin pulse wave."""
    t = times(dur)
    y = square(2 * np.pi * midi_hz(m) * t, 0.25) * env(t, 0.002, 0.12)
    return fade_tail(sosfilt(lowpass(9000), y).astype(np.float32) * vel * 0.22, 0.01)


# ---- Arrangement -----------------------------------------------------------------

class Mix:
    def __init__(self, seconds, bpm):
        self.n = int((seconds + 2) * SR)
        self.spb = 60 / bpm
        self.buses = {}

    def add(self, bus, step, sig, pan=0.0, gain=1.0):
        """step: 16th notes from the start."""
        i = int(step * self.spb / 4 * SR)
        if i >= self.n:
            return
        x = self.buses.setdefault(bus, np.zeros((self.n, 2), np.float32))
        j = min(self.n, i + len(sig))
        s = sig[: j - i] * gain
        x[i:j, 0] += s * (1 - max(0, pan))
        x[i:j, 1] += s * (1 + min(0, pan))

    def render(self, rng, wet=None, duck=None):
        """wet: {bus: reverb send}; duck: steps where the kick ducks 'pump' buses."""
        out = np.zeros((self.n, 2), np.float32)
        ir_t = times(1.4)
        ir = (rng.uniform(-1, 1, len(ir_t)) * np.exp(-ir_t / 0.35)).astype(np.float32)
        ir = sosfilt(lowpass(6000), ir) * 0.05
        pump = None
        if duck:
            pump = np.ones(self.n, np.float32)
            for step in duck:
                i = int(step * self.spb / 4 * SR)
                k = min(self.n - i, int(self.spb * SR * 0.9))
                if k > 0:
                    pump[i:i + k] = np.minimum(pump[i:i + k], 1 - 0.75 * np.exp(-np.arange(k) / (0.09 * SR)))
        for name, x in self.buses.items():
            if pump is not None and name.startswith("pump"):
                x = x * pump[:, None]
            out += x
            send = (wet or {}).get(name, 0)
            if send:
                for c in range(2):
                    out[:, c] += fftconvolve(x[:, c], ir)[: self.n] * send
        return out


def master(x, seconds):
    x = x[: int(seconds * SR)]
    x = np.stack([sosfilt(highpass(28), x[:, c]) for c in range(2)], axis=1).astype(np.float32)
    rms = np.sqrt(np.mean(x ** 2))
    x = x * (10 ** (-15 / 20) / max(rms, 1e-9))
    x = np.tanh(x * 1.4) / 1.4
    fi, fo = int(0.03 * SR), int(1.5 * SR)
    x[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)[:, None]
    x[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)[:, None]
    peak = np.abs(x).max()
    if peak > 0.89:
        x *= 0.89 / peak
    return x.astype(np.float32)


def drift_phonk(rng):
    """'Sigma Drift': 126 bpm, F Phrygian, cowbell lead over a gliding 808."""
    bpm, bars = 126, 32
    mix = Mix(bars * 4 * 60 / bpm, bpm)
    riff = [(0, 77), (3, 77), (6, 80), (8, 77), (10, 78), (12, 77), (14, 75),
            (16, 77), (19, 77), (22, 80), (24, 82), (26, 80), (28, 78), (30, 73)]
    roots = [29, 29, 25, 27]  # F, F, Db, Eb (808 octave)
    for bar in range(bars):
        s0 = bar * 16
        intro, brk = bar < 4, 16 <= bar < 20
        if bar % 2 == 0:
            for step, m in riff:
                mix.add("bell", s0 + step, cowbell(m, 0.3, 0.9 if not intro else 0.6), pan=0.15)
        root = roots[(bar // 2) % 4]
        if not intro:
            prev = None
            for step, dm, length in ((0, 0, 6), (6, 0, 4), (10, 12, 2), (12, 0, 4)):
                m = root + dm
                mix.add("808", s0 + step, bass808(m, length * 60 / bpm / 4, 0.95, glide_from=prev))
                prev = m
        if not intro and not brk:
            for step in (0, 6, 10):
                mix.add("drums", s0 + step, kick(0.9))
            for step in (4, 12):
                mix.add("drums", s0 + step, clap(0.8, rng))
        roll = bar % 4 == 3 and not intro
        for step in range(0, 16, 2):
            if roll and step >= 12:
                for k in range(3):
                    mix.add("drums", s0 + step + k * 2 / 3, hat(0.5 + 0.1 * k, rng), pan=-0.2)
            else:
                mix.add("drums", s0 + step, hat(0.55 if step % 4 else 0.7, rng), pan=-0.2)
        if bar % 4 == 1 and not intro:
            mix.add("drums", s0 + 14, hat(0.45, rng, open_=True), pan=-0.2)
    return mix.render(rng, wet={"bell": 0.9}), bars * 4 * 60 / bpm


def funk(rng):
    """'Ohio Funk': 130 bpm Brazilian funk, A minor, distorted bass stabs and a whistle lead."""
    bpm, bars = 130, 32
    mix = Mix(bars * 4 * 60 / bpm, bpm)
    roots = [33, 33, 36, 31]  # A, A, C, G
    lead = [(0, 81, 2), (2, 84, 2), (4, 81, 1), (6, 79, 2), (8, 76, 4), (14, 79, 2),
            (16, 81, 2), (18, 84, 2), (20, 88, 2), (22, 86, 2), (24, 84, 3), (28, 81, 4)]
    for bar in range(bars):
        s0 = bar * 16
        intro, brk = bar < 2, 14 <= bar < 16
        root = roots[(bar // 2) % 4]
        if not brk:
            for step in (0, 3, 6, 10):
                mix.add("drums", s0 + step, kick(0.85, punch=1.2))
            for step in (2, 7, 9, 14):
                mix.add("drums", s0 + step, tom(50 if step % 7 else 55, 0.55), pan=0.25)
        if not intro:
            for step in (4, 12):
                mix.add("drums", s0 + step, snare(0.75, rng))
            for step, length in ((0, 2), (3, 2), (6, 3), (10, 2)):
                mix.add("bass", s0 + step, stab(root + 12, length * 60 / bpm / 4, 0.9))
        for step in range(1, 16, 2):
            mix.add("drums", s0 + step, hat(0.4, rng), pan=-0.3)
        if bar >= 4 and bar % 2 == 0:
            for step, m, length in lead:
                mix.add("lead", s0 + step, whistle(m, length * 60 / bpm / 4 + 0.05, 0.9), pan=0.1)
    return mix.render(rng, wet={"lead": 0.7}), bars * 4 * 60 / bpm


def hyperpop(rng):
    """'Aura Bounce': 160 bpm hyperpop, E major, pumping supersaws and a chip arpeggio."""
    bpm, bars = 160, 40
    mix = Mix(bars * 4 * 60 / bpm, bpm)
    chords = [(52, [64, 68, 71]), (59, [63, 66, 71]), (61, [64, 68, 73]), (57, [64, 69, 73])]  # E B C#m A
    kicks = []
    for bar in range(bars):
        s0 = bar * 16
        intro, brk = bar < 4, 20 <= bar < 24
        root, notes = chords[bar % 4]
        mix.add("pump-pad", s0, supersaw(notes, 4 * 60 / bpm, 0.9 if not intro else 0.5, rng))
        if not intro and not brk:
            for step in (0, 4, 8, 12):
                mix.add("drums", s0 + step, kick(0.95))
                kicks.append(s0 + step)
            for step in (4, 12):
                mix.add("drums", s0 + step, snare(0.7, rng))
                mix.add("drums", s0 + step, clap(0.5, rng))
            for step in range(2, 16, 4):
                mix.add("drums", s0 + step, hat(0.55, rng, open_=step % 8 == 6), pan=0.2)
            for step in range(0, 16, 2):
                mix.add("pump-bass", s0 + step, bass808(root - 12, 2 * 60 / bpm / 4, 0.7, drive=2))
        arp = [n + 12 for n in notes] + [notes[1] + 24]
        for step in range(16):
            if not intro or step % 2 == 0:
                mix.add("arp", s0 + step, chip(arp[step % len(arp)], 60 / bpm / 4, 0.9), pan=-0.25 if step % 2 else 0.25)
    return mix.render(rng, wet={"arp": 0.5, "pump-pad": 0.3}, duck=kicks), bars * 4 * 60 / bpm


TRACKS = [
    {"file": "01-sigma-drift", "title": "Sigma Drift", "make": drift_phonk, "seed": 67},
    {"file": "02-ohio-funk", "title": "Ohio Funk", "make": funk, "seed": 420},
    {"file": "03-aura-bounce", "title": "Aura Bounce", "make": hyperpop, "seed": 1000},
]


def write_playlist(tracks):
    lines = [
        "// Generated by scripts/gen-brainrot.py: Brainrot mode's soundtrack, added to",
        "// the Ambient playlist as the 'brainrot' set (main.js keeps it out of every other Music choice).",
        "(function (root) {",
        "  'use strict';",
        "  const CH = root.CleanHub = root.CleanHub || {};",
        "  CH.playlist = (CH.playlist || []).concat(" + json.dumps(tracks, indent=2).replace("\n", "\n  ") + ");",
        "})(typeof window !== 'undefined' ? window : globalThis);",
        "",
    ]
    (OUT.parent / "brainrot.js").write_text("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int)
    ap.add_argument("--wav", action="store_true")
    args = ap.parse_args()
    if not shutil.which("afconvert"):
        raise SystemExit("afconvert (macOS) is needed to encode AAC; nothing was rendered.")
    OUT.mkdir(parents=True, exist_ok=True)
    wav_dir = ROOT / "dist" / "music-wav"
    entries = []
    for k, spec in enumerate(TRACKS, 1):
        entry = {"file": "brainrot/" + spec["file"] + ".m4a", "title": spec["title"], "artist": "Clean Hub Phonk",
                 "year": "2026", "set": "brainrot", "credit": "Original music, generated by scripts/gen-brainrot.py"}
        entries.append(entry)
        if args.only and args.only != k:
            continue
        print(f"Rendering {spec['title']} …")
        raw, seconds = spec["make"](np.random.default_rng(spec["seed"]))
        x = master(raw, seconds)
        jazz.check(x, spec["title"])
        (ROOT / "dist").mkdir(exist_ok=True)
        # Encode beside app/ and move into place only once complete (see gen-jazz.py).
        with tempfile.TemporaryDirectory(dir=ROOT / "dist") as tmp:
            wav = Path(tmp) / "master.wav"
            pcm = (x * 32767).astype(np.int16)
            wavfile.write(wav, SR, pcm)
            if args.wav:
                wav_dir.mkdir(parents=True, exist_ok=True)
                wavfile.write(wav_dir / (spec["file"] + ".wav"), SR, pcm)
            enc = Path(tmp) / (spec["file"] + ".m4a")
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "160000", "-s", "0",
                            str(wav), str(enc)], check=True)
            subprocess.run(["afinfo", str(enc)], check=True, capture_output=True)
            os.replace(enc, OUT / (spec["file"] + ".m4a"))
        print(f"  wrote app/music/{entry['file']} ({(OUT / (spec['file'] + '.m4a')).stat().st_size // 1024} KB)")
    write_playlist(entries)
    print("wrote app/music/brainrot.js")


if __name__ == "__main__":
    main()
