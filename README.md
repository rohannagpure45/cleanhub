# Clean Hub

A quiet home screen for a Samsung Tizen TV, built for a 2022 **QN85B**
(`QN85QN85BDFXZA`, Tizen 6.5). It lists the streaming apps already installed on
the TV, lets you choose and order them, and opens them with the normal remote.

It is an ordinary Tizen web app (HTML, CSS and JavaScript) installed through
Samsung's Developer Mode. It does **not** root the TV, edit system files, or
change what the Home button does. Samsung's own apps and Smart Hub stay
exactly as they are.

![List layout](docs/screens/list-dusk.png)

| | |
| --- | --- |
| ![Dock layout](docs/screens/dock-tide.png) | ![Settings](docs/screens/settings.png) |
| ![Type focus, Fraunces, Ember](docs/screens/list-type-fraunces-ember.png) | ![Apps on Home](docs/screens/apps-on-home.png) |

## What you get

- **Two layouts.** A big-type list, or a dock of tiles with a large clock.
- **Ambient, first on Home.** A wallpaper, a small clock and music from the
  genres you tick in Settings (original jazz, 1920s, classical, piano,
  ragtime, big band, ambient), made to leave on all day (see
  [docs/TV-SETUP.md](docs/TV-SETUP.md#ambient-leaving-it-on-all-day)). Three
  wallpapers are near-black and low power (Lamp, Midnight, Black); six are
  full-colour scenes (Sunset, Coast, Dunes, Aurora, City Rain, Deco); Rotate
  shows a new scene every 15 minutes. ▲▼ in Ambient change it, with a
  cross-fade. They move: clouds, mist, aurora, blowing sand and traffic drift
  left to right; glitter, stars and city lights shimmer; Deco's sunburst
  turns. Settings → Wallpaper motion: Off keeps them still.
- **Brainrot mode.** The last row of Settings turns Ambient into a TikTok-style
  feed: split-screen stories over an endless runner, a ball escaping rings,
  aura ratings, Italian brainrot and the logo that might hit the corner, with
  word-by-word captions, a live comment section and its own phonk. ▲▼ scroll,
  OK pauses, ◀▶ change the sound, Back goes Home.
- **Fire TV on Home.** One press switches the TV to the Fire Stick's HDMI
  input, full screen, in about 0.3 s.
- **Settings is the button top right.** Press ▶ from the list, or ▲ from the
  dock; ◀, ▼ or Back returns to your app.
- **Your apps, your order.** Settings → Apps on Home. OK adds an app; on an
  app that's already on Home, OK picks it up, ▲▼ move it, OK drops it, and ◀
  removes it.
- **Five backgrounds** (Dusk, Tide, Ember, Night, Paper), **three fonts**
  (Manrope, Fraunces, Space Grotesk), **Glass or Type focus**, icons on or off,
  and a 12/24-hour clock or none.
- **Fast on the TV.** Backgrounds and their frosted "glass" copies are
  pre-rendered images, and focus moves only animate `transform` and `opacity`.
  Nothing blurs or repaints the full screen as you move.
- **Offline.** Fonts, images and music are bundled; the app makes no network
  requests.

![Ambient](docs/screens/ambient-lamp.png)

![The six Ambient scenes](docs/screens/ambient-scenes.jpg)

The wallpapers are drawn by `python3 scripts/gen-wallpapers.py` (numpy), so
there are no image licences to track. Each is a still plus the layers that
move (`app/img/wall/`, placed and timed by `app/js/walls.js`). The TV only
ever slides or fades those layers, the cheapest motion its compositor does,
and a drifting layer is two copies of a seamless tile, so it never jumps.

### What it can't do

- **The Home button still opens Samsung's Smart Hub.** Remapping it needs
  root-level changes, which this project deliberately avoids. Clean Hub sits
  first in Samsung's app bar instead, so it's one press of OK after Home.
- **Starting on power-on depends on Samsung's "Autorun Last App".** The TV
  reopens whatever app you used last, so Clean Hub comes back only if it was
  the last app open when the TV went off.
- **Ads inside apps** (YouTube, Prime Video, etc.) are untouched; it only
  replaces the screen you pick apps from.
- **App icons:** the TV's own icons can't be trusted (on the QN85B, YouTube's
  is Tizen's placeholder pinwheel and Prime Video's won't load), so the apps
  Clean Hub recognises carry their own icon, from the app's App Store or
  Google Play listing (`python3 scripts/fetch-icons.py`, sources in
  `scripts/app-icons.json`). Other apps use the TV's icon, or a monogram tile
  when the TV won't hand one to a web app.
- **Tested on the QN85B itself** (Tizen 6.5): the app list, icons, launching,
  Ambient's music and the HDMI switch were checked live over the TV's
  debugger. If an app is ever missing, Settings → Apps on Home → *Show
  everything the TV lists* rescues it.

## Put it on the TV

See **[docs/TV-SETUP.md](docs/TV-SETUP.md)**. In short: turn on Developer Mode
on the TV with this Mac as the trusted host, then

```sh
python3 scripts/tv.py install-sdk --accept-license   # once
python3 scripts/tv.py setup                          # once; back up ~/.cleanhub
python3 scripts/tv.py install --tv <TV IP>
```

and pin Clean Hub first in Samsung's app bar.

## Try it on a computer

You need Node.js 20+.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:8777/frame>. Click the TV, then use the arrow keys,
**Enter** for OK and **Esc** for Back. The links at the top switch between a
typical TV, many apps, unknown apps, no apps, and a TV that refuses the app
list. The workbench fakes Tizen's app list and launcher; it never contacts a TV.

## Tests

```sh
npm test         # unit tests, browser-compatibility check, installer tests
npm run test:ui  # drives the real app in Chromium with remote keys
```

`npm run check` fails the build if the shipped code uses JavaScript newer than
ES2017, CSS the TV's Chromium may lack (flex `gap`, `inset`, `aspect-ratio`,
`min()/max()/clamp()`, `:focus-visible`, …), live `backdrop-filter`, or any
remote resource.

### Browser baseline

The checks assume Chromium 76 (Tizen 6.0), a little older than the QN85B's
engine, so the same build also runs on 2021 sets.

## Project layout

```
app/                the .wgt contents that ship to the TV
  config.xml        Tizen widget manifest
  index.html
  css/              app.css, fonts.css (generated)
  js/               catalog, options, store, apps, focus: pure logic
                    platform.js: the only file that calls `tizen`
                    ui.js: DOM; main.js: state and remote keys
                    brainrot.js: the feed's words; reel.js: its canvas scenes and sounds
  img/              backgrounds (generated); apps/: app icons (fetched)
  fonts/            Manrope, Fraunces, Space Grotesk (SIL OFL 1.1)
scripts/            build.mjs, tv.py (sign/install), asset generation, compatibility check
workbench/          desktop preview with a fake `tizen`
test/unit, test/ui  node:test suites
```

Regenerate assets with `python3 scripts/gen-backgrounds.py`,
`python3 scripts/fetch-icons.py` and `node scripts/vendor-fonts.mjs`;
refresh the README screenshots with `node scripts/screenshots.mjs`.

### The music

The five tracks in `app/music` ("Clean Hub Trio": *Lamp Light*, *Blue Hour
Walk*, *Quiet Harbor*, *Porch Blues*, *After Hours*, about 17 minutes) are
original. `python3 scripts/gen-jazz.py` composes and renders them (Rhodes,
vibraphone, upright bass, brushes) to AAC, so nothing needs licensing. The
script is seeded, so it rebuilds the same tracks every time. To use other
music, drop `.m4a` or `.mp3` files in `app/music` and list them in
`app/music/playlist.js`.

Ambient also carries six **genres** of recordings that are free to use.
Settings → Ambient music is a checklist of every genre, the originals
included: OK ticks or unticks one, Ambient plays the ticked genres one after
another, and with none ticked it's silent. The choice is saved, so it holds
after a restart too.

| Genre | Tracks | What it is | Why it's free |
| --- | --- | --- | --- |
| 1920s | 10, 30 min | Dance bands and blues, 1919–1925 (Whiteman, Bessie Smith, Bix) | U.S. recordings published before 1926 |
| Classical | 6, 24 min | Slow movements: Grieg, Vivaldi's Four Seasons, Haydn, Dvořák | Musopen's public-domain recordings |
| Piano | 6, 24 min | Satie, Chopin, Bach's Goldberg Aria, Schumann, Beethoven | Musopen's public-domain recordings; Open Goldberg (CC0) |
| Ragtime | 8, 29 min | Joplin and friends: piano, a roll, banjo, 78s, the U.S. Marine Band | Pre-1926 recordings, CC0 performances, a U.S. government work |
| Big band | 7, 26 min | The Air Force's Airmen of Note; Henderson, Goldkette, Whiteman 78s | U.S. government works; pre-1926 recordings |
| Ambient | 5, 24 min | Slow pads and drones (Kevin MacLeod's FreePD, graphite412) | CC0 |

Every composition was published before 1931 (U.S. public domain as of 2026),
or is itself CC0 or a U.S. government work. Each track's title, performers,
licence and source page are in `scripts/music/<genre>.json` and in the
`credit` of `app/music/<genre>.js`. `python3 scripts/prepare-music.py
[genre …]` re-downloads them from Wikimedia Commons, the Library of Congress
National Jukebox and the Internet Archive, trims and levels them (and filters
the 78s' rumble and hiss), and encodes them to AAC in `app/music/<genre>/`.
To add a genre, write its `scripts/music/<id>.json`, run the script, add it
to `CH.genres` in `app/js/options.js` and load `music/<id>.js` in
`app/index.html`.

### Brainrot mode

Nothing in the feed is a video file or comes from the internet. Each video is
drawn live on a canvas (`app/js/reel.js`) at up to 30 fps, and its story, captions,
handles, counts and comments are put together from word lists in
`app/js/brainrot.js`, so the feed never runs out. Emoji are small drawings,
since the TV may have no emoji font. The runner, the characters and the
sounds are all original; the hits, bounce notes and dings are synthesised with
Web Audio. The soundtrack is three original loops in `app/music/brainrot/`
(*Sigma Drift*, drift phonk with a cowbell lead; *Ohio Funk*, Brazilian funk;
*Aura Bounce*, hyperpop), composed and rendered by
`python3 scripts/gen-brainrot.py`. Music *Off* makes the feed silent, and the
brainrot set never plays outside Brainrot mode.

## Licence

MIT for the code. Fonts are SIL Open Font License 1.1 (see `app/fonts/`).
Service names, colours and app icons identify the apps installed on your TV;
they belong to their owners.
