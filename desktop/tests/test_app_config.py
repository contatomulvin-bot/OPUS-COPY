import unittest
from pathlib import Path

from opus_copy.app_config import (
    APP_ID,
    APP_NAME,
    asset_path,
    configure_windows_app_id,
    icon_path,
)


class AppConfigTests(unittest.TestCase):
    def test_branding_constants_are_stable(self):
        self.assertEqual(APP_NAME, "OPUS-COPY")
        self.assertEqual(APP_ID, "Mulvin.OPUSCopy.Desktop")

    def test_logo_asset_exists(self):
        self.assertTrue(asset_path("opus-copy-logo.svg").is_file())
        self.assertIn(icon_path().suffix.lower(), {".ico", ".svg"})
        self.assertTrue(icon_path().is_file())

    def test_non_windows_app_id_is_a_safe_noop(self):
        result = configure_windows_app_id()
        self.assertIsInstance(result, bool)

    def test_asset_path_does_not_escape_assets_directory(self):
        path = asset_path("opus-copy-logo.svg")
        self.assertEqual(path.parent.name, "assets")
        self.assertIsInstance(path, Path)


if __name__ == "__main__":
    unittest.main()
