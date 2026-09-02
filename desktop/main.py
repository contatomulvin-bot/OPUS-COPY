from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from PySide6.QtCore import QObject, QThread, Signal, Slot
from PySide6.QtWidgets import (
    QApplication, QHBoxLayout, QLabel, QLineEdit, QListWidget, QMainWindow,
    QMessageBox, QPushButton, QSpinBox, QVBoxLayout, QWidget,
)

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

from opus_copy.pipeline import Pipeline  # noqa: E402
from opus_copy.tools import ToolError, probe_tool  # noqa: E402


class Worker(QObject):
    progress = Signal(str)
    finished = Signal(list)
    failed = Signal(str)

    def __init__(self, url: str, max_clips: int) -> None:
        super().__init__()
        self.url = url
        self.max_clips = max_clips

    @Slot()
    def run(self) -> None:
        try:
            workspace = ROOT / "workspace"
            outputs = Pipeline(workspace).run(self.url, self.max_clips, self.progress.emit)
            self.finished.emit([str(p) for p in outputs])
        except Exception as exc:
            self.failed.emit(f"{exc}\n\n{traceback_text(exc)}")


def traceback_text(exc: Exception) -> str:
    import traceback
    return traceback.format_exc()


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("OPUS-COPY Desktop")
        self.resize(920, 620)
        self.thread: QThread | None = None
        self.worker: Worker | None = None

        root = QWidget()
        layout = QVBoxLayout(root)
        title = QLabel("OPUS-COPY")
        title.setStyleSheet("font-size: 28px; font-weight: 700;")
        subtitle = QLabel("Cole um vídeo longo. A IA encontra os melhores momentos e gera clips 9:16.")
        layout.addWidget(title)
        layout.addWidget(subtitle)

        self.url = QLineEdit()
        self.url.setPlaceholderText("URL do YouTube")
        layout.addWidget(self.url)

        row = QHBoxLayout()
        row.addWidget(QLabel("Quantidade de clips:"))
        self.count = QSpinBox()
        self.count.setRange(1, 20)
        self.count.setValue(5)
        row.addWidget(self.count)
        self.start = QPushButton("ANALISAR E GERAR CLIPS")
        self.start.clicked.connect(self.start_pipeline)
        row.addWidget(self.start)
        layout.addLayout(row)

        self.status = QLabel("Pronto.")
        self.status.setWordWrap(True)
        layout.addWidget(self.status)

        self.results = QListWidget()
        layout.addWidget(self.results, 1)
        self.setCentralWidget(root)

    def start_pipeline(self) -> None:
        url = self.url.text().strip()
        if not url:
            QMessageBox.warning(self, "OPUS-COPY", "Cole uma URL do YouTube.")
            return
        self.start.setEnabled(False)
        self.results.clear()
        self.status.setText("Iniciando…")
        self.thread = QThread()
        self.worker = Worker(url, self.count.value())
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self.status.setText)
        self.worker.finished.connect(self.completed)
        self.worker.failed.connect(self.failed)
        self.worker.finished.connect(self.thread.quit)
        self.worker.failed.connect(self.thread.quit)
        self.thread.finished.connect(self.thread.deleteLater)
        self.thread.start()

    @Slot(list)
    def completed(self, outputs: list) -> None:
        self.start.setEnabled(True)
        self.status.setText(f"Concluído: {len(outputs)} clip(s) gerado(s).")
        self.results.addItems(outputs)

    @Slot(str)
    def failed(self, message: str) -> None:
        self.start.setEnabled(True)
        self.status.setText("Falha no processamento.")
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Critical)
        box.setWindowTitle("OPUS-COPY — erro")
        box.setText("O processamento falhou.")
        box.setDetailedText(message)
        copy_button = box.addButton("Copiar erro completo", QMessageBox.ActionRole)
        box.addButton(QMessageBox.Close)
        box.exec()
        if box.clickedButton() is copy_button:
            QApplication.clipboard().setText(message)


def main() -> int:
    app = QApplication(sys.argv)
    try:
        yt = probe_tool("yt-dlp")
        ffmpeg = probe_tool("ffmpeg", "-version")
    except ToolError as exc:
        QMessageBox.critical(None, "OPUS-COPY — dependência ausente", str(exc))
        return 1
    window = MainWindow()
    window.status.setText(f"Pronto. {yt} | {ffmpeg}")
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
