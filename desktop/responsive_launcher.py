from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from PySide6.QtCore import QBoxLayout, QTimer, Qt
from PySide6.QtWidgets import QFileDialog, QFrame, QGridLayout, QHBoxLayout, QLabel, QMessageBox, QProgressBar, QPushButton, QVBoxLayout

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import main as app_main  # noqa: E402
import apple_ui  # noqa: E402


def _metadata_for(filename: str) -> dict | None:
    analysis_dir = app_main.WORKSPACE_ROOT / "analysis"
    try:
        current_run = json.loads((analysis_dir / "current_run.json").read_text(encoding="utf-8"))
        if current_run.get("status") != "completed":
            return None
        metadata_name = current_run.get("metadata")
        if not metadata_name:
            return None
        items = json.loads((analysis_dir / str(metadata_name)).read_text(encoding="utf-8"))
        return next((item for item in items if item.get("output") == filename and item.get("run_id") == current_run.get("run_id")), None)
    except (OSError, ValueError, TypeError):
        return None


class AnalyticsVideoCard(app_main.VideoCard):
    """Professional clip card: preview first, AI potential below, export last."""

    def __init__(self, path: Path, parent=None) -> None:
        super().__init__(path, parent)
        self.metadata = _metadata_for(path.name) or {}
        self._reorganize_card()

    def _reorganize_card(self) -> None:
        layout = self.layout()
        if layout is None:
            return

        original_row = None
        for i in range(layout.count()):
            item = layout.itemAt(i)
            row = item.layout()
            if isinstance(row, QHBoxLayout):
                texts = []
                for j in range(row.count()):
                    widget = row.itemAt(j).widget()
                    if widget is not None:
                        texts.append(widget.text())
                if any("REPRODUZIR" in text for text in texts):
                    original_row = row
                    break
        if original_row is not None:
            while original_row.count():
                item = original_row.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
            layout.removeItem(original_row)

        stats = self.metadata.get("statistics") or {}
        score = max(0.0, min(100.0, float(self.metadata.get("score", stats.get("viral_potential", 0)) or 0)))
        category = str(self.metadata.get("category", "OTHER")).replace("_", " ").title()
        duration = str(stats.get("duration_label", "--:--"))
        wpm = float(stats.get("words_per_minute", 0) or 0)
        density = float(stats.get("speech_density", 0) or 0)
        breakdown = stats.get("score_breakdown") or self.metadata.get("scores") or {}

        panel = QFrame()
        panel.setObjectName("viralPanel")
        panel.setStyleSheet("QFrame#viralPanel { background:#121216; border:1px solid #29292f; border-radius:16px; }")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(14, 13, 14, 13)
        panel_layout.setSpacing(9)

        heading = QHBoxLayout()
        title = QLabel("POTENCIAL DE VIRALIZAÇÃO")
        title.setStyleSheet("font-size:11px; font-weight:700; letter-spacing:1.2px; color:#9b9ba4;")
        heading.addWidget(title)
        heading.addStretch(1)
        badge = QLabel(self._score_label(score))
        badge.setStyleSheet("font-size:11px; font-weight:700; color:#f5f5f7; background:#25252b; border:1px solid #38383f; border-radius:9px; padding:4px 8px;")
        heading.addWidget(badge)
        panel_layout.addLayout(heading)

        score_row = QHBoxLayout()
        score_value = QLabel(f"{score:.0f}<span style='font-size:13px; color:#888891'>/100</span>")
        score_value.setTextFormat(Qt.TextFormat.RichText)
        score_value.setStyleSheet("font-size:27px; font-weight:750; color:#f5f5f7;")
        score_row.addWidget(score_value)
        score_bar = QProgressBar()
        score_bar.setRange(0, 100)
        score_bar.setValue(round(score))
        score_bar.setTextVisible(False)
        score_bar.setFixedHeight(8)
        score_bar.setStyleSheet("QProgressBar { background:#24242a; border:none; border-radius:4px; } QProgressBar::chunk { background:#f5f5f7; border-radius:4px; }")
        score_row.addWidget(score_bar, 1)
        panel_layout.addLayout(score_row)

        metrics = QGridLayout()
        metrics.setHorizontalSpacing(8)
        metrics.setVerticalSpacing(7)
        metric_values = [
            ("DURAÇÃO", duration),
            ("RITMO", f"{wpm:.0f} wpm"),
            ("DENSIDADE", f"{density:.0f}%"),
            ("CATEGORIA", category),
        ]
        for index, (label, value) in enumerate(metric_values):
            cell = QFrame()
            cell.setStyleSheet("QFrame { background:#19191e; border:1px solid #26262d; border-radius:10px; }")
            cell_layout = QVBoxLayout(cell)
            cell_layout.setContentsMargins(9, 7, 9, 7)
            cell_layout.setSpacing(1)
            lab = QLabel(label)
            lab.setStyleSheet("font-size:9px; font-weight:700; color:#777780;")
            val = QLabel(value)
            val.setStyleSheet("font-size:12px; font-weight:650; color:#e5e5e9;")
            val.setWordWrap(True)
            cell_layout.addWidget(lab)
            cell_layout.addWidget(val)
            metrics.addWidget(cell, index // 2, index % 2)
        panel_layout.addLayout(metrics)

        if breakdown:
            detail = QLabel("  ·  ".join(f"{str(k).replace('_', ' ').title()}: {float(v):.0f}" for k, v in breakdown.items()))
            detail.setWordWrap(True)
            detail.setStyleSheet("font-size:10px; color:#777780;")
            panel_layout.addWidget(detail)

        keywords = ", ".join(self.metadata.get("keywords") or [])
        if keywords:
            kw = QLabel(f"Palavras-chave  ·  {keywords}")
            kw.setWordWrap(True)
            kw.setStyleSheet("font-size:10px; color:#85858e;")
            panel_layout.addWidget(kw)

        layout.addWidget(panel)

        actions = QHBoxLayout()
        actions.setSpacing(8)
        play = QPushButton("▶  REPRODUZIR")
        play.clicked.connect(self.toggle)
        actions.addWidget(play, 1)
        open_file = QPushButton("ABRIR")
        open_file.clicked.connect(self.open_file)
        actions.addWidget(open_file)
        export = QPushButton("EXPORTAR CLIP")
        export.setObjectName("primary")
        export.clicked.connect(self.export_clip)
        actions.addWidget(export, 1)
        layout.addLayout(actions)

    @staticmethod
    def _score_label(score: float) -> str:
        if score >= 80:
            return "ALTO POTENCIAL"
        if score >= 60:
            return "BOM POTENCIAL"
        if score >= 40:
            return "MÉDIO POTENCIAL"
        return "BAIXO POTENCIAL"

    def export_clip(self) -> None:
        if not self.path.is_file():
            QMessageBox.warning(self, "Exportação", "O arquivo deste clip não foi encontrado.")
            return
        destination, _ = QFileDialog.getSaveFileName(
            self,
            "Exportar clip",
            str(Path.home() / "Downloads" / self.path.name),
            "Vídeo MP4 (*.mp4)",
        )
        if not destination:
            return
        try:
            target = Path(destination)
            if target.suffix.lower() != ".mp4":
                target = target.with_suffix(".mp4")
            if target.resolve() != self.path.resolve():
                shutil.copy2(self.path, target)
            QMessageBox.information(self, "Exportação concluída", f"Clip exportado com sucesso:\n\n{target}")
        except OSError as exc:
            QMessageBox.critical(self, "Falha na exportação", f"Não foi possível exportar o clip.\n\n{exc}")


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
        """Show only outputs explicitly recorded by the latest completed generation."""
        if not hasattr(self, "video_grid"):
            return

        while self.video_grid.count():
            item = self.video_grid.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        self.video_cards.clear()

        manifest_path = app_main.WORKSPACE_ROOT / "analysis" / "current_run.json"
        current_outputs: list[str] = []
        manifest_status = "missing"
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest_status = str(manifest.get("status", "missing"))
            if manifest_status == "completed":
                current_outputs = [str(name) for name in manifest.get("outputs", []) if name]
        except (OSError, ValueError, TypeError):
            pass

        # Never fall back to all MP4s: that is what caused clips from previous videos
        # to appear when the current generation was still running or failed.
        if manifest_status != "completed" or not current_outputs:
            empty = QLabel(
                "Nenhum clip da última geração.\n"
                "Gere uma nova análise e os clips aparecerão aqui automaticamente."
            )
            empty.setObjectName("muted")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.video_grid.addWidget(empty, 0, 0)
            return

        files = [self.output_dir / name for name in current_outputs if (self.output_dir / name).is_file()]
        if not files:
            empty = QLabel("A última geração foi concluída, mas nenhum arquivo de clip está disponível.")
            empty.setObjectName("muted")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.video_grid.addWidget(empty, 0, 0)
            return

        files.sort(key=lambda p: current_outputs.index(p.name))
        columns = 2 if len(files) > 1 else 1
        for index, path in enumerate(files):
            card = AnalyticsVideoCard(path)
            self.video_cards.append(card)
            self.video_grid.addWidget(card, index // columns, index % columns)
        for col in range(columns):
            self.video_grid.setColumnStretch(col, 1)
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
