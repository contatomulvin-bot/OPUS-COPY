from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image
from PySide6.QtCore import QBuffer, QIODevice
from PySide6.QtGui import QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ICON_SIZES = (16, 24, 32, 48, 64, 128, 256)


def create_icon(svg_path: Path, ico_path: Path) -> Path:
    renderer = QSvgRenderer(str(svg_path))
    if not renderer.isValid():
        raise RuntimeError(f"Logo SVG inválida: {svg_path}")

    canvas = QImage(1024, 1024, QImage.Format.Format_ARGB32)
    canvas.fill(0)
    painter = QPainter(canvas)
    try:
        renderer.render(painter)
    finally:
        painter.end()

    buffer = QBuffer()
    if not buffer.open(QIODevice.OpenModeFlag.WriteOnly):
        raise RuntimeError("Não foi possível criar o buffer PNG do ícone.")
    if not canvas.save(buffer, "PNG"):
        raise RuntimeError("Não foi possível renderizar a logo em PNG.")

    image = Image.open(io.BytesIO(bytes(buffer.data()))).convert("RGBA")
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(ico_path, format="ICO", sizes=[(size, size) for size in ICON_SIZES])
    if not ico_path.is_file() or ico_path.stat().st_size == 0:
        raise RuntimeError(f"O arquivo de ícone não foi criado: {ico_path}")
    return ico_path


def main() -> int:
    desktop_root = Path(__file__).resolve().parent
    svg_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else desktop_root / "assets" / "opus-copy-logo.svg"
    ico_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else desktop_root / "assets" / "opus-copy-logo.ico"
    print(f"Ícone criado: {create_icon(svg_path, ico_path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
