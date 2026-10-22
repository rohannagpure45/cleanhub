"""Offline tests for scripts/tv.py (no TV, no SDK needed)."""
import importlib.util
import json
import re
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("tv", ROOT / "scripts" / "tv.py")
tv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tv)


class ManifestTest(unittest.TestCase):
    def test_reads_app_id_and_version(self):
        app_id, version = tv.manifest()
        self.assertEqual(app_id, "CleanHub01.Launcher")
        self.assertRegex(version, r"^\d+\.\d+\.\d+$")


class InstallOutputTest(unittest.TestCase):
    def test_known_codes_are_explained(self):
        self.assertIn("different author", tv.explain_install("install failed[118, -11] author mismatch"))
        self.assertIn("certificate chain", tv.explain_install("error : install failed[118,-12] Check certificate error"))
        self.assertIn("out of space", tv.explain_install("download failed[116]"))

    def test_numbers_in_a_successful_log_are_not_errors(self):
        log = ("Transferred the package: 412 KB, spend time for wascmd is [1163]ms\n"
               "installing[100]\ninstall completed\nTotal time: 00:00:01.116  (TV 192.168.1.116)")
        self.assertIsNone(tv.explain_install(log))
        self.assertEqual(tv.install_result(log), "ok")

    def test_install_result(self):
        self.assertEqual(tv.install_result("Installed the package: Id(CleanHub01)"), "ok")
        self.assertEqual(tv.install_result("install failed[118, -12]"), "failed")
        self.assertEqual(tv.install_result("Transferred the package"), "unknown")


class HostIpTest(unittest.TestCase):
    def test_matching_ip_is_fine(self):
        self.assertIsNone(tv.ip_problem("192.168.1.196", "192.168.1.196"))

    def test_reversed_ip_says_to_type_it_reversed(self):
        msg = tv.ip_problem("192.168.1.196", "196.1.168.192")
        self.assertIn("type it in reverse, 196.1.168.192", msg)

    def test_other_ip(self):
        self.assertIn("Set Host PC IP to 192.168.1.196", tv.ip_problem("192.168.1.196", "192.168.1.141"))


class PtyTest(unittest.TestCase):
    """The Tizen CLI prompts on the terminal; run_pty must answer and hide secrets."""

    def run_script(self, script, answers, hide=(), timeout=20):
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(textwrap.dedent(script))
        try:
            return tv.run_pty([sys.executable, f.name], answers, secrets_to_hide=hide, timeout=timeout)
        finally:
            Path(f.name).unlink()

    def test_package_prompts_get_the_right_answers(self):
        # The real wording: a save-password question mentions "password" too.
        script = """
            import getpass
            a = getpass.getpass('Author password: ')
            while True:
                n = input('Do you want to save the password? Yes: (Y), No: (N) ?')
                if n in ('y', 'n'):
                    break
            d = getpass.getpass('Distributor1 password: ')
            print('GOT', a, n, d)
        """
        code, out = self.run_script(script, tv.package_answers("s3cret-author"), hide=["s3cret-author"])
        self.assertEqual(code, 0, out)
        self.assertIn(f"GOT •••• n {tv.DIST_PASSWORD}", out)
        self.assertNotIn("s3cret-author", out)

    def test_times_out(self):
        code, out = self.run_script("import time; time.sleep(30)", [], timeout=1)
        self.assertEqual(code, 124)
        self.assertIn("timed out", out)


class TvAddressTest(unittest.TestCase):
    def test_rejects_non_ip(self):
        args = type("A", (), {"tv": "my-tv.local"})()
        with self.assertRaises(SystemExit):
            tv.tv_address(args)


class SetupTest(unittest.TestCase):
    """setup must never replace a certificate the TV already trusts."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.state = self.tmp / "state"
        self.author = self.tmp / "sdk-data" / "keystore" / "author" / "cleanhub.p12"
        self.calls = []
        patches = [
            mock.patch.object(tv, "STATE", self.state),
            mock.patch.object(tv, "BACKUP", self.state / "author.p12"),
            mock.patch.object(tv, "author_path", lambda: self.author),
            mock.patch.object(tv, "need_sdk", lambda: None),
            mock.patch.object(tv, "profile_listed", lambda: False),
            mock.patch.object(tv, "register_profile", self.fake_register),
            mock.patch.object(tv, "run", self.fake_run),
            mock.patch.object(tv, "say", lambda *a: None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def fake_register(self, author, password):
        self.calls.append(("register", str(author), password))
        return Path("/sdk/distributor/sdk-public/tizen-distributor-signer.p12")

    def fake_run(self, cmd, timeout=180):
        cmd = [str(c) for c in cmd]
        self.calls.append(("run", cmd[1] if len(cmd) > 1 else cmd[0]))
        if len(cmd) > 1 and cmd[1] == "certificate":
            self.author.parent.mkdir(parents=True, exist_ok=True)
            self.author.write_bytes(b"NEW-CERT")
        return 0, ""

    def args(self, force=False):
        return type("A", (), {"force": force})()

    def test_first_setup_creates_and_backs_up(self):
        tv.cmd_setup(self.args())
        self.assertEqual((self.state / "author.p12").read_bytes(), b"NEW-CERT")
        data = json.loads((self.state / "signing.json").read_text())
        self.assertTrue(data["password"])
        self.assertEqual((self.state / "signing.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)

    def test_restore_from_backup_reuses_the_certificate(self):
        self.state.mkdir()
        (self.state / "author.p12").write_bytes(b"OLD-CERT")
        (self.state / "signing.json").write_text(json.dumps({"password": "old-pw"}))
        tv.cmd_setup(self.args())
        self.assertEqual(self.author.read_bytes(), b"OLD-CERT")
        self.assertNotIn(("run", "certificate"), self.calls)
        self.assertIn(("register", str(self.author), "old-pw"), self.calls)
        self.assertEqual(json.loads((self.state / "signing.json").read_text())["password"], "old-pw")

    def test_force_with_a_saved_password_keeps_the_author(self):
        self.state.mkdir()
        self.author.parent.mkdir(parents=True)
        self.author.write_bytes(b"OLD-CERT")
        (self.state / "author.p12").write_bytes(b"OLD-CERT")
        (self.state / "signing.json").write_text(json.dumps({"password": "old-pw"}))
        tv.cmd_setup(self.args(force=True))
        self.assertEqual(self.author.read_bytes(), b"OLD-CERT")
        self.assertNotIn(("run", "certificate"), self.calls)

    def test_orphan_certificate_needs_force_and_is_kept_aside(self):
        self.author.parent.mkdir(parents=True)
        self.author.write_bytes(b"ORPHAN")
        with self.assertRaises(SystemExit):
            tv.cmd_setup(self.args())
        tv.cmd_setup(self.args(force=True))
        asides = list(self.author.parent.glob("cleanhub.p12.*.bak"))
        self.assertEqual(len(asides), 1)
        self.assertEqual(asides[0].read_bytes(), b"ORPHAN")
        self.assertEqual(self.author.read_bytes(), b"NEW-CERT")


if __name__ == "__main__":
    unittest.main()


class DebugPortTest(unittest.TestCase):
    """`sdb shell 0 debug` prints the port and then keeps the session open."""

    def spawn(self, script):
        import subprocess
        return subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)

    def test_port_in_a_chunk_with_other_lines(self):
        proc = self.spawn("import sys, time; sys.stdout.write('status\\n... successfully launched pid = 6674 with debug 1 port: 43665\\n'); sys.stdout.flush(); time.sleep(30)")
        self.assertEqual(tv.read_debug_port(proc, 10), 43665)
        self.assertIsNotNone(proc.poll(), "the sdb process is stopped")

    def test_a_stalled_partial_line_still_times_out(self):
        import time
        proc = self.spawn("import sys, time; sys.stdout.write('... '); sys.stdout.flush(); time.sleep(30)")
        start = time.time()
        self.assertIsNone(tv.read_debug_port(proc, 2))
        self.assertLess(time.time() - start, 8)


class FireTvTest(unittest.TestCase):
    """`tv.py firetv`: the pairing and app list live in ~/.cleanhub, and only a build gets them."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.state = self.tmp / "state"
        self.app = self.tmp / "dist-app"
        (self.app / "service").mkdir(parents=True)
        (self.app / "js").mkdir()
        for p in [mock.patch.object(tv, "STATE", self.state), mock.patch.object(tv, "say", lambda *a: None)]:
            p.start()
            self.addCleanup(p.stop)

    def args(self, **kw):
        return type("A", (), dict({"firetv": None}, **kw))()

    def saved(self):
        return tv.load_json(tv.FIRETV_JSON)

    def apps_in_build(self):
        text = (self.app / "js" / "firetv-apps.js").read_text()
        return json.loads(text.split("CH.fireTvApps = ", 1)[1].rsplit(";\n})", 1)[0])

    def test_a_paired_build_gets_the_pairing_and_the_apps(self):
        apps = tv.write_firetv(self.app, {"host": "192.168.1.88", "token": "Tok", "paired": "2026-10-20",
                                          "apps": [{"name": "StbEmu", "package": "com.mvas.stb.emu.pro"}]})
        self.assertEqual([a["name"] for a in apps], ["StbEmu"])
        pairing = self.app / "service" / "config.json"
        self.assertEqual(json.loads(pairing.read_text()), {"host": "192.168.1.88", "token": "Tok"})
        self.assertEqual(pairing.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.apps_in_build(), [{"name": "StbEmu", "package": "com.mvas.stb.emu.pro"}])

    def test_names_are_escaped_into_the_script(self):
        name = 'Bob\'s "TV" </script> ✓'
        tv.write_firetv(self.app, {"host": "h", "token": "t", "apps": [{"name": name, "package": "a.b"}]})
        self.assertEqual(self.apps_in_build()[0]["name"], name)

    def test_without_a_pairing_home_gets_no_fire_tv_apps(self):
        (self.app / "service" / "config.json").write_text("{}")
        apps = tv.write_firetv(self.app, {"apps": [{"name": "StbEmu", "package": "com.mvas.stb.emu.pro"}]})
        self.assertEqual(apps, [])
        self.assertEqual(self.apps_in_build(), [])
        self.assertFalse((self.app / "service" / "config.json").exists(), "a stale pairing is removed")

    def test_add_replaces_the_same_package_and_checks_it(self):
        tv.firetv_add(self.args(name="Stb", package="com.mvas.stb.emu.pro"), {})
        tv.firetv_add(self.args(name="StbEmu", package="com.mvas.stb.emu.pro"), self.saved())
        self.assertEqual(self.saved()["apps"], [{"name": "StbEmu", "package": "com.mvas.stb.emu.pro"}])
        self.assertEqual((self.state / tv.FIRETV_JSON).stat().st_mode & 0o777, 0o600)
        for bad in ("../FireTV?action=home", "nodots", "com.x/y"):
            with self.assertRaises(SystemExit):
                tv.firetv_add(self.args(name="X", package=bad), self.saved())

    def test_remove_by_name_or_package(self):
        config = {"apps": [{"name": "StbEmu", "package": "com.mvas.stb.emu.pro"}, {"name": "Kodi", "package": "org.xbmc.kodi"}]}
        tv.firetv_remove(self.args(name="org.xbmc.kodi"), config)
        tv.firetv_remove(self.args(name="StbEmu"), self.saved())
        self.assertEqual(self.saved()["apps"], [])
        with self.assertRaises(SystemExit):
            tv.firetv_remove(self.args(name="Nope"), self.saved())

    def pair(self, verify, pin="5564", config=None):
        calls = []

        def api(host, path, body=None, token=None, timeout=10, method="POST"):
            calls.append((host, path, body))
            return (200, {"description": "OK"}) if path.endswith("/display") else verify

        with mock.patch.object(tv, "firetv_find", lambda args, config: "192.168.1.88"), \
                mock.patch.object(tv, "firetv_wake", lambda host: True), \
                mock.patch.object(tv, "firetv_api", api), \
                mock.patch("builtins.input", lambda prompt: pin):
            tv.firetv_pair(self.args(), config if config is not None else {})
        return calls

    def test_pair_saves_the_token_and_keeps_the_apps(self):
        apps = [{"name": "StbEmu", "package": "com.mvas.stb.emu.pro"}]
        calls = self.pair((200, {"description": "Wj9PP8I"}), config={"apps": apps})
        self.assertEqual(calls, [("192.168.1.88", "/v1/FireTV/pin/display", {"friendlyName": "Clean Hub"}),
                                 ("192.168.1.88", "/v1/FireTV/pin/verify", {"pin": "5564"})])
        saved = self.saved()
        self.assertEqual((saved["host"], saved["token"], saved["apps"]), ("192.168.1.88", "Wj9PP8I", apps))

    def test_a_wrong_pin_saves_nothing(self):
        with self.assertRaises(SystemExit):
            self.pair((400, {"description": "Invalid pin"}), pin="0000")
        self.assertEqual(self.saved(), {})


class FireTvShortcutTest(unittest.TestCase):
    """`tv.py firetv record|run`: a shortcut is an app plus the keys pressed in it."""

    STEPS = [{"key": "down", "wait": 4000}, {"key": "ok", "wait": 1200}, {"key": "down", "wait": 100},
             {"key": "ok", "wait": 900}]
    APPS = [{"name": "StbEmu", "package": "com.mvas.stb.emu.pro"}]

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.app = self.tmp / "dist-app"
        (self.app / "service").mkdir(parents=True)
        (self.app / "js").mkdir()
        self.said = []
        for p in [mock.patch.object(tv, "STATE", self.tmp / "state"),
                  mock.patch.object(tv, "say", lambda *a: self.said.append(" ".join(map(str, a))))]:
            p.start()
            self.addCleanup(p.stop)

    def args(self, **kw):
        return type("A", (), dict({"firetv": None, "icon": None}, **kw))()

    def basketball(self, **extra):
        return dict({"name": "Basketball", "package": "com.mvas.stb.emu.pro", "steps": self.STEPS,
                     "icon": "basketball"}, **extra)

    def test_a_paired_build_puts_shortcuts_after_the_apps(self):
        shown = tv.write_firetv(self.app, {"host": "h", "token": "t", "apps": self.APPS,
                                           "shortcuts": [self.basketball(), self.basketball(name="News", icon=None)]})
        self.assertEqual([a["name"] for a in shown], ["StbEmu", "Basketball", "News"])
        text = (self.app / "js" / "firetv-apps.js").read_text()
        listed = json.loads(text.split("CH.fireTvApps = ", 1)[1].rsplit(";\n})", 1)[0])
        self.assertEqual(listed, [self.APPS[0], self.basketball(),
                                  {"name": "News", "package": "com.mvas.stb.emu.pro", "steps": self.STEPS}])

    def test_a_shortcut_alone_still_brings_the_pairing(self):
        tv.write_firetv(self.app, {"host": "h", "token": "t", "shortcuts": [self.basketball()]})
        self.assertTrue((self.app / "service" / "config.json").exists())
        tv.write_firetv(self.app, {"shortcuts": [self.basketball()]})
        self.assertFalse((self.app / "service" / "config.json").exists(), "unpaired: no shortcuts either")

    def test_recording_keeps_the_keys_and_the_pauses_between_them(self):
        typed = iter(["\x1b[B", "x", "\r", "\x1b[B", "\x7f", " ", "s"])
        clock = iter([4.0, 5.2, 5.3, 6.2, 9.0])
        sent = []
        steps = tv.record_steps(lambda: next(typed), lambda k: sent.append(k) or True, lambda: next(clock), 0.0)
        self.assertEqual(sent, ["down", "ok", "down", "back", "play"], "keys go to the stick as they're pressed")
        self.assertEqual(steps, [{"key": "down", "wait": 4000}, {"key": "ok", "wait": 1200},
                                 {"key": "down", "wait": 100}, {"key": "back", "wait": 900},
                                 {"key": "play", "wait": 2800}])

    def test_a_key_the_stick_missed_isnt_recorded_and_its_pause_carries_on(self):
        typed = iter(["\x1bOB", "\r", "\r", "S"])
        clock = iter([1.0, 2.0, 2.5])
        answers = iter([True, False, True])
        steps = tv.record_steps(lambda: next(typed), lambda k: next(answers), lambda: next(clock), 0.0)
        self.assertEqual(steps, [{"key": "down", "wait": 1000}, {"key": "ok", "wait": 1500}])

    def test_quitting_a_recording_keeps_nothing(self):
        for quit_key in ("q", "\x1b", "\x03", ""):
            typed = iter(["\r", quit_key])
            self.assertIsNone(tv.record_steps(lambda: next(typed), lambda k: True, lambda: 1.0, 0.0))

    def test_a_long_pause_is_capped_and_a_recording_has_a_limit(self):
        typed = iter(["\r"] * 100)
        clock = iter(range(0, 4000, 40))
        steps = tv.record_steps(lambda: next(typed), lambda k: True, lambda: next(clock), 0.0)
        self.assertEqual(len(steps), tv.STEPS_MAX)
        self.assertEqual(steps[1]["wait"], tv.STEP_WAIT_MAX)

    def test_the_icon_comes_from_the_name_unless_chosen(self):
        self.assertEqual(tv.shortcut_icon("NBA Basketball", None), "basketball")
        self.assertEqual(tv.shortcut_icon("Premier League", None), None)
        self.assertEqual(tv.shortcut_icon("Premier League", "soccer"), "soccer")
        self.assertEqual(tv.shortcut_icon("Basketball", "none"), None)
        with self.assertRaises(SystemExit):
            tv.shortcut_icon("X", "cricket")

    def test_the_app_is_a_home_app_by_name_or_a_package(self):
        config = {"apps": self.APPS}
        self.assertEqual(tv.shortcut_app("stbemu", config), "com.mvas.stb.emu.pro")
        self.assertEqual(tv.shortcut_app("org.xbmc.kodi", config), "org.xbmc.kodi")
        with self.assertRaises(SystemExit):
            tv.shortcut_app("Kodi", config)

    def record(self, typed, config):
        typed = iter(typed)
        with mock.patch.object(tv, "firetv_start", lambda args, config, package: "192.168.1.88"), \
                mock.patch.object(tv, "firetv_key", lambda host, token, name: True), \
                mock.patch.object(tv, "read_terminal_key", lambda fd: next(typed)), \
                mock.patch.object(tv.sys.stdin, "isatty", lambda: True, create=True), \
                mock.patch.object(tv.sys.stdin, "fileno", lambda: 0, create=True), \
                mock.patch.object(tv.termios, "tcgetattr", lambda fd: []), \
                mock.patch.object(tv.termios, "tcsetattr", lambda fd, when, attrs: None), \
                mock.patch.object(tv.tty, "setcbreak", lambda fd: None):
            tv.firetv_record(self.args(name="Basketball", app="StbEmu"), config)

    def test_record_saves_the_shortcut_replacing_one_of_the_same_name(self):
        config = {"host": "192.168.1.88", "token": "t", "apps": self.APPS,
                  "shortcuts": [self.basketball(steps=[{"key": "ok", "wait": 1}])]}
        self.record(["\x1b[B", "\r", "s"], config)
        saved = tv.load_json(tv.FIRETV_JSON)
        self.assertEqual(len(saved["shortcuts"]), 1)
        shortcut = saved["shortcuts"][0]
        self.assertEqual((shortcut["name"], shortcut["package"], shortcut["icon"]),
                         ("Basketball", "com.mvas.stb.emu.pro", "basketball"))
        self.assertEqual([s["key"] for s in shortcut["steps"]], ["down", "ok"])
        self.assertEqual((self.tmp / "state" / tv.FIRETV_JSON).stat().st_mode & 0o777, 0o600)

    def test_record_then_quit_saves_nothing(self):
        self.record(["\r", "q"], {"host": "h", "token": "t", "apps": self.APPS})
        self.assertEqual(tv.load_json(tv.FIRETV_JSON), {})

    def test_run_plays_the_keys_with_the_tvs_timing(self):
        slept, pressed = [], []
        config = {"host": "h", "token": "t", "apps": self.APPS, "shortcuts": [self.basketball()]}
        with mock.patch.object(tv, "firetv_start", lambda args, config, package: "192.168.1.88"), \
                mock.patch.object(tv, "firetv_key", lambda host, token, name: pressed.append(name) or True), \
                mock.patch.object(tv.time, "sleep", slept.append):
            tv.firetv_run(self.args(name="basketball"), config)
        self.assertEqual(pressed, ["down", "ok", "down", "ok"])
        self.assertEqual(slept, [5.5, 1.2, 0.3, 0.9])

    def test_run_stops_where_the_stick_stops_answering(self):
        config = {"host": "h", "token": "t", "shortcuts": [self.basketball()]}
        answers = iter([True, False])
        with mock.patch.object(tv, "firetv_start", lambda args, config, package: "h"), \
                mock.patch.object(tv, "firetv_key", lambda host, token, name: next(answers)), \
                mock.patch.object(tv.time, "sleep", lambda s: None):
            with self.assertRaises(SystemExit):
                tv.firetv_run(self.args(name="Basketball"), config)

    def test_a_key_that_gets_no_answer_wakes_the_stick_once(self):
        answers = iter([OSError("timed out"), (200, "OK")])

        def api(host, path, body=None, token=None, timeout=10, method="POST"):
            a = next(answers)
            if isinstance(a, Exception):
                raise a
            return a

        woke = []
        with mock.patch.object(tv, "firetv_api", api), \
                mock.patch.object(tv, "firetv_wake", lambda host, wait=15: woke.append(host) or True):
            self.assertTrue(tv.firetv_key("h", "t", "ok"))
        self.assertEqual(woke, ["h"])
        with mock.patch.object(tv, "firetv_api", lambda *a, **k: (403, "no")):
            with self.assertRaises(SystemExit):
                tv.firetv_key("h", "t", "ok")

    def test_list_and_remove_know_shortcuts(self):
        config = {"token": "t", "host": "h", "apps": self.APPS, "shortcuts": [self.basketball()]}
        tv.firetv_list(self.args(), config)
        self.assertIn("  Basketball (shortcut in StbEmu): ↓ OK ↓ OK (4 presses, about 8 s)", self.said)
        tv.firetv_remove(self.args(name="Basketball"), config)
        saved = tv.load_json(tv.FIRETV_JSON)
        self.assertEqual((saved["apps"], saved["shortcuts"]), (self.APPS, []))

    def test_the_mac_and_the_tv_play_shortcuts_by_the_same_rules(self):
        js = (ROOT / "app" / "service" / "firetv.js").read_text()
        for name in ("STEPS_MAX", "STEP_WAIT_MAX", "STEP_MIN_MS", "FIRST_EXTRA_MS"):
            self.assertEqual(int(re.search(rf"const {name} = (\d+);", js).group(1)), getattr(tv, name), name)
        js_keys = dict(re.findall(r"^  (\w+): '(/v1/[^']+)'", js, re.M))
        self.assertEqual({k: v for k, v in js_keys.items() if k != "home"}, tv.FIRETV_KEY_PATHS)
        self.assertEqual(set(tv.TERMINAL_KEYS.values()), set(tv.FIRETV_KEY_PATHS))
