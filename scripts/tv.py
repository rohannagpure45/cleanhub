#!/usr/bin/env python3
"""Clean Hub TV helper: sign, install and manage Clean Hub on a Samsung TV in
Developer Mode, from this Mac. Standard library only.

  python3 scripts/tv.py install-sdk --accept-license   # once: Tizen SDK 10 CLI
  python3 scripts/tv.py setup                          # once: signing certificate
  python3 scripts/tv.py doctor  --tv 192.168.1.50      # is the TV ready?
  python3 scripts/tv.py install --tv 192.168.1.50      # build, sign, install, open
  python3 scripts/tv.py open | uninstall | ids         # (remembers the last --tv)

Signing: 2022 TVs (Tizen 6.5) accept a plain Tizen developer certificate paired
with the SDK's "old" public distributor certificate, so no Samsung account is
involved. Tizen 7+ TVs need a Samsung certificate instead; `install` stops and
says so if it finds one.

Everything this script keeps lives in ~/.cleanhub (outside the repo). Back that
folder up: every future update must be signed with the same author certificate,
or the TV refuses it until Clean Hub is uninstalled (losing its settings).
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
import stat
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = Path.home()
SDK = Path(os.environ.get("TIZEN_SDK", HOME / "tizen-studio"))
SDK_DATA = HOME / "tizen-studio-data"
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

# Install errors the TV reports, and what they mean here.
INSTALL_ERRORS = {
    "118,-11": "the TV has Clean Hub signed with a different author certificate. "
               "Uninstall it first (python3 scripts/tv.py uninstall); its settings are lost.",
    "118,-12": "the TV rejected the certificate chain. On a 2022 TV this means the wrong "
               "(new) distributor certificate was used; re-run setup.",
    "118,-4": "the TV refused the package: required_version or a privilege is too new for it.",
    "118,-14": "a partner-level privilege needs a Samsung partner certificate.",
    "118,-22": "the package id is blocked by an older install from another author.",
    "118022": "the package id is blocked by an older install from another author.",
    "116": "the TV is out of space for apps.",
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


def load_json(name):
    try:
        return json.loads((STATE / name).read_text())
    except (OSError, ValueError):
        return {}


def save_json(name, data, private=False):
    STATE.mkdir(mode=0o700, exist_ok=True)
    path = STATE / name
    path.write_text(json.dumps(data, indent=2) + "\n")
    if private:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)


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
        p = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def run_pty(cmd, answers, secrets_to_hide=(), timeout=600):
    """Runs a command in a pseudo-terminal and answers its prompts. The Tizen
    CLI asks for certificate passwords on the terminal even when the profile
    already stores them. `answers` is [(regex, reply)], checked in order."""
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execv(str(cmd[0]), [str(c) for c in cmd])
        finally:
            os._exit(127)
    out, pending = b"", b""
    deadline = time.time() + timeout
    while True:
        if time.time() > deadline:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
            return 124, out.decode(errors="replace") + f"\n(timed out after {timeout}s)"
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
        text = pending.decode(errors="replace")
        for pattern, reply in answers:
            if re.search(pattern, text, re.I):
                os.write(fd, (reply + "\n").encode())
                pending = b""
                break
    _, status = os.waitpid(pid, 0)
    text = out.decode(errors="replace")
    for s in secrets_to_hide:
        text = text.replace(s, "••••")
    return os.waitstatus_to_exitcode(status), text


def mac_ip_for(tv):
    """The address this Mac uses to reach the TV (what the TV must trust)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((tv, 9))  # no packet is sent; this only picks the route
        return s.getsockname()[0]
    finally:
        s.close()


def tv_rest(tv):
    """Samsung's local API reports Developer Mode and the trusted host."""
    with urllib.request.urlopen(f"http://{tv}:8001/api/v2/", timeout=5) as r:
        return json.load(r)


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


def signing():
    data = load_json("signing.json")
    if not data.get("password") or not Path(data.get("author", "")).exists():
        fail("No signing certificate yet. Run: python3 scripts/tv.py setup")
    return data


def sdb(tv, *args, timeout=120):
    return run([SDB, "-s", f"{tv}:{SDB_PORT}", *args], timeout=timeout)


def connect(tv):
    code, out = run([SDB, "connect", f"{tv}:{SDB_PORT}"], timeout=30)
    if "connected" not in out.lower():
        fail(f"Couldn't connect to the TV over sdb:\n{out.strip()}\n"
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
    dl = STATE / "downloads"
    dl.mkdir(parents=True, exist_ok=True)
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
    say("✓ " + ver.strip().splitlines()[-1] if ver.strip() else "✓ Tizen SDK installed")


def find_old_distributor():
    base = SDK / "tools" / "certificate-generator" / "certificates" / "distributor"
    for folder in (base / "sdk-public", base):
        p12, ca = folder / "tizen-distributor-signer.p12", folder / "tizen-distributor-ca.cer"
        if p12.exists() and ca.exists():
            return p12, ca
    fail(f"The SDK's old public distributor certificate isn't in {base}. "
         "This SDK may have dropped it; see README 'Signing' for the Tizen Studio 6.1 fallback.")


def cmd_setup(args):
    need_sdk()
    data = load_json("signing.json")
    if data.get("password") and Path(data.get("author", "")).exists() and not args.force:
        say(f"✓ Signing is already set up (profile {PROFILE}, certificate {data['author']}).")
        return
    password = secrets.token_urlsafe(18)
    author = SDK_DATA / "keystore" / "author" / f"{CERT_ALIAS}.p12"
    if author.exists():
        fail(f"{author} exists but its password isn't in ~/.cleanhub/signing.json. "
             "Restore ~/.cleanhub from your backup, or re-run with --force to replace it "
             "(the TV will then need Clean Hub uninstalled before the next install).")
    say("Creating a Tizen author certificate …")
    code, out = run([TIZEN, "certificate", "-a", CERT_ALIAS, "-p", password, "-c", "US",
                     "-n", "Clean Hub", "-o", "Personal", "-f", CERT_ALIAS])
    if not author.exists():
        fail("tizen certificate failed:\n" + out.replace(password, "••••"))
    dist, dist_ca = find_old_distributor()
    dev_ca = SDK / "tools" / "certificate-generator" / "certificates" / "developer" / "tizen-developer-ca.cer"
    run([TIZEN, "security-profiles", "remove", "-n", PROFILE])
    cmd = [TIZEN, "security-profiles", "add", "-n", PROFILE, "-a", author, "-p", password,
           "-d", dist, "-dp", DIST_PASSWORD, "-dc", dist_ca]
    if dev_ca.exists():
        cmd[7:7] = ["-c", dev_ca]
    code, out = run(cmd)
    _, listed = run([TIZEN, "security-profiles", "list"])
    if PROFILE not in listed:
        fail("Couldn't register the signing profile:\n" + out.replace(password, "••••"))
    STATE.mkdir(mode=0o700, exist_ok=True)
    backup = STATE / "author.p12"
    shutil.copy2(author, backup)
    backup.chmod(stat.S_IRUSR | stat.S_IWUSR)
    save_json("signing.json", {"profile": PROFILE, "author": str(author), "backup": str(backup),
                               "password": password, "distributor": str(dist)}, private=True)
    say(f"✓ Signing set up: profile {PROFILE}, author certificate {author}")
    say("  Back up ~/.cleanhub (it holds the certificate and its password). Updates need the same one.")


def cmd_package(args, quiet=False):
    need_sdk()
    sign = signing()
    code, out = run(["node", ROOT / "scripts" / "build.mjs"])
    if code != 0:
        fail("Build failed:\n" + out)
    app_dir = ROOT / "dist" / "app"
    for leftover in ("author-signature.xml", "signature1.xml", ".manifest.tmp"):
        (app_dir / leftover).unlink(missing_ok=True)
    before = {p: p.stat().st_mtime for p in (ROOT / "dist").glob("*.wgt")}
    answers = [
        (r"distributor[^\n]*password", DIST_PASSWORD),
        (r"password", sign["password"]),
        (r"\(N\)\s*\?|\[y/N\]|yes/no", "n"),
    ]
    code, out = run_pty([TIZEN, "package", "-t", "wgt", "-s", sign["profile"], "-o", ROOT / "dist", "--", app_dir],
                        answers, secrets_to_hide=[sign["password"]])
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
        say(f"  TV: {info.get('modelName', '?')} — {info.get('name', '?')} ({info.get('OS', '?')})")
        dev_mode, dev_ip = str(info.get("developerMode", "")), str(info.get("developerIP", ""))
        if dev_mode != "1":
            problems.append("Developer Mode is off. On the TV: Apps → (App Settings) → enter 1 2 3 4 5 "
                            "with the 123 button's on-screen keypad → Developer mode On.")
        elif dev_ip != mac:
            reversed_ip = ".".join(reversed(mac.split(".")))
            hint = " (it's stored reversed, as right-to-left languages do)" if dev_ip == reversed_ip else ""
            problems.append(f"The TV trusts {dev_ip or 'no computer'}{hint}, not this Mac ({mac}). "
                            f"Set Host PC IP to {mac} in the Developer Mode box, then fully restart the TV.")
    except Exception as e:  # noqa: BLE001 — any failure here means "can't see the TV"
        problems.append(f"Couldn't reach the TV at http://{tv}:8001 ({e.__class__.__name__}). "
                        "Is it on, on the same network, and is the IP right?")
        return problems
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
    for code, meaning in INSTALL_ERRORS.items():
        if code in out.replace(" ", ""):
            return meaning
    return None


def installed(tv, app_id):
    _, out = sdb(tv, "shell", "0", "applist", timeout=60)
    return app_id in out


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
    code, out = run([TIZEN, "install", "-n", WGT.name, "-s", f"{tv}:{SDB_PORT}", "--", WGT.parent], timeout=300)
    meaning = explain_install(out)
    if meaning:
        fail(f"The TV refused the install: {meaning}\n\n{out.strip()[-1500:]}")
    if not installed(tv, app_id):
        # Some TVs let the SDK upload the widget without installing it; ask the
        # TV's installer directly.
        say("  The SDK install didn't take; trying the TV's own installer …")
        remote = f"/home/owner/share/tmp/sdk_tools/{WGT.name}"
        sdb(tv, "push", WGT, remote, timeout=300)
        _, out2 = sdb(tv, "shell", "0", "vd_appinstall", app_id, remote, timeout=300)
        meaning = explain_install(out2)
        if meaning or not installed(tv, app_id):
            fail("Install failed" + (f": {meaning}" if meaning else "") + f"\n\n{out.strip()[-1200:]}\n{out2.strip()[-1200:]}")
    say("✓ Installed.")
    cmd_open(args, tv=tv)


def cmd_open(args, tv=None):
    tv = tv or tv_address(args)
    app_id, _ = manifest()
    need_sdk()
    connect(tv)
    code, out = run([TIZEN, "run", "-p", app_id, "-s", f"{tv}:{SDB_PORT}"], timeout=60)
    if "launched" not in out.lower() and "success" not in out.lower():
        sdb(tv, "shell", "0", "execute", app_id, timeout=60)
    say("✓ Clean Hub should now be on the TV.")


def cmd_uninstall(args):
    tv = tv_address(args)
    app_id, _ = manifest()
    need_sdk()
    connect(tv)
    run([TIZEN, "uninstall", "-p", app_id, "-s", f"{tv}:{SDB_PORT}"], timeout=120)
    if installed(tv, app_id):
        sdb(tv, "shell", "0", "vd_appuninstall", app_id, timeout=120)
    if installed(tv, app_id):
        fail("Clean Hub is still installed. Remove it on the TV: Apps → Settings → Clean Hub → Delete.")
    say("✓ Clean Hub removed from the TV.")


def cmd_ids(args):
    """Prints the app ids the TV reports, to tune catalog.js."""
    tv = tv_address(args)
    need_sdk()
    connect(tv)
    _, out = sdb(tv, "shell", "0", "applist", timeout=60)
    say(out.strip())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("install-sdk", help="download and install the Tizen SDK 10 CLI (once)")
    p.add_argument("--accept-license", action="store_true", help="agree to the Tizen SDK licence")
    p = sub.add_parser("setup", help="create the signing certificate and profile (once)")
    p.add_argument("--force", action="store_true", help="replace an existing certificate")
    sub.add_parser("package", help="build and sign dist/CleanHub.wgt")
    for name, text in (("doctor", "check that the TV is ready"), ("install", "build, sign, install and open"),
                       ("open", "open Clean Hub on the TV"), ("uninstall", "remove Clean Hub from the TV"),
                       ("ids", "list the app ids the TV reports")):
        p = sub.add_parser(name, help=text)
        p.add_argument("--tv", help="the TV's IP address (remembered)")
    args = parser.parse_args()
    {
        "install-sdk": cmd_install_sdk, "setup": cmd_setup, "package": cmd_package, "doctor": cmd_doctor,
        "install": cmd_install, "open": cmd_open, "uninstall": cmd_uninstall, "ids": cmd_ids,
    }[args.command](args)


if __name__ == "__main__":
    main()
