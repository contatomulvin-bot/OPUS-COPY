from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

APP_ID = "Mulvin.OPUSCopy.Desktop"
APP_NAME = "OPUS-COPY"


def resource_root() -> Path:
    """Return the desktop resource directory in source and PyInstaller builds."""
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        return Path(bundled)
    return Path(__file__).resolve().parents[1]


def asset_path(filename: str) -> Path:
    return resource_root() / "assets" / filename


def icon_path() -> Path:
    """Prefer ICO on Windows, while keeping SVG as a development fallback."""
    ico = asset_path("opus-copy-logo.ico")
    return ico if ico.is_file() else asset_path("opus-copy-logo.svg")


def configure_windows_app_id() -> bool:
    """Make Windows group the taskbar icon under the OPUS-COPY identity."""
    if os.name != "nt":
        return False
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        return False
    return True
