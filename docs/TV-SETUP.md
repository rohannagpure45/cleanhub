# Putting Clean Hub on the QN85B

About 15 minutes the first time: 5 at the TV, the rest on the Mac. Menu names
are for 2022 Samsung TVs. If a name differs on your firmware, look one level
up or down in the same menu.

## 1. At the TV: turn on Developer Mode

1. **Find the TV's IP address.** Settings → All Settings → **Connection** →
   Network → Network Status → **IP Settings**. If it isn't there, try
   General & Privacy → Network. Write the address down (e.g. `192.168.1.50`).
   For a TV whose address never changes, reserve it in your router's DHCP
   settings.
2. **Open the Developer Mode box.** Press Home, go to **Apps**. On some
   firmware you then scroll to **App Settings**. Press the remote's **123**
   button until the on-screen number pad appears, and type **1 2 3 4 5**.
3. **Developer mode: On.** In **Host PC IP**, enter the address this Mac uses
   to reach the TV. This TV is set to **192.168.1.141** (the Mac's Wi-Fi).
   `python3 scripts/tv.py doctor` prints the right address if it ever
   changes, for example when a USB network adapter is plugged in.
4. **Fully restart the TV.** Hold the remote's power button for 5–8 seconds,
   until the Samsung boot logo appears. Pressing Power normally only puts the
   TV into standby, which isn't enough. Or unplug the TV for 30 seconds.
5. Open **Apps** again. A **Develop Mode** label at the top means it worked.

## 2. On the Mac: sign and install

```sh
cd ~/cleanhub
python3 scripts/tv.py install-sdk --accept-license   # once: Tizen SDK 10 CLI, 326 MB
python3 scripts/tv.py setup                          # once: signing certificate
python3 scripts/tv.py doctor --tv 192.168.1.50       # checks Developer Mode, Host PC IP, port
python3 scripts/tv.py install                        # build, sign, install, open
```

- `install-sdk` downloads Samsung's official installer from
  `download.tizen.org` and installs it into `~/tizen-studio`. The tools are
  Intel builds and run under Rosetta 2, which this Mac already has.
- `setup` makes a **Tizen** developer certificate. 2022 TVs accept it, so no
  Samsung account is needed. It keeps the certificate and its password in
  `~/.cleanhub`, private to your user (the SDK keeps its own copy in
  `~/tizen-studio-data`). **Back `~/.cleanhub` up.** Every future update has
  to be signed with the same certificate. If it's lost, Clean Hub must be
  uninstalled before a new install, and its settings go with it. On a new Mac,
  restore `~/.cleanhub` first; `setup` then reuses that certificate.
- Make the certificate **before 1 January 2027**. The SDK's developer CA
  expires then, so new certificates can't be created after that date.
  Existing ones are expected to keep working.
- `doctor` says exactly what's wrong if the TV isn't ready: Developer Mode
  off, the wrong Host PC IP, or a TV that needs a full restart.

## 3. At the TV: make it home

1. **Pin it first.** Press Home. In the app row (or Apps), highlight
   **Clean Hub**, press **Down**, choose **Add to Home** or **Move**, move it to
   the first spot, and press Select. After pressing Home, Clean Hub is then one
   press of OK away.
2. **Start screen.** Settings → All Settings → General & Privacy →
   **Start Screen Options**:
   - Turn **off** *Start with Smart Hub Home*.
   - Turn **on** *Autorun Last App* if you want the TV to come back to Clean
     Hub when it turns on. Samsung reopens **whatever app was open last**, so
     this only works if you return to Clean Hub before turning the TV off.
3. **Leave Developer Mode on**, with your Mac as the Host PC IP, so updates
   can be installed. Samsung doesn't document what happens to sideloaded apps
   if Developer Mode is switched off. If you'd rather no computer be trusted
   in between updates, set Host PC IP to `127.0.0.1` and put the Mac's address
   back when you update. (Developer Mode has a known low-severity flaw that
   only that trusted computer can reach.)

## Fire TV on Home

Settings (top right) → **Fire TV on Home** → the HDMI input your Fire Stick
uses (HDMI 4 on this TV). A *Fire TV* item appears on Home after Ambient. OK
switches the TV to that input and hands the screen to Samsung's own TV viewer,
so the Fire TV remote (or the Samsung remote, with Anynet+ on) drives the
stick. To come back, press Home on the Samsung remote: Clean Hub is first in
the app bar.

The TV takes about 3 seconds to list its inputs, so Clean Hub asks when it
starts and whenever it comes back to the front. Pressing OK then switches in
about 0.3 s.

## Ambient: leaving it on all day

Ambient is first on Home. It shows a near-black wallpaper (Lamp, Midnight or
Black) with a small dim clock that moves corners every 4 minutes, and plays
the bundled jazz on a loop. Keys: the first press only shows the controls,
then OK pauses or plays, ◀ ▶ change track, ▲ ▼ change wallpaper, and Back goes
Home. If the TV is switched off while Ambient is showing, Clean Hub reopens
it the next time it starts.

The TV has timers that would end an all-day session. No app can override
them, so set them once:

| Setting (Settings → All Settings → …) | Set to | Why |
| --- | --- | --- |
| General & Privacy → Power and Energy Saving → **Auto Power Off** | **Off** | Otherwise the TV turns itself off after hours with no remote input (4 h is the usual default). |
| General & Privacy → Power and Energy Saving → **Auto Power Saving** | Off | It can switch the screen off when the TV looks idle. |
| General & Privacy → Power and Energy Saving → **Screen Saver** | Off | Ambient asks the TV to hold off its screensaver, but this 2022 toggle may not obey the app. |
| General & Privacy → System Manager → Time → **Sleep Timer** / **Off Timer** | Off | Only matter if they were ever set. |
| General & Privacy → Start Screen Options → **Autorun Last App** | On (optional) | After power-on, Clean Hub comes back, and with it Ambient. |

**Using less power.** On this mini-LED TV the backlight is most of the power
draw. Ambient is under 2% average brightness, so local dimming can turn most
zones off.
- Picture → Expert Settings → **Local Dimming: High**, and a lower
  **Brightness**, help most. So does leaving Power and Energy Saving →
  **Brightness Optimization** on.
- For music with the screen fully off, use **Picture Off**: hold the remote's
  Volume button for 2 seconds → Accessibility Shortcuts → Picture Off. It's
  also at General & Privacy → Accessibility → Picture Off. Any key except
  Volume or Power brings the picture back. In Ambient that first key only
  shows the controls, so it won't stop the music.
- Samsung rates the 85" QN85B at 106 W typical. Dark-screen and Picture Off
  draw haven't been published for this model; a plug-in power meter will
  tell you exactly.

## Looking inside the app on the TV

`python3 scripts/tv.py debug` relaunches Clean Hub in debug mode. Then
`node scripts/tv-inspect.mjs eval '<js>'` runs JavaScript in the live app,
and `node scripts/tv-inspect.mjs key Enter` sends a remote key. Taking
screenshots isn't supported by the TV.

## Updating

Change the code, bump the version in `app/config.xml`, `package.json` and
`app/js/main.js` (`npm test` checks they match), then:

```sh
python3 scripts/tv.py install
```

## Removing it

On the TV: Apps → ⚙ Settings → Clean Hub → **Delete**. Or from the Mac:
`python3 scripts/tv.py uninstall`. Then turn *Start with Smart Hub Home* back
on if you want Samsung's home at power-on.

## If something goes wrong

| What you see | What it means |
| --- | --- |
| `doctor`: Developer Mode is off | Step 1.2–1.3 didn't stick; do them again. |
| `doctor`: TV trusts another IP | Host PC IP doesn't match the Mac. Re-enter it and fully restart the TV. |
| `doctor`: Host PC IP saved backwards | The TV's menu language reads right-to-left. Type the address in reverse, as `doctor` shows, or switch the menu to English while you enter it. |
| `doctor`: port 26101 closed | The TV wasn't fully restarted. Hold Power until the logo, or unplug it. |
| `118,-11` author certificate | Clean Hub on the TV was signed with another certificate. Uninstall it, then install. |
| `118,-12` certificate chain | The signing profile isn't using the SDK's old public distributor. `python3 scripts/tv.py setup --force` rebuilds the profile around the same author certificate, so no uninstall is needed. |
| An app is missing from Clean Hub | Settings → Apps on Home → *Show everything the TV lists*, and add it from there. `python3 scripts/tv.py ids` prints every app id the TV reports. |
| App icons show as letters | The TV didn't hand that icon to a web app; the monogram is the fallback. |
| Clean Hub vanished after a Samsung update | Major firmware updates sometimes remove sideloaded apps. Run `install` again; settings may be reset. |

## Tizen Studio 6.1 fallback

`setup` signs with the SDK's *old* public distributor certificate, the one
2022 TVs accept. If a future SDK 10 build drops it, `setup` stops and points
here. Use Samsung's previous CLI instead:

```sh
curl -LO https://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_macos-64.bin
chmod +x web-cli_Tizen_Studio_6.1_macos-64.bin
./web-cli_Tizen_Studio_6.1_macos-64.bin --accept-license ~/tizen-studio-6.1
TIZEN_SDK=~/tizen-studio-6.1 python3 scripts/tv.py setup
TIZEN_SDK=~/tizen-studio-6.1 python3 scripts/tv.py install
```

`setup` reuses the certificate in `~/.cleanhub` if there is one, so the switch
doesn't force an uninstall.
