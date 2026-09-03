from __future__ import annotations

import json
import sys
from pathlib import Path

from PySide6.QtCore import QBoxLayout, QTimer
from PySide6.QtWidgets import QLabel

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import main as app_main  # noqa: E402
import apple_ui  # noqa: E402


def _metadata_for(filename: str) -> dict | None:
    path = ROOT / "workspace" / "analysis" / "clip_metadata.json"
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
        return next((item for item in items if item.get("output") == filename), None)
    except (OSError, ValueError, TypeError):
        return None


class AnalyticsVideoCard(app_main.VideoCard):
    """Video card with transparent AI/editorial analytics."""

    def __init__(self, path: Path, parent=None) -> None:
        super().__init__(path, parent)
        metadata = _metadata_for(path.name)
        if not metadata:
            return
        stats = metadata.get("statistics") or {}
        score = float(metadata.get("score", 0) or 0)
        category = str(metadata.get("category", "OTHER"))
        duration = stats.get("duration_label", "--:--")
        wpm = stats.get("words_per_minute", 0)
        density = stats.get("speech_density", 0)
        keywords = ", ".join(metadata.get("keywords") or [])
        box = QLabel()
        box.setWordWrap(True)
        box.setStyleSheet("QLabel { background:#111115; border:1px solid #292930; border-radius:14px; padding:11px; color:#d7d7dc; }")
        box.setText(
            f"<b>POTENCIAL DE AUDIÊNCIA · {score:.0f}/100</b>  ·  {category}<br>"
            f"Duração <b>{duration}</b>  ·  Ritmo <b>{wpm:.0f} palavras/min</b>  ·  Densidade <b>{density:.0f}%</b><br>"
            f"<span style='color:#9898a3'>Palavras-chave:</span> {keywords or '—'}"
        )
        self.layout().addWidget(box)
        breakdown = stats.get("score_breakdown") or metadata.get("scores") or {}
        if breakdown:
            detail = QLabel("  ·  ".join(f"{str(k).title()}: {float(v):.0f}" for k, v in breakdown.items()))
            detail.setObjectName("muted")
            detail.setWordWrap(True)
            self.layout().addWidget(detail)


class ResponsiveMainWindow(app_main.MainWindow):
    """Responsive Apple-like shell with fluid sizing and animated clip cards."""

    BREAKPOINT = 1050
    COMPACT_BREAKPOINT = 820

    def __init__(self) -> None:
        super().__init__()
        apple_ui.install(self)
        self._last_responsive_state: tuple[bool, bool] | None = None
        self._apply_responsive_layout()
        QTimer.singleShot(120, lambda: apple_ui.animate_cards(self))

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._apply_responsive_layout()

    def refresh_videos(self) -> None:
        super().refresh_videos()
        QTimer.singleShot(40, lambda: apple_ui.animate_cards(self))

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
            main_split.setDirection(QBoxLayout.Direction.TopToBottom if stacked else QBoxLayout.Direction.LeftToRight)
            main_split.setSpacing(9 if compact else 12)
        preview = getattr(self, "subtitle_preview", None)
        if preview is not None:
            if stacked:
                preview.setMinimumSize(0, 0)
                preview.setMinimumHeight(380 if not compact else 300)
                preview.setMaximumHeight(510 if not compact else 410)
            else:
                preview.setMinimumSize(250, 0)
                preview.setMaximumHeight(16777215)
        creation_layout = creation.layout() if creation is not None else None
        if creation_layout is not None:
            margin = 9 if compact else 14
            creation_layout.setContentsMargins(margin, margin, margin, margin)
        self._resize_video_cards(width)

    def _resize_video_cards(self, width: int) -> None:
        for card in getattr(self, "video_cards", []):
            video = getattr(card, "video", None)
            if video is None:
                continue
            card_width = max(280, card.width() - 32)
            target_height = max(220, min(410, int(card_width * 9 / 16)))
            video.setMinimumHeight(target_height)
            video.setMaximumHeight(target_height)


app_main.VideoCard = AnalyticsVideoCard
app_main.MainWindow = ResponsiveMainWindow

if __name__ == "__main__":
    raise SystemExit(app_main.main())
