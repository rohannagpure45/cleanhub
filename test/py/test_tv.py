"""Offline tests for scripts/tv.py (no TV, no SDK needed)."""
import importlib.util
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("tv", ROOT / "scripts" / "tv.py")
tv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tv)


class ManifestTest(unittest.TestCase):
    def test_reads_app_id_and_version(self):
        app_id, version = tv.manifest()
        self.assertEqual(app_id, "CleanHub01.Launcher")
        self.assertRegex(version, r"^\d+\.\d+\.\d+$")


class InstallErrorTest(unittest.TestCase):
    def test_known_codes_are_explained(self):
        self.assertIn("different author", tv.explain_install("Install failed [118, -11] author mismatch"))
        self.assertIn("certificate chain", tv.explain_install("error : [118,-12] Check certificate error"))
        self.assertIsNone(tv.explain_install("Installed the package: Id(CleanHub01.Launcher)"))


class PtyTest(unittest.TestCase):
    """The Tizen CLI prompts on the terminal; run_pty must answer and hide secrets."""

    def test_answers_prompts_in_order_and_masks_the_password(self):
        script = textwrap.dedent("""
            import getpass
            a = getpass.getpass('Author password: ')
            d = getpass.getpass('Distributor password: ')
            n = input('Overwrite it? No: (N) ? ')
            print('GOT', a, d, n)
        """)
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(script)
        answers = [(r"distributor[^\n]*password", "dist-pw"), (r"password", "s3cret-author"), (r"\(N\)\s*\?", "n")]
        code, out = tv.run_pty([sys.executable, f.name], answers, secrets_to_hide=["s3cret-author"], timeout=20)
        Path(f.name).unlink()
        self.assertEqual(code, 0, out)
        self.assertIn("GOT •••• dist-pw n", out)
        self.assertNotIn("s3cret-author", out)

    def test_times_out(self):
        code, out = tv.run_pty([sys.executable, "-c", "import time; time.sleep(30)"], [], timeout=1)
        self.assertEqual(code, 124)
        self.assertIn("timed out", out)


class TvAddressTest(unittest.TestCase):
    def test_rejects_non_ip(self):
        args = type("A", (), {"tv": "my-tv.local"})()
        with self.assertRaises(SystemExit):
            tv.tv_address(args)


if __name__ == "__main__":
    unittest.main()
