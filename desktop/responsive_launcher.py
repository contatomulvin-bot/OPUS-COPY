from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QBoxLayout

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import main as app_main  # noqa: E402


class ResponsiveMainWindow(app_main.MainWindow):
    """Responsive shell around the existing UI.

    Keeps the original design intact while changing layout direction and
    media sizes at runtime instead of relying on a fixed window resolution.
    """

    BREAKPOINT = 1050
    COMPACT_BREAKPOINT = 820

    def __init__(self) -> None:
        super().__init__()
        self._last_responsive_state: tuple[bool, bool] | None = None
        self._apply_responsive_layout()

    def resizeEvent(self, event: QEvent) -> None:
        super().resizeEvent(event)
        self._apply_responsive_layout()

    def _apply_responsive_layout(self) -> None:
        if not hasattr(self, "tabs") or self.tabs.count() == 0:
            return

        width = self.centralWidget().width()
        stacked = width < self.BREAKPOINT
        compact = width < self.COMPACT_BREAKPOINT
        state = (stacked, compact)
        if state == self._last_responsive_state:
            self._resize_video_cards(width)
            return
        self._last_responsive_state = state

        creation = self.tabs.widget(0)
        main_split = None
        if creation is not None and creation.layout() is not None:
            item = creation.layout().itemAt(1)
            if item is not None:
                main_split = item.layout()

        if isinstance(main_split, QBoxLayout):
            main_split.setDirection(
                QBoxLayout.Direction.TopToBottom
                if stacked
                else QBoxLayout.Direction.LeftToRight
            )
            main_split.setSpacing(10 if compact else 12)

        preview = getattr(self, "subtitle_preview", None)
        if preview is not None:
            if stacked:
                # Keep the preview visually proportional instead of allowing
                # the old 270x480 minimum to force horizontal overflow.
                preview.setMinimumSize(0, 0)
                preview.setMinimumHeight(390 if not compact else 320)
                preview.setMaximumHeight(520 if not compact else 430)
            else:
                preview.setMinimumSize(250, 0)
                preview.setMaximumHeight(16777215)

        # The controls need a little more vertical breathing room on compact
        # windows; on wide windows the original spacing remains unchanged.
        creation_layout = creation.layout() if creation is not None else None
        if creation_layout is not None:
            creation_layout.setContentsMargins(10 if compact else 14, 10 if compact else 14, 10 if compact else 14, 10 if compact else 14)

        self._resize_video_cards(width)

    def _resize_video_cards(self, width: int) -> None:
        """Maintain a 16:9-ish player height as cards change width."""
        for card in getattr(self, "video_cards", []):
            video = getattr(card, "video", None)
            if video is None:
                continue
            card_width = max(280, card.width() - 32)
            target_height = max(220, min(410, int(card_width * 9 / 16)))
            video.setMinimumHeight(target_height)
            video.setMaximumHeight(target_height)


# main.main() resolves MainWindow from the imported module at runtime.
app_main.MainWindow = ResponsiveMainWindow


if __name__ == "__main__":
    raise SystemExit(app_main.main())
