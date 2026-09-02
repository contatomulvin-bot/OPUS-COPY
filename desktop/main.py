from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from PySide6.QtCore import QObject, QThread, Qt, Signal, Slot
from PySide6.QtGui import QFont, QIcon
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

from opus_copy.pipeline import Pipeline  # noqa: E402
from opus_copy.tools import ToolError, probe_tool  # noqa: E402


APP_STYLE = """
QMainWindow, QWidget {
    background: #090909;
    color: #f3f3f3;
    font-family: "Segoe UI";
}

QFrame#shell {
    background: #0d0d0d;
    border: 1px solid #222222;
    border-radius: 22px;
}

QFrame#hero {
    background: #121212;
    border: 1px solid #242424;
    border-radius: 18px;
}

QFrame#inputCard, QFrame#resultCard {
    background: #101010;
    border: 1px solid #242424;
    border-radius: 16px;
}

QLabel#brand {
    color: #ffffff;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 2px;
}

QLabel#eyebrow {
    color: #777777;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2px;
}

QLabel#headline {
    color: #ffffff;
    font-size: 25px;
    font-weight: 700;
}

QLabel#subheadline {
    color: #9a9a9a;
    font-size: 13px;
}

QLabel#sectionTitle {
    color: #eeeeee;
    font-size: 15px;
    font-weight: 700;
}

QLabel#status {
    color: #8f8f8f;
    font-size: 12px;
}

QLabel#pill {
    background: #181818;
    border: 1px solid #292929;
    border-radius: 9px;
    padding: 5px 9px;
    color: #a9a9a9;
    font-size: 11px;
    font-weight: 600;
}

QLineEdit, QSpinBox {
    background: #080808;
    border: 1px solid #303030;
    border-radius: 11px;
    padding: 12px 13px;
    color: #f5f5f5;
    selection-background-color: #ffffff;
    selection-color: #000000;
}

QLineEdit:focus, QSpinBox:focus {
    border: 1px solid #686868;
}

QLineEdit::placeholder {
    color: #5f5f5f;
}

QPushButton#primary {
    background: #f2f2f2;
    color: #080808;
    border: none;
    border-radius: 11px;
    padding: 12px 18px;
    font-size: 12px;
    font-weight: 800;
}

QPushButton#primary:hover {
    background: #ffffff;
}

QPushButton#primary:pressed {
    background: #dddddd;
}

QPushButton#primary:disabled {
    background: #333333;
    color: #7a7a7a;
}

QListWidget {
    background: transparent;
    border: none;
    outline: none;
    padding: 4px;
    color: #d7d7d7;
}

QListWidget::item {
    background: #151515;
    border: 1px solid #252525;
    border-radius: 10px;
    margin: 4px 0;
    padding: 10px;
}

QListWidget::item:selected {
    background: #1d1d1d;
    border: 1px solid #3a3a3a;
}

QScrollBar:vertical {
    background: transparent;
    width: 8px;
}

QScrollBar::handle:vertical {
    background: #313131;
    border-radius: 4px;
    min-height: 28px;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0;
}
"""


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


def make_logo(path: Path) -> QLabel:
    logo = QLabel()
    logo.setFixedSize(50, 50)
    logo.setPixmap(QIcon(str(path)).pixmap(46, 46))
    logo.setAlignment(Qt.AlignCenter)
    return logo


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("OPUS-COPY")
        self.setMinimumSize(980, 700)
        self.resize(1080, 760)
        self.setStyleSheet(APP_STYLE)
        self.setWindowIcon(QIcon(str(ROOT / "assets" / "opus-copy-logo.svg")))
        self.thread: QThread | None = None
        self.worker: Worker | None = None

        outer = QWidget()
        outer_layout = QVBoxLayout(outer)
        outer_layout.setContentsMargins(24, 24, 24, 24)
        outer_layout.setSpacing(0)

        shell = QFrame()
        shell.setObjectName("shell")
        shell_layout = QVBoxLayout(shell)
        shell_layout.setContentsMargins(28, 26, 28, 28)
        shell_layout.setSpacing(18)

        header = QHBoxLayout()
        header.setSpacing(12)
        header.addWidget(make_logo(ROOT / "assets" / "opus-copy-logo.svg"))
        brand_box = QVBoxLayout()
        brand_box.setSpacing(2)
        brand = QLabel("OPUS-COPY")
        brand.setObjectName("brand")
        eyebrow = QLabel("AI VIDEO CLIPPER")
        eyebrow.setObjectName("eyebrow")
        brand_box.addWidget(brand)
        brand_box.addWidget(eyebrow)
        header.addLayout(brand_box)
        header.addStretch(1)
        engine = QLabel("WHISPERX  •  GEMINI  •  FFMPEG")
        engine.setObjectName("pill")
        header.addWidget(engine, 0, Qt.AlignTop)
        shell_layout.addLayout(header)

        hero = QFrame()
        hero.setObjectName("hero")
        hero_layout = QVBoxLayout(hero)
        hero_layout.setContentsMargins(22, 20, 22, 20)
        hero_layout.setSpacing(6)
        headline = QLabel("Transforme vídeos longos em clips que prendem atenção.")
        headline.setObjectName("headline")
        subtitle = QLabel(
            "Cole um vídeo do YouTube, deixe a IA encontrar os melhores momentos e gere cortes verticais prontos para postar."
        )
        subtitle.setObjectName("subheadline")
        subtitle.setWordWrap(True)
        hero_layout.addWidget(headline)
        hero_layout.addWidget(subtitle)
        shell_layout.addWidget(hero)

        input_card = QFrame()
        input_card.setObjectName("inputCard")
        input_layout = QVBoxLayout(input_card)
        input_layout.setContentsMargins(18, 16, 18, 16)
        input_layout.setSpacing(12)

        section = QLabel("FONTE DO VÍDEO")
        section.setObjectName("eyebrow")
        input_layout.addWidget(section)

        self.url = QLineEdit()
        self.url.setPlaceholderText("Cole aqui a URL do YouTube…")
        self.url.setMinimumHeight(44)
        self.url.returnPressed.connect(self.start_pipeline)
        input_layout.addWidget(self.url)

        controls = QHBoxLayout()
        controls.setSpacing(10)
        count_label = QLabel("CLIPS")
        count_label.setObjectName("pill")
        controls.addWidget(count_label)
        self.count = QSpinBox()
        self.count.setRange(1, 20)
        self.count.setValue(5)
        self.count.setMinimumWidth(78)
        self.count.setMinimumHeight(44)
        controls.addWidget(self.count)
        controls.addStretch(1)
        self.start = QPushButton("ANALISAR E GERAR CLIPS  ›")
        self.start.setObjectName("primary")
        self.start.setMinimumHeight(44)
        self.start.clicked.connect(self.start_pipeline)
        controls.addWidget(self.start)
        input_layout.addLayout(controls)
        shell_layout.addWidget(input_card)

        result_card = QFrame()
        result_card.setObjectName("resultCard")
        result_layout = QVBoxLayout(result_card)
        result_layout.setContentsMargins(18, 16, 18, 16)
        result_layout.setSpacing(10)

        result_header = QHBoxLayout()
        result_title = QLabel("RESULTADOS")
        result_title.setObjectName("sectionTitle")
        result_header.addWidget(result_title)
        result_header.addStretch(1)
        self.status = QLabel("Pronto para processar.")
        self.status.setObjectName("status")
        self.status.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        result_header.addWidget(self.status)
        result_layout.addLayout(result_header)

        self.results = QListWidget()
        result_layout.addWidget(self.results, 1)
        shell_layout.addWidget(result_card, 1)

        footer = QLabel("OPUS-COPY  /  local-first workflow")
        footer.setObjectName("status")
        footer.setAlignment(Qt.AlignCenter)
        shell_layout.addWidget(footer)

        outer_layout.addWidget(shell, 1)
        self.setCentralWidget(outer)

    def start_pipeline(self) -> None:
        url = self.url.text().strip()
        if not url:
            QMessageBox.warning(self, "OPUS-COPY", "Cole uma URL do YouTube.")
            return
        self.start.setEnabled(False)
        self.results.clear()
        self.status.setText("Preparando análise…")
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
        self.status.setText(f"Concluído · {len(outputs)} clip(s) gerado(s).")
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
    app.setApplicationName("OPUS-COPY")
    app.setFont(QFont("Segoe UI", 10))
    try:
        yt = probe_tool("yt-dlp")
        ffmpeg = probe_tool("ffmpeg", "-version")
    except ToolError as exc:
        QMessageBox.critical(None, "OPUS-COPY — dependência ausente", str(exc))
        return 1
    window = MainWindow()
    window.status.setText(f"Pronto · {yt}  |  {ffmpeg}")
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
