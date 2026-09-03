import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from opus_copy.tools import _runtime_dirs, find_executable

DESKTOP_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = DESKTOP_ROOT.parent


class StartupAndBuildTests(unittest.TestCase):
    def test_source_run_ignores_stale_bundled_runtime(self):
        with patch.object(sys, "frozen", False, create=True):
            self.assertEqual(_runtime_dirs(), ())

    def test_bundled_runtime_tool_is_found(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            tool = runtime / "ffmpeg"
            tool.touch()
            with patch("opus_copy.tools._runtime_dirs", return_value=(runtime,)):
                self.assertEqual(find_executable("ffmpeg"), str(tool))

    def test_build_output_matches_documented_desktop_dist(self):
        script = (DESKTOP_ROOT / "build.ps1").read_text(encoding="utf-8")
        self.assertIn("--workpath $buildDir", script)
        self.assertIn("--distpath $distRoot", script)
        self.assertIn("desktop\\dist\\OPUS-COPY", script)

    def test_root_launcher_delegates_to_desktop(self):
        script = (PROJECT_ROOT / "iniciar.ps1").read_text(encoding="utf-8")
        self.assertIn("desktop\\run.ps1", script)
        self.assertIn("$PSScriptRoot", script)

    def test_launcher_refreshes_an_outdated_environment(self):
        script = (DESKTOP_ROOT / "run.ps1").read_text(encoding="utf-8")
        self.assertIn("setup-version.txt", script)
        self.assertIn("$installedVersion -ne $expectedVersion", script)


if __name__ == "__main__":
    unittest.main()
