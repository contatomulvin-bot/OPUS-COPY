import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class InstallerContractTests(unittest.TestCase):
    def test_installer_has_every_required_dependency(self):
        content = (ROOT / "install.ps1").read_text(encoding="utf-8")
        for package in ("Git.Git", "Python.Python.3.11", "OpenJS.NodeJS.LTS", "Gyan.FFmpeg"):
            self.assertIn(package, content)

    def test_installer_never_contains_a_developer_specific_windows_path(self):
        content = (ROOT / "install.ps1").read_text(encoding="utf-8")
        self.assertNotIn("C:\\Users\\Mulvin", content)
        self.assertIn("LocalApplicationData", content)

    def test_installer_preserves_generated_clips_outside_the_program_folder(self):
        installer = (ROOT / "install.ps1").read_text(encoding="utf-8")
        app = (ROOT / "desktop" / "main.py").read_text(encoding="utf-8")
        self.assertIn("OPUS_COPY_DATA_DIR", installer)
        self.assertIn("OPUS_COPY_DATA_DIR", app)

    def test_inno_setup_wraps_the_bootstrap_and_creates_an_uninstaller(self):
        content = (ROOT / "installer" / "OPUS-COPY.iss").read_text(encoding="utf-8")
        self.assertIn("install.ps1", content)
        self.assertIn("UninstallDisplayName=OPUS-COPY", content)
        self.assertIn("{app}\\app\\desktop\\run.ps1", content)


if __name__ == "__main__":
    unittest.main()
