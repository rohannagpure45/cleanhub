"""Composes and renders Clean Hub's own jazz for the Ambient screen: a few
mellow small-group tunes (Rhodes, vibraphone, upright bass, brushes) written
here, so there is nothing to license and nothing to download.

  python3 scripts/gen-jazz.py            # all tracks -> app/music/*.m4a + playlist.js
  python3 scripts/gen-jazz.py --only 1   # one track (1-based), for quick listening
  python3 scripts/gen-jazz.py --wav      # also keep the .wav masters in dist/music-wav

Everything is seeded, so a run always produces the same music. Needs numpy,
scipy and macOS's afconvert (AAC is the format Samsung TVs and browsers share).
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "music"

# ---- Harmony ----------------------------------------------------------------------

NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
        "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}

# quality -> (chord tones for voicing, chord scale), as semitones above the root.
QUALITIES = {
    "maj9": ([4, 7, 11, 14], [0, 2, 4, 6, 7, 9, 11]),
    "6/9": ([4, 9, 14, 7], [0, 2, 4, 7, 9, 11]),
    "m9": ([3, 10, 14, 7], [0, 2, 3, 5, 7, 9, 10]),
    "m7": ([3, 7, 10, 14], [0, 2, 3, 5, 7, 9, 10]),
    "m6": ([3, 9, 14, 7], [0, 2, 3, 5, 7, 9, 11]),
    "13": ([4, 10, 14, 21], [0, 2, 4, 5, 7, 9, 10]),
    "9": ([4, 10, 14, 7], [0, 2, 4, 5, 7, 9, 10]),
    "7": ([4, 10, 7, 14], [0, 2, 4, 5, 7, 9, 10]),
    "7b9": ([4, 10, 13, 20], [0, 1, 4, 5, 7, 8, 10]),
    "7alt": ([4, 10, 15, 20], [0, 1, 3, 4, 6, 8, 10]),
    "m7b5": ([3, 6, 10, 14], [0, 2, 3, 5, 6, 8, 10]),
    "dim7": ([3, 6, 9, 14], [0, 2, 3, 5, 6, 8, 9, 11]),
}


def parse_chord(symbol):
    root = symbol[:2] if len(symbol) > 1 and symbol[1] in "b#" else symbol[:1]
    quality = symbol[len(root):]
    tones, scale = QUALITIES[quality]
    return {"name": symbol, "root": NOTE[root], "tones": tones, "scale": scale, "quality": quality}


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def nearest(pc, around):
    """MIDI note with pitch class pc closest to `around`."""
    base = around - ((around - pc) % 12)
    return base if around - base <= 6 else base + 12


def voice(chord, prev):
    """Rootless four-note voicing between E3 and D5, moved as little as possible
    from the previous voicing (smooth voice leading)."""
    pcs = [(chord["root"] + t) % 12 for t in chord["tones"]]
    best, best_cost = None, None
    centre = int(np.mean(prev)) if prev else 62
    for rot in range(len(pcs)):
        order = pcs[rot:] + pcs[:rot]
        notes = [nearest(order[0], centre - 5)]
        for pc in order[1:]:
            n = notes[-1] + ((pc - notes[-1]) % 12 or 12)
            notes.append(n)
        for shift in (-12, 0, 12):
            cand = [n + shift for n in notes]
            if cand[0] < 52 or cand[-1] > 74:
                continue
            cost = sum(abs(a - b) for a, b in zip(sorted(cand), sorted(prev))) if prev else abs(np.mean(cand) - 62)
            if best_cost is None or cost < best_cost:
                best, best_cost = cand, cost
    return best or [nearest(pc, 60) for pc in pcs]


def scale_notes(chord, lo, hi):
    pcs = {(chord["root"] + s) % 12 for s in chord["scale"]}
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def chord_notes(chord, lo, hi):
    pcs = {chord["root"] % 12} | {(chord["root"] + t) % 12 for t in chord["tones"]}
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


# ---- Instruments (all vectorised numpy) -------------------------------------------

def env_release(n, rel):
    e = np.ones(n, np.float32)
    r = min(n, int(rel * SR))
    if r > 0:
        e[-r:] = np.linspace(1, 0, r, dtype=np.float32)
    return e


def rhodes(m, dur, vel):
    """Two-operator FM electric piano with a short tine 'ping'."""
    f = midi_hz(m)
    ring = dur + 0.25
    n = int(ring * SR)
    t = np.arange(n, dtype=np.float32) / SR
    index = vel * (1.8 * np.exp(-t / 0.15) + 0.35)
    y = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
    if f * 14 < 16000:
        y += 0.18 * vel * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t / 0.018)
    decay = np.exp(-t / (2.2 * (220 / f) ** 0.35))
    attack = np.minimum(1, t / 0.003)
    return (y * decay * attack * env_release(n, 0.18) * vel * 0.32).astype(np.float32)


def vibes(m, dur, vel):
    """Vibraphone: bar partials 1 : 4 : 10, motor tremolo, soft mallet click."""
    f = midi_hz(m)
    ring = min(dur * 1.6 + 0.4, 4.0)
    n = int(ring * SR)
    t = np.arange(n, dtype=np.float32) / SR
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 2.6)
    y += 0.28 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t / 0.30)
    if f * 10 < 18000:
        y += 0.06 * np.sin(2 * np.pi * f * 10 * t) * np.exp(-t / 0.05)
    trem = 1 - 0.32 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.2 * t))
    click = np.zeros(n, np.float32)
    k = min(n, int(0.004 * SR))
    click[:k] = np.random.default_rng(int(m * 97 + dur * 13)).uniform(-1, 1, k) * np.linspace(1, 0, k)
    attack = np.minimum(1, t / 0.002)
    return ((y * trem * attack + 0.08 * click) * env_release(n, 0.25) * vel * 0.30).astype(np.float32)


def bass(m, dur, vel):
    """Upright bass: plucked-string harmonics, upper ones dying first, a tiny
    pitch drop at the pluck and a thump."""
    f = midi_hz(m)
    n = int((dur + 0.08) * SR)
    t = np.arange(n, dtype=np.float32) / SR
    bend = 1 + 0.008 * np.exp(-t / 0.04)
    phase = 2 * np.pi * f * np.cumsum(bend) / SR
    y = np.zeros(n, np.float32)
    for k in range(1, 11):
        amp = abs(math.sin(math.pi * k * 0.22)) / k ** 1.25
        tau = 1.4 / (1 + 0.55 * (k - 1))
        y += (amp * np.sin(k * phase) * np.exp(-t / tau)).astype(np.float32)
    thump = np.exp(-t / 0.012) * np.sin(2 * np.pi * 70 * t) * 0.5
    attack = np.minimum(1, t / 0.004)
    return ((y + thump) * attack * env_release(n, 0.07) * vel * 0.55).astype(np.float32)


_SOS = {}


def bandpass(lo, hi):
    key = (lo, hi)
    if key not in _SOS:
        _SOS[key] = butter(2, [lo, hi], btype="band", fs=SR, output="sos")
    return _SOS[key]


def highpass(f):
    key = ("hp", f)
    if key not in _SOS:
        _SOS[key] = butter(2, f, btype="high", fs=SR, output="sos")
    return _SOS[key]


def lowpass(f, order=2):
    key = ("lp", f, order)
    if key not in _SOS:
        _SOS[key] = butter(order, f, btype="low", fs=SR, output="sos")
    return _SOS[key]


def noise(n, rng):
    return rng.uniform(-1, 1, n).astype(np.float32)


def ride(vel, rng):
    n = int(1.6 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    y = np.zeros(n, np.float32)
    for f in (3150, 3720, 4460, 5210, 6180, 7230, 8370):
        f *= rng.uniform(0.99, 1.01)
        y += (np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / rng.uniform(0.5, 1.1))).astype(np.float32)
    hiss = sosfilt(highpass(6000), noise(n, rng)) * np.exp(-t / 0.35)
    ping = np.exp(-t / 0.004)
    return ((0.05 * y + 0.5 * hiss) * (0.6 + 0.4 * ping) * vel * 0.22).astype(np.float32)


def brush_slap(vel, rng):
    n = int(0.25 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    y = sosfilt(bandpass(1800, 7500), noise(n, rng)) * np.minimum(1, t / 0.012) * np.exp(-t / 0.07)
    return (y * vel * 0.55).astype(np.float32)


def brush_sweep(beats, spb, vel, rng):
    """The circular brush stir that runs under a ballad, one swirl per beat."""
    n = int(beats * spb * SR)
    t = np.arange(n, dtype=np.float32) / SR
    y = sosfilt(bandpass(2500, 9000), noise(n, rng))
    swirl = 0.55 + 0.45 * np.sin(2 * np.pi * t / spb - 1.2) ** 2
    return (y * swirl * vel * 0.06).astype(np.float32)


def kick(vel):
    n = int(0.3 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    f = 52 + 40 * np.exp(-t / 0.02)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13)
    return (y * vel * 0.5).astype(np.float32)


def hat_foot(vel, rng):
    n = int(0.08 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    y = sosfilt(bandpass(6000, 11000), noise(n, rng)) * np.exp(-t / 0.018)
    return (y * vel * 0.35).astype(np.float32)


def rim(vel, rng):
    n = int(0.08 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    y = sosfilt(bandpass(1200, 3500), noise(n, rng)) * np.exp(-t / 0.012) + 0.6 * np.sin(2 * np.pi * 1700 * t) * np.exp(-t / 0.01)
    return (y * vel * 0.38).astype(np.float32)


def shaker(vel, rng):
    n = int(0.09 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    y = sosfilt(bandpass(5000, 12000), noise(n, rng)) * np.minimum(1, t / 0.01) * np.exp(-t / 0.03)
    return (y * vel * 0.20).astype(np.float32)


# ---- Arrangement ------------------------------------------------------------------

class Mix:
    """Stereo buses with per-bus reverb sends."""

    def __init__(self, seconds):
        n = int(seconds * SR)
        self.buses = {name: np.zeros((n, 2), np.float32) for name in ("keys", "vibes", "bass", "drums")}
        self.send = {"keys": 0.20, "vibes": 0.30, "bass": 0.05, "drums": 0.14}
        self.level = {"keys": 1.0, "vibes": 1.0, "bass": 0.85, "drums": 1.4}

    def add(self, bus, at, sig, pan=0.0, gain=1.0):
        buf = self.buses[bus]
        i = int(at * SR)
        if i < 0 or i >= len(buf):
            return
        sig = sig[: len(buf) - i] * gain
        left, right = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
        buf[i:i + len(sig), 0] += sig * left
        buf[i:i + len(sig), 1] += sig * right

    def render(self, rng):
        dry = sum(b * self.level[k] for k, b in self.buses.items())
        wet_in = sum(b * self.level[k] * self.send[k] for k, b in self.buses.items())
        # Synthetic room: 2 s decaying noise, darker as it fades, 18 ms pre-delay.
        n = int(2.0 * SR)
        t = np.arange(n) / SR
        ir = np.zeros((n, 2), np.float32)
        for c in range(2):
            tail = rng.normal(0, 1, n) * np.exp(-t / 0.42)
            ir[:, c] = sosfilt(lowpass(5200), tail).astype(np.float32)
        pre = int(0.018 * SR)
        ir = np.concatenate([np.zeros((pre, 2), np.float32), ir])
        ir /= np.sqrt((ir ** 2).sum(axis=0))
        wet = np.stack([fftconvolve(wet_in[:, c], ir[:, c])[: len(dry)] for c in range(2)], axis=1)
        return dry + 0.9 * wet


def swing_at(beat, ratio):
    """Time (in beats) of a swung position: offbeat 8ths land late."""
    whole = math.floor(beat + 1e-9)
    frac = beat - whole
    if abs(frac - 0.5) < 1e-6:
        return whole + ratio
    return beat


class Tune:
    def __init__(self, spec):
        self.spec = spec
        self.rng = np.random.default_rng(spec["seed"])
        self.bpm = spec["bpm"]
        self.spb = 60 / self.bpm
        self.feel = spec["feel"]
        self.swing = {"swing": 0.64, "ballad": 0.60, "bossa": 0.5}[self.feel]
        self.form = [[parse_chord(c) for c in bar.split()] for bar in spec["form"]]
        self.bars = []  # (start_beat, chords for the bar, section)
        self.length_beats = 0

    # Each bar holds one or two chords: two chords split it into halves.
    def chord_at(self, bar, beat_in_bar):
        chords = bar
        return chords[0] if len(chords) == 1 or beat_in_bar < 2 else chords[1]

    def plan(self):
        form = self.form
        sections = [("intro", form[-4:])]
        sections += [("head", form)] * self.spec.get("heads", 1)
        sections += [("solo-vibes", form), ("solo-keys", form)]
        sections += [("head", form)]
        sections += [("ending", [form[-1]])]
        beat = 0
        for name, bars in sections:
            for i, bar in enumerate(bars):
                self.bars.append((beat, bar, name, i))
                beat += 4
        self.length_beats = beat + 6  # the last chord rings
        return self

    def t(self, beat):
        return beat * self.spb + 0.6  # a little silence before the count

    def human(self, scale=0.008):
        return float(self.rng.normal(0, scale))

    # -- comping --
    def comp(self, mix):
        prev = None
        for start, bar, section, i in self.bars:
            for half, chord in enumerate(bar):
                notes = voice(chord, prev)
                prev = notes
                span = 4 if len(bar) == 1 else 2
                at = start + half * 2
                if section == "ending":
                    hits = [(0, 6.0, 0.8)]
                elif self.feel == "ballad":
                    hits = [(0, span - 0.1, 0.62)] if span == 2 or self.rng.random() < 0.6 else [(0, 1.9, 0.6), (2, 1.9, 0.5)]
                elif self.feel == "bossa":
                    pattern = [(0, 0.9, 0.55), (1.5, 0.45, 0.5), (3, 0.9, 0.5)] if span == 4 else [(0, 0.9, 0.55), (1.5, 0.45, 0.5)]
                    hits = pattern
                else:
                    hits = [(0, 1.2, 0.6), (swing_at(1.5, self.swing), 1.3, 0.55)] if span == 4 else [(0, 1.0, 0.58)]
                    if span == 4 and self.rng.random() < 0.35:
                        hits.append((3, 0.8, 0.45))
                quiet = 0.75 if section in ("head", "solo-vibes") else 0.65 if section == "solo-keys" else 0.9
                for off, dur, vel in hits:
                    roll = 0.0
                    for m in notes:
                        v = vel * quiet * self.rng.uniform(0.9, 1.05)
                        mix.add("keys", self.t(at + off) + roll + self.human(), rhodes(m, dur * self.spb, v),
                                pan=-0.25 + (m - 52) / 60)
                        roll += 0.012 if self.feel == "ballad" else 0.004

    # -- bass --
    def bassline(self, mix):
        bars = self.bars
        for k, (start, bar, section, i) in enumerate(bars):
            nxt = bars[k + 1][1][0] if k + 1 < len(bars) else bar[0]
            root = lambda c: 33 + (c["root"] - 9) % 12  # A1 .. G#2, where a walking line lives
            if section == "ending":
                mix.add("bass", self.t(start), bass(root(bar[0]), 5.5 * self.spb, 0.9))
                continue
            notes = []
            if self.feel == "ballad":
                for half in range(2):
                    c = self.chord_at(bar, half * 2)
                    r = root(c)
                    notes.append((half * 2, r if half == 0 or len(bar) == 2 else r + 7, 1.9))
            elif self.feel == "bossa":
                for half in range(2):
                    c = self.chord_at(bar, half * 2)
                    r = root(c)
                    notes += [(half * 2, r, 1.4), (half * 2 + 1.5, r + 7 if r + 7 < 52 else r - 5, 0.45)]
            else:
                c0 = self.chord_at(bar, 0)
                c2 = self.chord_at(bar, 2)
                r0, r2 = root(c0), root(c2)
                target = root(nxt)
                mid = [m for m in chord_notes(c0, r0, r0 + 12) if m != r0] or [r0 + 7]
                n1 = mid[int(self.rng.integers(len(mid)))]
                if len(bar) == 2:
                    walk = [r0, n1, r2, target + (1 if self.rng.random() < 0.5 else -1)]
                else:
                    sc = scale_notes(c0, r0 - 2, r0 + 12)
                    n2 = min(sc, key=lambda m: abs(m - (n1 + target) / 2)) if sc else r0 + 5
                    walk = [r0, n1, n2, target + (1 if self.rng.random() < 0.5 else -1)]
                notes = [(b, m, 0.9) for b, m in enumerate(walk)]
            for b, m, d in notes:
                while m > 52:
                    m -= 12
                while m < 28:
                    m += 12
                vel = 0.95 if b == 0 else 0.8
                mix.add("bass", self.t(start + b) + self.human(0.006), bass(m, d * self.spb, vel * self.rng.uniform(0.9, 1.0)), pan=0.0)

    # -- drums --
    def drums(self, mix):
        rng = self.rng
        for start, bar, section, i in self.bars:
            soft = 0.7 if section == "intro" else 1.0
            if section == "ending":
                mix.add("drums", self.t(start), ride(0.8, rng), pan=0.35)
                mix.add("drums", self.t(start), kick(0.5))
                continue
            if self.feel == "bossa":
                for e in range(8):
                    mix.add("drums", self.t(start + e / 2) + self.human(0.004), shaker(0.6 + 0.4 * (e % 2 == 0), rng) * soft, pan=0.4)
                for b in (0, 1.5, 3) if i % 2 == 0 else (1, 2.5):  # 3-2 clave on the rim
                    mix.add("drums", self.t(start + b) + self.human(0.004), rim(0.6, rng) * soft, pan=-0.2)
                for b in (0, 2):
                    mix.add("drums", self.t(start + b), kick(0.55 * soft))
                for b in (1.5, 3.5):
                    mix.add("drums", self.t(start + b), kick(0.3 * soft))
                continue
            if self.feel == "ballad":
                mix.add("drums", self.t(start), brush_sweep(4, self.spb, soft, rng), pan=-0.1)
                for b in (1, 3):
                    mix.add("drums", self.t(start + b) + self.human(0.005), brush_slap(0.55 * soft, rng), pan=-0.1)
                    mix.add("drums", self.t(start + b), hat_foot(0.5, rng), pan=0.3)
                continue
            # medium swing: ride "ding, ding-a ding, ding-a", brushes on 2 and 4
            for b in (0, 1, 2, 3):
                mix.add("drums", self.t(start + b) + self.human(0.004), ride(0.75 if b % 2 else 0.6, rng) * soft, pan=0.35)
            for b in (1, 3):
                mix.add("drums", self.t(start + swing_at(b + 0.5, self.swing)) + self.human(0.004), ride(0.45, rng) * soft, pan=0.35)
                mix.add("drums", self.t(start + b) + self.human(0.005), brush_slap(0.5 * soft, rng), pan=-0.1)
                mix.add("drums", self.t(start + b), hat_foot(0.55, rng), pan=0.3)
            mix.add("drums", self.t(start), brush_sweep(4, self.spb, 0.6 * soft, rng), pan=-0.1)
            for b in range(4):
                mix.add("drums", self.t(start + b), kick(0.18 * soft))

    # -- melody --
    RHYTHMS = [
        [(0, 1.5), (1.5, 0.5), (2, 2)],
        [(0.5, 0.5), (1, 1), (2, 1.5), (3.5, 0.5)],
        [(0, 1), (1, 1), (2, 2)],
        [(0, 2.5), (3, 0.5), (3.5, 0.5)],
        [(1, 0.5), (1.5, 0.5), (2, 1), (3, 1)],
        [(0, 3.5)],
    ]

    def head_line(self):
        """A head written once per tune: a two-bar rhythmic motif repeated
        across the form, its pitches re-fitted to each bar's chords so the
        tune sounds composed rather than random."""
        rng = np.random.default_rng(self.spec["seed"] + 1)
        motif = [self.RHYTHMS[int(rng.integers(len(self.RHYTHMS)))] for _ in range(2)]
        alt = [self.RHYTHMS[int(rng.integers(len(self.RHYTHMS)))] for _ in range(2)]
        line = []
        prev = 74
        n = len(self.form)
        for i, bar in enumerate(self.form):
            if i == n - 1:
                rhythm = [(0, 3.5)]
            elif (i // 2) % 4 == 2:
                rhythm = alt[i % 2]
            else:
                rhythm = motif[i % 2]
            for k, (b, d) in enumerate(rhythm):
                c = bar[0] if len(bar) == 1 or b < 2 else bar[1]
                strong = b in (0, 2) or d >= 1.5
                pool = chord_notes(c, 67, 84) if strong else scale_notes(c, 67, 84)
                direction = 1 if (i % 4) < 2 else -1
                target = prev + direction * (2 if k else 0) + (int(rng.integers(-2, 3)))
                m = min(pool, key=lambda x: abs(x - target)) if pool else prev
                if i == n - 1:
                    m = min(chord_notes(c, 67, 81), key=lambda x: abs(x - (72 + (c["root"] + c["tones"][0]) % 12)))
                line.append((i, b, d, m))
                prev = m
        return line

    def solo_line(self, rng, lo, hi):
        """An improvised-sounding line: two-bar phrases of mostly swung 8ths,
        chord tones on the beat, scale steps between, a breath at each end."""
        line = []
        prev = (lo + hi) // 2
        n = len(self.form)
        for i, bar in enumerate(self.form):
            phrase_end = i % 2 == 1
            beats = []
            b = 0.0 if not (i % 4 == 0 and rng.random() < 0.5) else 0.5
            limit = 2.5 if phrase_end else 4
            while b < limit:
                d = 0.5 if rng.random() < 0.7 else 1.0
                if b + d > limit:
                    d = limit - b
                beats.append((b, d))
                b += d
            direction = 1 if rng.random() < 0.5 else -1
            for b, d in beats:
                c = bar[0] if len(bar) == 1 or b < 2 else bar[1]
                on_beat = abs(b - round(b)) < 1e-6
                pool = chord_notes(c, lo, hi) if on_beat else scale_notes(c, lo, hi)
                if prev >= hi - 2:
                    direction = -1
                elif prev <= lo + 2:
                    direction = 1
                cands = [m for m in pool if 0 < (m - prev) * direction <= 4] or pool
                m = min(cands, key=lambda x: abs(x - (prev + direction * 2)))
                line.append((i, b, d, m))
                prev = m
        return line

    def melody(self, mix):
        head = self.head_line()
        solo_rng = np.random.default_rng(self.spec["seed"] + 2)
        vib_solo = self.solo_line(solo_rng, 65, 84)
        key_solo = self.solo_line(solo_rng, 62, 81)
        starts = {}
        for start, bar, section, i in self.bars:
            starts.setdefault(section, []).append(start)
        heads = [s for s in self.bars if s[2] == "head"]
        for start, bar, section, i in self.bars:
            if section == "head":
                notes = [x for x in head if x[0] == i]
                inst, bus, gain = vibes, "vibes", 1.0
            elif section == "solo-vibes":
                notes = [x for x in vib_solo if x[0] == i]
                inst, bus, gain = vibes, "vibes", 0.85
            elif section == "solo-keys":
                notes = [x for x in key_solo if x[0] == i]
                inst, bus, gain = rhodes, "keys", 1.15
            else:
                continue
            for _, b, d, m in notes:
                beat = start + swing_at(b, self.swing)
                vel = (0.8 if abs(b - round(b)) < 1e-6 else 0.62) * self.rng.uniform(0.9, 1.05) * gain
                mix.add(bus, self.t(beat) + self.human(0.007), inst(m, d * self.spb * 0.95, vel), pan=0.15 if bus == "vibes" else 0.05)
        return heads

    def render(self):
        self.plan()
        seconds = self.t(self.length_beats) + 1.0
        mix = Mix(seconds)
        self.comp(mix)
        self.bassline(mix)
        self.drums(mix)
        self.melody(mix)
        out = mix.render(self.rng)
        return master(out, self.rng)


def master(x, rng):
    """Warm lo-fi finish: gentle low-pass, soft saturation, faint vinyl, a
    fade at each end, and a fixed loudness so tracks match."""
    x = np.stack([sosfilt(lowpass(11000), x[:, c]) for c in range(2)], axis=1).astype(np.float32)
    x = x - x.mean(axis=0)
    rms = np.sqrt(np.mean(x ** 2))
    x = x * (10 ** (-19 / 20) / max(rms, 1e-9))
    x = np.tanh(x * 1.15) / 1.15
    n = len(x)
    crackle = np.zeros(n, np.float32)
    pops = rng.integers(0, n, int(n / SR * 2.5))
    crackle[pops] = rng.uniform(-1, 1, len(pops)) * 0.02
    crackle = sosfilt(bandpass(800, 6000), crackle) + rng.normal(0, 0.0006, n)
    x = x + crackle[:, None].astype(np.float32)
    fade_in, fade_out = int(0.8 * SR), int(4.0 * SR)
    x[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)[:, None]
    x[-fade_out:] *= (np.linspace(1, 0, fade_out, dtype=np.float32) ** 1.5)[:, None]
    peak = np.abs(x).max()
    if peak > 0.89:  # -1 dBFS
        x *= 0.89 / peak
    return x


TUNES = [
    {"file": "01-lamp-light", "title": "Lamp Light", "feel": "ballad", "bpm": 64, "seed": 11, "heads": 1,
     "form": ["Ebmaj9", "Cm9", "Fm9", "Bb13", "Gm7 C7b9", "Fm9 Bb13", "Ebmaj9 Ab13", "Gm7 C7b9",
              "Fm9", "Bb13", "Ebmaj9", "Abmaj9", "Am7b5 D7b9", "Gm7 C13", "Fm9 Bb7b9", "Eb6/9"]},
    {"file": "02-blue-hour-walk", "title": "Blue Hour Walk", "feel": "swing", "bpm": 112, "seed": 23, "heads": 1,
     "form": ["Fmaj9", "D7b9", "Gm9", "C13", "Am7 D7b9", "Gm7 C7", "Fmaj9", "Cm7 F13",
              "Bbmaj9", "Bbm6 Eb9", "Am7", "D7b9", "Gm9", "C13", "F6/9", "Gm7 C7b9"]},
    {"file": "03-quiet-harbor", "title": "Quiet Harbor", "feel": "bossa", "bpm": 126, "seed": 37, "heads": 1,
     "form": ["Dmaj9", "Dmaj9", "E9", "E9", "Em9", "A13", "Dmaj9", "A7b9",
              "Dmaj9", "Dmaj9", "E9", "E9", "Em9", "A13", "F#m7 B7b9", "Em9 A13",
              "Gmaj9", "Gm6", "F#m7", "B7b9", "Em9", "A13", "Dmaj9", "Em9 A13"]},
    {"file": "04-porch-blues", "title": "Porch Blues", "feel": "ballad", "bpm": 74, "seed": 41, "heads": 2,
     "form": ["Bb13", "Eb9", "Bb13", "Fm7 Bb7b9", "Eb9", "Edim7", "Bb13", "Dm7b5 G7b9",
              "Cm9", "F13", "Bb13 G7b9", "Cm7 F13"]},
    {"file": "05-after-hours", "title": "After Hours", "feel": "swing", "bpm": 96, "seed": 53, "heads": 1,
     "form": ["Cm9", "Cm9", "Fm9", "Fm9", "Dm7b5", "G7alt", "Cm9", "Dm7b5 G7b9",
              "Ebmaj9", "Ab13", "Dbmaj9", "G7alt", "Cm9", "Am7b5 D7b9", "Dm7b5", "G7b9"]},
]


def write_playlist(tracks):
    lines = [
        "// Generated by scripts/gen-jazz.py. The Ambient screen plays these in order, on a loop.",
        "(function (root) {",
        "  'use strict';",
        "  const CH = root.CleanHub = root.CleanHub || {};",
        "  CH.playlist = " + json.dumps(tracks, indent=2).replace("\n", "\n  ") + ";",
        "})(typeof window !== 'undefined' ? window : globalThis);",
        "",
    ]
    (OUT / "playlist.js").write_text("\n".join(lines))


def check(x, name):
    """Basic sanity: no clipping, no silence gaps, no DC, sensible spectrum."""
    peak = float(np.abs(x).max())
    rms = float(np.sqrt(np.mean(x ** 2)))
    mono = x.mean(axis=1)
    win = SR // 2
    frames = np.sqrt(np.mean(mono[: len(mono) // win * win].reshape(-1, win) ** 2, axis=1))
    quiet = int((frames[2:-8] < rms * 0.08).sum())
    spec = np.abs(np.fft.rfft(mono[: SR * 30]))
    freqs = np.fft.rfftfreq(SR * 30, 1 / SR)
    centroid = float((spec * freqs).sum() / spec.sum())
    print(f"  {name}: {len(x) / SR:.0f}s, peak {20 * math.log10(peak):.1f} dBFS, rms {20 * math.log10(rms):.1f} dBFS, "
          f"spectral centroid {centroid:.0f} Hz, near-silent half-seconds: {quiet}")
    assert np.isfinite(x).all(), "NaN in output"
    assert peak <= 0.9, "clipping"
    assert quiet <= 2, "unexpected gap"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int)
    ap.add_argument("--wav", action="store_true")
    args = ap.parse_args()
    if not shutil.which("afconvert"):
        raise SystemExit("afconvert (macOS) is needed to encode AAC; nothing was rendered.")
    OUT.mkdir(parents=True, exist_ok=True)
    tracks = []
    wav_dir = ROOT / "dist" / "music-wav"
    if args.wav:
        wav_dir.mkdir(parents=True, exist_ok=True)
    for k, spec in enumerate(TUNES, 1):
        entry = {"file": spec["file"] + ".m4a", "title": spec["title"], "artist": "Clean Hub Trio",
                 "year": "2026", "credit": "Original music, generated by scripts/gen-jazz.py"}
        tracks.append(entry)
        if args.only and args.only != k:
            continue
        print(f"Rendering {spec['title']} ({spec['feel']}, {spec['bpm']} bpm) …")
        x = Tune(spec).render()
        check(x, spec["title"])
        # Encode beside app/ (dist/ is on the same volume) and move the file
        # into place only once it's complete and opens, so an interrupted run
        # can never leave a broken track for build.mjs to ship.
        (ROOT / "dist").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "dist") as tmp:
            wav = Path(tmp) / "master.wav"
            wavfile.write(wav, SR, (x * 32767).astype(np.int16))
            if args.wav:
                wavfile.write(wav_dir / (spec["file"] + ".wav"), SR, (x * 32767).astype(np.int16))
            enc = Path(tmp) / entry["file"]
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "160000", "-s", "0",
                            str(wav), str(enc)], check=True)
            subprocess.run(["afinfo", str(enc)], check=True, capture_output=True)
            os.replace(enc, OUT / entry["file"])
        print(f"  wrote app/music/{entry['file']} ({(OUT / entry['file']).stat().st_size // 1024} KB)")
    write_playlist(tracks)
    print("wrote app/music/playlist.js")


if __name__ == "__main__":
    main()
