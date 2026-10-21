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
3. **Developer mode: On.** In **Host PC IP**, enter this Mac's address,
   **192.168.1.196** (its wired connection). Choose OK.
   *The Mac is also on Wi-Fi as 192.168.1.141. Turn the Mac's Wi-Fi off while
   installing, so it only uses the wired address.*
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
