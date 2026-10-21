#!/usr/bin/env python3
"""Clean Hub TV helper: sign, install and manage Clean Hub on a Samsung TV in
Developer Mode, from this Mac. Standard library only.

  python3 scripts/tv.py install-sdk --accept-license   # once: Tizen SDK 10 CLI
  python3 scripts/tv.py setup                          # once: signing certificate
  python3 scripts/tv.py doctor  --tv 192.168.1.50      # is the TV ready?
  python3 scripts/tv.py install --tv 192.168.1.50      # build, sign, install, open
  python3 scripts/tv.py open | uninstall | ids         # (remembers the last --tv)
  python3 scripts/tv.py debug                          # relaunch for scripts/tv-inspect.mjs

Signing: 2022 TVs (Tizen 6.5) accept a plain Tizen developer certificate paired
with the SDK's "old" public distributor certificate, so no Samsung account is
involved. Tizen 7+ TVs need a Samsung certificate instead; `install` stops and
says so if it finds one.

Everything this script keeps lives in ~/.cleanhub (outside the repo). Back that
folder up: every future update must be signed with the same author certificate,
or the TV refuses it until Clean Hub is uninstalled (losing its settings). On a
new Mac, restore ~/.cleanhub and run `setup`: it reuses the backed-up
certificate instead of making a new one.
"""
import argparse
import json
import os
import pty
import re
import secrets
import select
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = Path.home()
SDK = Path(os.environ.get("TIZEN_SDK", HOME / "tizen-studio"))
STATE = HOME / ".cleanhub"
TIZEN = SDK / "tools" / "ide" / "bin" / "tizen"
SDB = SDK / "tools" / "sdb"

INSTALLER_URL = "https://download.tizen.org/sdk/Installer/tizen-sdk_10.0/web-cli_Tizen_SDK_10.0_macos-64.bin"
INSTALLER_BYTES = 326_076_958
PROFILE = "CleanHub"
CERT_ALIAS = "cleanhub"
# The SDK's public distributor certificate and its published password.
DIST_PASSWORD = "tizenpkcs12passfordsigner"
SDB_PORT = 26101
WGT = ROOT / "dist" / "CleanHub.wgt"
BACKUP = STATE / "author.p12"

# Install failures the TV reports, as it prints them (spaces removed), and
# what they mean here. Bracketed, so timings like "[1163]ms" never match.
INSTALL_ERRORS = {
    "[118,-11]": "the TV has Clean Hub signed with a different author certificate. "
                 "Uninstall it first (python3 scripts/tv.py uninstall); its settings are lost.",
    "[118,-12]": "the TV rejected the certificate chain. The signing profile must use the SDK's old "
                 "public distributor (certificate-generator/.../sdk-public/tizen-distributor-signer.p12); "
                 "run python3 scripts/tv.py setup --force to rebuild the profile with it.",
    "[118,-4]": "the TV refused the package: required_version or a privilege is too new for it.",
    "[118,-14]": "a partner-level privilege needs a Samsung partner certificate.",
    "[118,-22]": "the package id is blocked by an older install from another author.",
    "[118022]": "the package id is blocked by an older install from another author.",
    "failed[116]": "the TV is out of space for apps.",
}


# ---- small helpers -------------------------------------------------------------

def say(msg=""):
    print(msg, flush=True)


def fail(msg):
    print("\n✗ " + msg, file=sys.stderr, flush=True)
    sys.exit(1)


def manifest():
    xml = (ROOT / "app" / "config.xml").read_text()
    app_id = re.search(r'<tizen:application\s+id="([^"]+)"', xml).group(1)
    version = re.search(r'<widget[^>]*\sversion="([^"]+)"', xml).group(1)
    return app_id, version


def sdk_data():
    """Where this SDK keeps certificates and profiles (sdk.info knows)."""
    try:
        m = re.search(r"^TIZEN_SDK_DATA_PATH=(.+)$", (SDK / "sdk.info").read_text(), re.M)
        if m:
            return Path(m.group(1).strip())
    except OSError:
        pass
    return Path(str(SDK) + "-data")


def author_path():
    return sdk_data() / "keystore" / "author" / f"{CERT_ALIAS}.p12"


def state_dir():
    """~/.cleanhub, private to this user."""
    STATE.mkdir(mode=0o700, exist_ok=True)
    os.chmod(STATE, 0o700)
    return STATE


def load_json(name):
    try:
        return json.loads((STATE / name).read_text())
    except (OSError, ValueError):
        return {}


def save_json(name, data, private=False):
    path = state_dir() / name
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o644)
    with os.fdopen(fd, "w") as f:
        f.write(json.dumps(data, indent=2) + "\n")
    tmp.replace(path)


def stamp():
    return time.strftime("%Y%m%d-%H%M%S")


def tv_address(args):
    tv = args.tv or load_json("tv.json").get("tv")
    if not tv:
        fail("Which TV? Pass --tv <TV IP address> (Settings > All Settings > Connection > "
             "Network > Network Status > IP Settings on the TV).")
    if not re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", tv):
        fail(f"'{tv}' doesn't look like an IPv4 address.")
    if args.tv:
        save_json("tv.json", {"tv": tv})
    return tv


def run(cmd, timeout=180):
    """Runs a command and returns (exit code, combined output)."""
    try:
        p = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def run_pty(cmd, answers, secrets_to_hide=(), timeout=600):
    """Runs a command in a pseudo-terminal and answers its prompts. The Tizen
    CLI asks for certificate passwords on the terminal even when the profile
    already stores them. `answers` is [(regex, reply)]: each is matched against
    the end of the output not yet answered, first match wins."""
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execv(str(cmd[0]), [str(c) for c in cmd])
        finally:
            os._exit(127)
    out, pending = b"", b""
    deadline = time.time() + timeout
    timed_out = False
    try:
        while True:
            if time.time() > deadline:
                timed_out = True
                os.kill(pid, 9)
                break
            ready, _, _ = select.select([fd], [], [], 0.5)
            if not ready:
                continue
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            out += chunk
            pending += chunk
            tail = pending.decode(errors="replace")
            for pattern, reply in answers:
                if re.search(pattern, tail, re.I):
                    os.write(fd, (reply + "\n").encode())
                    pending = b""
                    break
    finally:
        os.close(fd)
    _, status = os.waitpid(pid, 0)
    text = out.decode(errors="replace")
    for s in secrets_to_hide:
        text = text.replace(s, "••••")
    if timed_out:
        return 124, text + f"\n(timed out after {timeout}s)"
    return os.waitstatus_to_exitcode(status), text


def package_answers(password):
    """Prompt answers for `tizen package`, most specific first, anchored to the
    end of the prompt so an informational line can't trigger one."""
    return [
        (r"\(N\)\s*\??\s*$", "n"),  # "Save ... password? Yes: (Y), No: (N) ?"
        (r"distributor\d*\s+password:\s*$", DIST_PASSWORD),
        (r"password:\s*$", password),
    ]


def mac_ip_for(tv):
    """The address this Mac uses to reach the TV (what the TV must trust)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((tv, 9))  # no packet is sent; this only picks the route
        return s.getsockname()[0]
    finally:
        s.close()


def tv_rest(tv, tries=3):
    """Samsung's local API reports Developer Mode and the trusted host. It can
    take a few seconds to answer after the TV starts, so try again."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(f"http://{tv}:8001/api/v2/", timeout=5) as r:
                return json.load(r)
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(3)


def port_open(tv, port=SDB_PORT):
    try:
        socket.create_connection((tv, port), timeout=4).close()
        return True
    except OSError:
        return False


def need_sdk():
    if not (TIZEN.exists() and SDB.exists()):
        fail(f"Tizen SDK not found in {SDK}. Run: python3 scripts/tv.py install-sdk --accept-license")
    code, _ = run(["arch", "-x86_64", "/usr/bin/true"])
    if code != 0:
        fail("The Tizen tools are Intel binaries and need Rosetta 2: softwareupdate --install-rosetta")


def profile_listed():
    _, listed = run([TIZEN, "security-profiles", "list"])
    return re.search(rf"\b{PROFILE}\b", listed) is not None


def signing():
    data = load_json("signing.json")
    author = author_path()
    if not data.get("password"):
        fail("No signing certificate yet. Run: python3 scripts/tv.py setup")
    if not author.exists() or not profile_listed():
        fail("The signing certificate is in ~/.cleanhub but not set up in this SDK. "
             "Run: python3 scripts/tv.py setup (it restores it; it won't make a new one).")
    return data


def sdb(tv, *args, timeout=120):
    return run([SDB, "-s", f"{tv}:{SDB_PORT}", *args], timeout=timeout)


def connect(tv):
    """A fresh sdb connection, confirmed in `sdb devices`. A TV restart or a
    Mac network change leaves a stale 'already connected' entry behind."""
    serial = f"{tv}:{SDB_PORT}"
    run([SDB, "disconnect", serial], timeout=15)
    _, out = run([SDB, "connect", serial], timeout=30)
    _, devices = run([SDB, "devices"], timeout=15)
    if not re.search(rf"^{re.escape(serial)}\s+device\b", devices, re.M):
        fail(f"Couldn't connect to the TV over sdb:\n{out.strip()}\n{devices.strip()}\n"
             "Run doctor to see why (usually Developer Mode, the Host PC IP, or a TV that needs a full restart).")


def platform_version(tv):
    _, out = sdb(tv, "capability", timeout=30)
    m = re.search(r"platform_version:([\d.]+)", out)
    return m.group(1) if m else None


# ---- commands ------------------------------------------------------------------

def cmd_install_sdk(args):
    if TIZEN.exists():
        say(f"Tizen SDK already installed in {SDK}.")
        return
    if not args.accept_license:
        fail("This downloads Samsung's Tizen SDK 10 command-line installer "
             f"({INSTALLER_BYTES / 1e6:.0f} MB from download.tizen.org) and installs it into {SDK}, "
             "accepting the Tizen SDK licence. Re-run with --accept-license to agree.")
    code, _ = run(["arch", "-x86_64", "/usr/bin/true"])
    if code != 0:
        fail("Install Rosetta 2 first (softwareupdate --install-rosetta); the Tizen tools are Intel binaries.")
    dl = state_dir() / "downloads"
    dl.mkdir(exist_ok=True)
    target = dl / INSTALLER_URL.rsplit("/", 1)[1]
    if not target.exists() or target.stat().st_size != INSTALLER_BYTES:
        say(f"Downloading {INSTALLER_URL} …")
        tmp = target.with_suffix(".part")
        with urllib.request.urlopen(INSTALLER_URL, timeout=60) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
        tmp.rename(target)
    if target.stat().st_size != INSTALLER_BYTES:
        fail(f"Download size {target.stat().st_size} != expected {INSTALLER_BYTES}; not running it.")
    target.chmod(0o700)
    say(f"Installing into {SDK} (takes a few minutes) …")
    code, out = run([target, "--accept-license", SDK], timeout=1800)
    if not TIZEN.exists():
        fail(f"The installer finished without the tizen CLI ({code}):\n{out[-2000:]}")
    _, ver = run([TIZEN, "version"])
    say("✓ " + (ver.strip().splitlines()[-1] if ver.strip() else "Tizen SDK installed"))


def find_old_distributor():
    base = SDK / "tools" / "certificate-generator" / "certificates" / "distributor"
    for folder in (base / "sdk-public", base):
        p12, ca = folder / "tizen-distributor-signer.p12", folder / "tizen-distributor-ca.cer"
        if p12.exists() and ca.exists():
            return p12, ca
    fail(f"The SDK's old public distributor certificate isn't in {base}. This SDK may have dropped it; "
         "see docs/TV-SETUP.md, 'Tizen Studio 6.1 fallback'.")


def register_profile(author, password):
    dist, dist_ca = find_old_distributor()
    dev_ca = SDK / "tools" / "certificate-generator" / "certificates" / "developer" / "tizen-developer-ca.cer"
    run([TIZEN, "security-profiles", "remove", "-n", PROFILE])
    cmd = [TIZEN, "security-profiles", "add", "-n", PROFILE, "-a", author, "-p", password]
    if dev_ca.exists():
        cmd += ["-c", dev_ca]
    cmd += ["-d", dist, "-dp", DIST_PASSWORD, "-dc", dist_ca]
    _, out = run(cmd)
    if not profile_listed():
        fail("Couldn't register the signing profile:\n" + out.replace(password, "••••"))
    return dist


def lock_down(author):
    """The SDK keeps its own copy of the key and the profile's password."""
    for path, mode in ((sdk_data(), 0o700), (author.parent, 0o700), (author, 0o600)):
        try:
            os.chmod(path, mode)
        except OSError:
            pass


def cmd_setup(args):
    need_sdk()
    data = load_json("signing.json")
    author = author_path()
    old_umask = os.umask(0o077)  # everything setup and the SDK create here is private
    try:
        # A certificate exists (made here, or restored from a backup): reuse it.
        # --force only rebuilds the profile around it; the author never changes.
        if data.get("password") and (author.exists() or BACKUP.exists()):
            if not author.exists():
                author.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(BACKUP, author)
                say(f"Restored the author certificate from {BACKUP}.")
            elif BACKUP.exists() and author.read_bytes() != BACKUP.read_bytes():
                fail(f"{author} differs from the backup {BACKUP}. Keep the one Clean Hub on the TV was "
                     "signed with: move the other aside, then run setup again.")
            if profile_listed() and not args.force:
                say(f"✓ Signing is already set up (profile {PROFILE}, certificate {author}).")
                return
            dist = register_profile(author, data["password"])
            if not BACKUP.exists():
                shutil.copy2(author, BACKUP)
            data.update({"profile": PROFILE, "author": str(author), "distributor": str(dist)})
            save_json("signing.json", data, private=True)
            lock_down(author)
            say(f"✓ Signing profile {PROFILE} set up with the existing certificate.")
            return

        # No password on record. A leftover certificate can't be used without it.
        if author.exists():
            if not args.force:
                fail(f"{author} exists but its password isn't in ~/.cleanhub/signing.json. Restore "
                     "~/.cleanhub from your backup and run setup again, or run setup --force to make a "
                     "new certificate (Clean Hub on the TV must then be uninstalled before the next install).")
            aside = author.with_name(f"{author.name}.{stamp()}.bak")
            author.rename(aside)
            say(f"Moved the old certificate aside to {aside}.")
        if BACKUP.exists():
            BACKUP.rename(BACKUP.with_name(f"author.p12.{stamp()}.bak"))

        password = secrets.token_urlsafe(18)
        say("Creating a Tizen author certificate …")
        author.parent.mkdir(parents=True, exist_ok=True)
        _, out = run([TIZEN, "certificate", "-a", CERT_ALIAS, "-p", password, "-c", "US",
                      "-n", "Clean Hub", "-o", "Personal", "-f", CERT_ALIAS, "--", author.parent])
        if not author.exists():
            fail("tizen certificate failed:\n" + out.replace(password, "••••"))
        dist = register_profile(author, password)
        state_dir()
        shutil.copy2(author, BACKUP)
        save_json("signing.json", {"profile": PROFILE, "author": str(author), "backup": str(BACKUP),
                                   "password": password, "distributor": str(dist)}, private=True)
        lock_down(author)
        say(f"✓ Signing set up: profile {PROFILE}, author certificate {author}")
        say("  Back up ~/.cleanhub (it holds the certificate and its password). Updates need the same one.")
    finally:
        os.umask(old_umask)


def cmd_package(args, quiet=False):
    need_sdk()
    sign = signing()
    code, out = run(["node", ROOT / "scripts" / "build.mjs"])
    if code != 0:
        fail("Build failed:\n" + out)
    app_dir = ROOT / "dist" / "app"
    before = {p: p.stat().st_mtime for p in (ROOT / "dist").glob("*.wgt")}
    code, out = run_pty([TIZEN, "package", "-t", "wgt", "-s", sign["profile"], "-o", ROOT / "dist", "--", app_dir],
                        package_answers(sign["password"]), secrets_to_hide=[sign["password"]])
    made = [p for p in (ROOT / "dist").glob("*.wgt") if p not in before or p.stat().st_mtime != before[p]]
    if code != 0 or not made:
        fail("Packaging failed:\n" + out[-3000:])
    newest = max(made, key=lambda p: p.stat().st_mtime)
    if newest != WGT:
        newest.replace(WGT)
    with zipfile.ZipFile(WGT) as z:
        names = set(z.namelist())
    if not {"author-signature.xml", "signature1.xml", "config.xml"} <= names:
        fail(f"{WGT.name} is missing its signatures; not installing it.")
    if not quiet:
        say(f"✓ Signed {WGT.relative_to(ROOT)} ({WGT.stat().st_size // 1024} KB)")


def ip_problem(mac, dev_ip):
    """What to tell the viewer when the TV trusts another address, or None."""
    if dev_ip == mac:
        return None
    reversed_ip = ".".join(reversed(mac.split(".")))
    if dev_ip == reversed_ip:
        return (f"The TV saved Host PC IP backwards ({dev_ip}); this happens when its menu language reads "
                f"right-to-left. Open the Developer Mode box again and type it in reverse, {reversed_ip}, "
                f"so it's saved as {mac} (or switch the TV's menu language to English while you enter it), "
                "then fully restart the TV.")
    return (f"The TV trusts {dev_ip or 'no computer'}, not this Mac ({mac}). Set Host PC IP to {mac} in "
            "the Developer Mode box, then fully restart the TV.")


def check_tv(tv, strict=True):
    """Doctor's checks; returns a list of problems (empty = ready)."""
    problems = []
    try:
        mac = mac_ip_for(tv)
    except OSError as e:
        return [f"This Mac has no route to {tv}: {e}"]
    say(f"  This Mac reaches the TV from {mac}")
    try:
        info = tv_rest(tv).get("device", {})
    except Exception as e:  # noqa: BLE001 — any failure here means "can't see the TV"
        return [f"Couldn't reach the TV at http://{tv}:8001 ({e.__class__.__name__}). "
                "Is it on, on the same network, and is the IP right?"]
    say(f"  TV: {info.get('modelName', '?')} — {info.get('name', '?')} ({info.get('OS', '?')})")
    if str(info.get("developerMode", "")) != "1":
        problems.append("Developer Mode is off. On the TV: Apps → (App Settings) → enter 1 2 3 4 5 "
                        "with the 123 button's on-screen keypad → Developer mode On.")
    else:
        msg = ip_problem(mac, str(info.get("developerIP", "")))
        if msg:
            problems.append(msg)
    if not port_open(tv):
        problems.append("The TV's developer port (26101) is closed. Fully restart the TV: hold the "
                        "remote's power button until the logo appears, or unplug it for 30 seconds.")
    if not problems and strict and TIZEN.exists():
        connect(tv)
        ver = platform_version(tv)
        say(f"  Tizen version: {ver or 'unknown'}")
        if ver and int(ver.split(".")[0]) >= 7:
            problems.append(f"This TV runs Tizen {ver}, which needs a Samsung certificate. "
                            "This script only does the plain Tizen certificate used for 2022 and older TVs.")
    return problems


def cmd_doctor(args):
    tv = tv_address(args)
    say("Checking this Mac …")
    say(f"  Tizen SDK: {'found in ' + str(SDK) if TIZEN.exists() else 'not installed (install-sdk)'}")
    sign = load_json("signing.json")
    say(f"  Signing certificate: {'ready' if sign.get('password') else 'not set up (setup)'}")
    say(f"Checking the TV at {tv} …")
    problems = check_tv(tv)
    if problems:
        say("\nNot ready yet:")
        for p in problems:
            say("  ✗ " + p)
        sys.exit(1)
    say("\n✓ The TV is ready for installs.")


def explain_install(out):
    flat = out.replace(" ", "")
    for code, meaning in INSTALL_ERRORS.items():
        if code in flat:
            return meaning
    return None


def install_result(out):
    """'ok', 'failed' or 'unknown', from what the TV's installer printed."""
    failed = re.search(r"install\s*failed\s*\[|download\s*failed\s*\[|val\[fail\]|timed out after", out, re.I)
    ok = re.search(r"installing\[100\]|install\s+completed|successfully\s+installed|installed the package", out, re.I)
    if failed:
        return "failed"
    return "ok" if ok else "unknown"


def installed(tv, app_id):
    """True / False from the TV's app list, or None when it won't say."""
    for verb in ("vd_applist", "applist"):
        code, out = sdb(tv, "shell", "0", verb, timeout=60)
        if code == 0 and not re.search(r"closed|error:|not found|could not", out, re.I) and "app" in out.lower():
            return app_id in out
    return None


def cmd_install(args):
    tv = tv_address(args)
    app_id, version = manifest()
    need_sdk()
    signing()
    say(f"Checking the TV at {tv} …")
    problems = check_tv(tv)
    if problems:
        fail("The TV isn't ready:\n  " + "\n  ".join(problems))
    cmd_package(args)
    say(f"Installing Clean Hub {version} …")
    _, out = run([TIZEN, "install", "-n", WGT.name, "-s", f"{tv}:{SDB_PORT}", "--", WGT.parent], timeout=300)
    meaning = explain_install(out)
    if meaning:
        fail(f"The TV refused the install: {meaning}\n\n{out.strip()[-1500:]}")
    result = install_result(out)
    if result != "ok":
        # Some TVs let the SDK upload the widget without installing it; ask the
        # TV's installer directly.
        say("  The SDK didn't confirm the install; asking the TV's installer directly …")
        remote = f"/home/owner/share/tmp/sdk_tools/{WGT.name}"
        sdb(tv, "push", WGT, remote, timeout=300)
        _, out2 = sdb(tv, "shell", "0", "vd_appinstall", app_id, remote, timeout=300)
        meaning = explain_install(out2)
        if meaning or install_result(out2) != "ok":
            fail("Install failed" + (f": {meaning}" if meaning else "") +
                 f"\n\n{out.strip()[-1200:]}\n{out2.strip()[-1200:]}")
    listed = installed(tv, app_id)
    if listed is False:
        fail("The installer reported success but the TV doesn't list Clean Hub. Run install again; "
             "if it repeats, check the TV's Apps panel.")
    say("✓ Installed." if listed else "✓ Installed (the TV wouldn't list its apps to double-check).")
    cmd_open(args, tv=tv)


def cmd_open(args, tv=None):
    tv = tv or tv_address(args)
    app_id, _ = manifest()
    need_sdk()
    connect(tv)
    _, out = run([TIZEN, "run", "-p", app_id, "-s", f"{tv}:{SDB_PORT}"], timeout=60)
    if not re.search(r"launch|success", out, re.I):
        sdb(tv, "shell", "0", "execute", app_id, timeout=60)
    say("✓ Clean Hub should now be on the TV.")


def cmd_uninstall(args):
    tv = tv_address(args)
    app_id, _ = manifest()
    need_sdk()
    connect(tv)
    run([TIZEN, "uninstall", "-p", app_id, "-s", f"{tv}:{SDB_PORT}"], timeout=120)
    if installed(tv, app_id) is not False:
        sdb(tv, "shell", "0", "vd_appuninstall", app_id, timeout=120)
    listed = installed(tv, app_id)
    if listed is None:
        fail("Couldn't confirm Clean Hub is gone (the TV won't list its apps). Check the Apps panel; "
             "to remove it there: Apps → Settings → Clean Hub → Delete.")
    if listed:
        fail("Clean Hub is still installed. Remove it on the TV: Apps → Settings → Clean Hub → Delete.")
    say("✓ Clean Hub removed from the TV.")


def cmd_debug(args):
    """Relaunches Clean Hub in debug mode and saves its DevTools endpoint for
    scripts/tv-inspect.mjs. Debug launches only start from a stopped app."""
    tv = tv_address(args)
    app_id, _ = manifest()
    need_sdk()
    connect(tv)
    sdb(tv, "shell", "0", "was_kill", app_id.split(".")[0], timeout=30)
    proc = subprocess.Popen([str(SDB), "-s", f"{tv}:{SDB_PORT}", "shell", "0", "debug", app_id],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    port = None
    deadline = time.time() + 40
    try:
        while time.time() < deadline:
            ready, _, _ = select.select([proc.stdout], [], [], 1)
            if not ready:
                continue
            line = proc.stdout.readline()
            if not line:
                break
            m = re.search(r"port:\s*(\d+)", line)
            if m:
                port = int(m.group(1))
                break
    finally:
        proc.terminate()
    if not port:
        fail("The TV didn't start Clean Hub in debug mode. Is Developer Mode still on for this Mac?")
    save_json("debug.json", {"host": tv, "port": port})
    say(f"✓ Clean Hub is running in debug mode; DevTools at http://{tv}:{port}/json")
    say("  Try: node scripts/tv-inspect.mjs eval 'CleanHub.main.state.screen'")


def cmd_ids(args):
    """Prints the app ids the TV reports, to tune catalog.js."""
    tv = tv_address(args)
    need_sdk()
    connect(tv)
    for verb in ("vd_applist", "applist"):
        _, out = sdb(tv, "shell", "0", verb, timeout=60)
        if out.strip():
            say(out.strip())
            return
    fail("The TV wouldn't list its apps over sdb. Settings → Apps on Home → Show everything the TV lists "
         "shows the same list on the TV itself.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("install-sdk", help="download and install the Tizen SDK 10 CLI (once)")
    p.add_argument("--accept-license", action="store_true", help="agree to the Tizen SDK licence")
    p = sub.add_parser("setup", help="set up (or restore) the signing certificate and profile")
    p.add_argument("--force", action="store_true",
                   help="rebuild the signing profile; with no saved password, make a new certificate")
    sub.add_parser("package", help="build and sign dist/CleanHub.wgt")
    for name, text in (("doctor", "check that the TV is ready"), ("install", "build, sign, install and open"),
                       ("open", "open Clean Hub on the TV"), ("uninstall", "remove Clean Hub from the TV"),
                       ("ids", "list the app ids the TV reports"),
                       ("debug", "relaunch Clean Hub in debug mode for tv-inspect.mjs")):
        p = sub.add_parser(name, help=text)
        p.add_argument("--tv", help="the TV's IP address (remembered)")
    args = parser.parse_args()
    {
        "install-sdk": cmd_install_sdk, "setup": cmd_setup, "package": cmd_package, "doctor": cmd_doctor,
        "install": cmd_install, "open": cmd_open, "uninstall": cmd_uninstall, "ids": cmd_ids,
        "debug": cmd_debug,
    }[args.command](args)


if __name__ == "__main__":
    main()
