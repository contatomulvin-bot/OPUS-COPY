import os
import unittest

if os.name != "nt":
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

try:
    from PySide6.QtGui import QIcon
    from PySide6.QtWidgets import QApplication
except ImportError:
    QApplication = None
    QIcon = None

if QApplication is not None:
    import responsive_launcher
    from opus_copy.app_config import APP_NAME, icon_path


@unittest.skipIf(QApplication is None, "PySide6 não está instalado")
class DesktopSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
        cls.app.setWindowIcon(QIcon(str(icon_path())))

    def test_responsive_window_opens_with_branding(self):
        window = responsive_launcher.ResponsiveMainWindow()
        try:
            window.show()
            self.app.processEvents()
            self.assertEqual(window.windowTitle(), APP_NAME)
            self.assertFalse(window.windowIcon().isNull())
            self.assertEqual(window.tabs.count(), 2)
            self.assertIsNotNone(window.subtitle_preview)
        finally:
            window.close()
            self.app.processEvents()


if __name__ == "__main__":
    unittest.main()
