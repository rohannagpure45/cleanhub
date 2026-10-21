"""Offline tests for scripts/tv.py (no TV, no SDK needed)."""
import importlib.util
import json
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
