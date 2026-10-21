# The Home button

Pressing Home on the Samsung remote brings you back to Clean Hub, not
Samsung's Smart Hub. Settings has two rows for it:

- **Home button**: *Clean Hub* (the default) or *Samsung Home* (the TV's
  normal behaviour).
- **Open Samsung Home**: shows Samsung's Smart Hub once, for what only it
  has (the TV's own settings, the app store, Samsung TV Plus). Home from
  there comes back to Clean Hub again.

Nothing on the TV is rooted or changed. Samsung keeps the Home key for itself
(apps can't register it), so Clean Hub does the next best thing: a small
background service, the **Home watcher** (`app/service/home.js`), notices when
Home has put the Smart Hub over Clean Hub, or over an app Clean Hub can see,
and brings Clean Hub straight back. You see the Smart Hub for a moment first:
about half a second to a second on the QN85B.

## How it decides

Clean Hub knows the instant it's hidden and tells the watcher, unless it
hid on purpose (it opened an app or an input, or you chose Open Samsung Home);
then it says so beforehand. For apps, the watcher asks the TV's own REST API
(`127.0.0.1:8001`, the one phone remotes use) which app is on screen. That API
answers about a second late, and it knows store apps (Netflix and Prime Video
only by their Samsung Apps number) but not Samsung's system apps.

A hide nobody announced is Home, and Clean Hub comes back, unless:

| Something else explains it | How the watcher tells |
| --- | --- |
| The TV is turning off | The REST API's power state is no longer `on`. |
| AirPlay is starting | AirPlay's status flags (`:7000/info`) change while a phone connects (0x244 → 0xA44 on the QN85B). The watcher checks at the hide and quietly every second before it. |
| You pressed the Netflix button (or a phone cast to the TV) | A running app is already on screen. If the TV only reports it once Clean Hub is back, the watcher hands the screen back to it. |
| You picked another input with the Source button | Back on screen, Clean Hub sees the TV's input has changed and shows it. |
| You pressed Home again within 3 s of Clean Hub coming back | Left alone: twice in a row stays on Samsung's Home. |
| Clean Hub is closing (an install, the app manager) | It says so as it goes. |

Home over an app works the same way once the watcher has seen that app on
screen. That includes apps opened from Samsung's Home, and Clean Hub's
YouTube tile, which hands over to Samsung's own YouTube player.

## Fire TV, and Home over it

The Smart Hub, live TV and Samsung's HDMI viewer are system apps the REST API
can't see, so Home over the Fire Stick's input can't be noticed when Samsung's
viewer shows it. **Settings → Fire TV picture** chooses how Fire TV on Home
shows the stick:

- **TV input** (the default): as before. Samsung's viewer shows the stick,
  and the Samsung remote reaches it over HDMI-CEC (Anynet+). Home opens the
  Smart Hub.
- **In Clean Hub**: Clean Hub shows the stick's picture itself (Tizen's TV
  window, behind a see-through page). It stays the app on screen, so Home
  comes back to Clean Hub. The Samsung remote's keys come to Clean Hub, which
  passes arrows, OK, Back and play/pause to the stick over the network (the
  stick's remote API, as the Fire TV phone app does). Measured on the TV, a
  key takes 25–150 ms to reach the Fire TV service and 20–50 ms more to reach
  the stick.

  The costs:
  - The picture blinks black twice in its first few seconds. About a second
    in, the stick claims the TV over HDMI-CEC and Samsung's viewer takes the
    screen. The watcher waits 1.5 s, for the stick's second claim to land on
    that viewer, then brings Clean Hub back. The TV keeps Clean Hub's picture
    throughout; it's the hand-overs that blink.
  - Number and channel keys don't reach the stick (its API has no such keys).
  - The Fire TV tile opens the stick's own Home screen, the only way there;
    an app's tile (StbEmu) opens that app. Holding Back can't stand in for the
    stick's Home: on a Samsung remote, that closes the app on screen.
  - It needs Home button: Clean Hub. Without it, Fire TV uses the TV input
    anyway.

## What it still can't do

- **Home over live TV, an HDMI input in Samsung's viewer, or Samsung's own
  apps** (TV Plus, Gaming Hub, the browser, the TV's settings) stays on the
  Smart Hub. Clean Hub is first in Samsung's app bar there, one press of OK
  away.
- **A moment of Smart Hub on every press.** Most of it is Tizen: Clean Hub's
  "I'm hidden" reaches the watcher 0.1–0.8 s later. The checks (at most
  0.4 s) and the relaunch (0.2–0.5 s) add the rest.
- **After a power cut**, the watcher starts with the TV only if the TV
  honours `on-boot` in `config.xml`. That's unverified: the TV accepted the
  setting, but a power cut hasn't been tried. Until Clean Hub has been opened
  once, Home may stay on the Smart Hub; *Autorun Last App*
  ([TV-SETUP.md](TV-SETUP.md)) usually opens it for you. Standby is fine: the
  watcher kept running through the TV being turned off and on.

## Looking inside

With Clean Hub in debug mode (`python3 scripts/tv.py debug`):

```sh
node scripts/tv-inspect.mjs eval 'CleanHub.platform.tellHome({ do: "report" })'
node scripts/tv-inspect.mjs eval 'CleanHub.main.homeReport()'   # the watcher's recent decisions
node scripts/tv-inspect.mjs eval 'CleanHub.main.trace()'        # what the page did
node scripts/tv-inspect.mjs eval 'CleanHub.platform.fireTvKey("report")'
node scripts/tv-inspect.mjs eval 'CleanHub.main.fireTvReport()' # each key's timings
```

The page only hears back while it's on screen. The watcher keeps its log in
`cleanhub-home-log.json` in the app's data folder, so it survives the TV
stopping the service.

## Things learned on the QN85B (Tizen 6.5)

| Tried | Result |
| --- | --- |
| Registering the Home key (`tizen.tvinputdevice`) | Not offered. Neither are Netflix, Prime or TV Plus; Source, the media keys, channels and digits are. |
| `addAppStatusChangeListener`, `getAppsContext` | No signal on Home: the Smart Hub, Samsung's viewer, AirPlay and Settings are always running. |
| REST API `GET /api/v2/applications/<id>` | `visible` for Clean Hub and store apps, about a second late; 404 for system apps. Can be slow (seconds) while the TV is busy. |
| Message port, page → service | 0.3–1.9 s. |
| App control, page → service | 25–150 ms in calm moments. Two sent close together can arrive as the newer one twice, so every message is numbered. |
| App control, service → page | Reloads the page: never used. Plain `launch()` brings it back as it was. |
| `tizen.alarm` aimed at the service | Refused ("Error while add alarm to server"). Only the visible app can be an alarm's target. |
| `tizen.preference` | Not on this TV. The watcher keeps the Home setting in its own file. |
| `tvwindow.show` with an HDMI input | Works full screen behind the page, but the stick then claims the TV over HDMI-CEC (twice). The TV keeps the window across the takeover, so it's shown once per opening. |
| Holding Back | Samsung's "close this app". |
