from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

from dotenv import load_dotenv
from PySide6.QtCore import QObject, QThread, Qt, QUrl, Signal, Slot
from PySide6.QtGui import QColor, QFont, QIcon, QPainter, QPen
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QColorDialog,
    QComboBox,
    QFileDialog,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

from opus_copy.pipeline import Pipeline  # noqa: E402
from opus_copy.renderer import SubtitleStyle  # noqa: E402
from opus_copy.tools import ToolError, probe_tool  # noqa: E402

APP_STYLE = """
QMainWindow, QWidget { background:#090909; color:#f3f3f3; font-family:"Segoe UI"; }
QFrame#card { background:#101010; border:1px solid #242424; border-radius:18px; }
QLabel#brand { color:#fff; font-size:29px; font-weight:800; letter-spacing:2px; }
QLabel#eyebrow { color:#777; font-size:10px; font-weight:800; letter-spacing:2px; }
QLabel#headline { color:#fff; font-size:23px; font-weight:700; }
QLabel#muted { color:#929292; font-size:12px; }
QLabel#value { color:#ddd; font-size:12px; font-weight:700; }
QLineEdit, QSpinBox, QComboBox { background:#080808; border:1px solid #303030; border-radius:10px; padding:10px 12px; color:#f5f5f5; min-height:20px; }
QLineEdit:focus, QSpinBox:focus, QComboBox:focus { border:1px solid #686868; }
QPushButton { background:#171717; color:#eee; border:1px solid #2b2b2b; border-radius:10px; padding:10px 14px; font-weight:700; }
QPushButton:hover { background:#212121; }
QPushButton#primary { background:#f2f2f2; color:#080808; border:none; font-size:12px; font-weight:800; }
QPushButton#primary:disabled { background:#333; color:#777; }
QPushButton#colorButton { min-width:86px; }
QCheckBox { spacing:8px; }
QGroupBox { border:1px solid #252525; border-radius:12px; margin-top:12px; padding:14px 10px 10px 10px; font-weight:800; color:#eee; }
QGroupBox::title { subcontrol-origin:margin; left:12px; padding:0 7px; background:#101010; color:#aaa; }
QTabWidget::pane { border:1px solid #242424; border-radius:14px; top:-1px; background:#101010; }
QTabBar::tab { background:#141414; color:#878787; border:1px solid #242424; padding:11px 22px; margin-right:6px; border-radius:10px 10px 0 0; font-weight:800; }
QTabBar::tab:selected { background:#242424; color:#fff; }
QScrollArea { border:none; background:transparent; }
QVideoWidget { background:#050505; border:1px solid #292929; border-radius:12px; }
QScrollBar:vertical { background:transparent; width:8px; }
QScrollBar::handle:vertical { background:#313131; border-radius:4px; min-height:28px; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height:0; }
"""


class Worker(QObject):
    progress = Signal(str)
    finished = Signal(list)
    failed = Signal(str)

    def __init__(self, url: str, max_clips: int, output_dir: Path, subtitle_style: SubtitleStyle) -> None:
        super().__init__()
        self.url = url
        self.max_clips = max_clips
        self.output_dir = output_dir
        self.subtitle_style = subtitle_style

    @Slot()
    def run(self) -> None:
        try:
            outputs = Pipeline(ROOT / "workspace").run(
                self.url,
                self.max_clips,
                self.progress.emit,
                output_dir=self.output_dir,
                subtitle_style=self.subtitle_style,
            )
            self.finished.emit([str(p) for p in outputs])
        except Exception as exc:
            self.failed.emit(f"{exc}\n\n{traceback.format_exc()}")


class SubtitlePreview(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setMinimumSize(270, 480)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.font_family = "Arial"
        self.font_size = 64
        self.bold = True
        self.text_color = "#FFFFFF"
        self.outline_color = "#000000"
        self.background_color = "#000000"
        self.background_opacity = 0
        self.outline_width = 4
        self.shadow = 2
        self.vertical_position = 82

    def set_style(self, style: SubtitleStyle) -> None:
        self.font_family = style.font_family
        self.font_size = style.font_size
        self.bold = style.bold
        self.text_color = style.text_color
        self.outline_color = style.outline_color
        self.background_color = style.background_color
        self.background_opacity = style.background_opacity
        self.outline_width = style.outline_width
        self.shadow = style.shadow
        self.vertical_position = style.vertical_position
        self.update()

    def paintEvent(self, event) -> None:
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing)

        # Simulated vertical video frame so the user can judge position and contrast.
        rect = self.rect().adjusted(8, 8, -8, -8)
        painter.fillRect(rect, QColor("#050505"))
        center_x = rect.center().x()
        for i, tone in enumerate((16, 22, 29, 36)):
            band = rect.adjusted(0, int(rect.height() * i / 4), 0, -int(rect.height() * (3 - i) / 4))
            painter.fillRect(band, QColor(tone, tone, tone))

        # Simple focal subject silhouette.
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor("#101010"))
        painter.drawEllipse(center_x - 58, rect.top() + 150, 116, 116)
        painter.drawRoundedRect(center_x - 105, rect.top() + 250, 210, 300, 70, 70)

        text = "ESSA É A\nSUA LEGENDA"
        font = QFont(self.font_family, max(10, int(self.font_size * rect.width() / 1080)))
        font.setBold(self.bold)
        painter.setFont(font)

        metrics = painter.fontMetrics()
        lines = text.splitlines()
        line_h = metrics.lineSpacing()
        total_h = line_h * len(lines)
        y_center = rect.top() + rect.height() * (self.vertical_position / 100.0)
        top = int(y_center - total_h / 2)
        max_width = max(metrics.horizontalAdvance(line) for line in lines)
        x = int(center_x - max_width / 2)

        # Preview background, respecting opacity.
        if self.background_opacity > 0:
            bg = QColor(self.background_color)
            bg.setAlpha(int(255 * self.background_opacity / 100))
            bg_rect = rect.adjusted(max(0, x - 26), max(0, top - 14), min(0, -x), min(0, -(top + total_h)) if top + total_h < rect.bottom() else 0)
            # Use a deliberately generous block around the text.
            left = max(rect.left() + 12, x - 26)
            right = min(rect.right() - 12, x + max_width + 26)
            top_bg = max(rect.top() + 8, top - 14)
            bottom_bg = min(rect.bottom() - 8, top + total_h + 14)
            painter.fillRect(left, top_bg, max(1, right - left), max(1, bottom_bg - top_bg), bg)
            del bg_rect

        text_color = QColor(self.text_color)
        outline_color = QColor(self.outline_color)
        pen = QPen(text_color)
        pen.setWidth(1)
        painter.setPen(pen)

        for index, line in enumerate(lines):
            baseline = top + (index + 1) * line_h - metrics.descent()
            line_width = metrics.horizontalAdvance(line)
            line_x = int(center_x - line_width / 2)

            if self.shadow > 0:
                shadow_pen = QPen(QColor(0, 0, 0, 190))
                painter.setPen(shadow_pen)
                for dx, dy in ((self.shadow, self.shadow), (-self.shadow, self.shadow)):
                    painter.drawText(line_x + dx, baseline + dy, line)

            if self.outline_width > 0:
                outline_pen = QPen(outline_color)
                outline_pen.setWidth(max(1, self.outline_width))
                painter.setPen(outline_pen)
                painter.drawText(line_x, baseline, line)

            painter.setPen(pen)
            painter.drawText(line_x, baseline, line)

        painter.setPen(QColor("#656565"))
        painter.setFont(QFont("Segoe UI", 9))
        painter.drawText(rect.left() + 12, rect.bottom() - 12, f"POSIÇÃO {self.vertical_position}%")


class VideoCard(QFrame):
    def __init__(self, path: Path, parent=None) -> None:
        super().__init__(parent)
        self.path = path
        self.setObjectName("card")
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(9)

        title_row = QHBoxLayout()
        title = QLabel(path.name)
        title.setObjectName("value")
        title.setWordWrap(True)
        title_row.addWidget(title, 1)
        title_row.addWidget(QLabel("MP4"), 0, Qt.AlignTop)
        layout.addLayout(title_row)

        self.player = QMediaPlayer(self)
        self.audio = QAudioOutput(self)
        self.player.setAudioOutput(self.audio)
        self.video = QVideoWidget()
        self.video.setAspectRatioMode(Qt.KeepAspectRatio)
        self.video.setMinimumHeight(470)
        self.video.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.player.setVideoOutput(self.video)
        layout.addWidget(self.video)

        controls = QHBoxLayout()
        play = QPushButton("▶ REPRODUZIR / PAUSAR")
        play.clicked.connect(self.toggle)
        controls.addWidget(play)
        open_file = QPushButton("ABRIR VÍDEO")
        open_file.clicked.connect(self.open_file)
        controls.addWidget(open_file)
        open_folder = QPushButton("ABRIR PASTA")
        open_folder.clicked.connect(lambda: os.startfile(str(path.parent)))
        controls.addWidget(open_folder)
        layout.addLayout(controls)

    def showEvent(self, event) -> None:
        super().showEvent(event)
        if self.path.is_file() and self.player.source().isEmpty():
            self.player.setSource(QUrl.fromLocalFile(str(self.path)))

    def toggle(self) -> None:
        state = self.player.playbackState()
        if state == QMediaPlayer.PlaybackState.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def open_file(self) -> None:
        if self.path.is_file():
            os.startfile(str(self.path))


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("OPUS-COPY")
        self.setMinimumSize(1100, 780)
        self.resize(1240, 860)
        self.setStyleSheet(APP_STYLE)
        self.setWindowIcon(QIcon(str(ROOT / "assets" / "opus-copy-logo.svg")))
        self.thread: QThread | None = None
        self.worker: Worker | None = None
        self.output_dir = ROOT / "workspace" / "clips"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.video_cards: list[VideoCard] = []

        root = QWidget()
        root_layout = QVBoxLayout(root)
        root_layout.setContentsMargins(24, 22, 24, 22)
        root_layout.setSpacing(14)

        header = QHBoxLayout()
        logo = QLabel()
        logo.setFixedSize(48, 48)
        logo.setPixmap(QIcon(str(ROOT / "assets" / "opus-copy-logo.svg")).pixmap(44, 44))
        header.addWidget(logo)
        brand_col = QVBoxLayout()
        brand = QLabel("OPUS-COPY"); brand.setObjectName("brand")
        eyebrow = QLabel("AI VIDEO CLIPPER"); eyebrow.setObjectName("eyebrow")
        brand_col.addWidget(brand); brand_col.addWidget(eyebrow)
        header.addLayout(brand_col)
        header.addStretch(1)
        engine = QLabel("WHISPERX  •  GEMINI  •  FFMPEG"); engine.setObjectName("muted")
        header.addWidget(engine, 0, Qt.AlignTop)
        root_layout.addLayout(header)

        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        self.tabs.addTab(self.build_creation_tab(), "CRIAÇÃO")
        self.tabs.addTab(self.build_videos_tab(), "VÍDEOS JÁ CRIADOS")
        root_layout.addWidget(self.tabs, 1)

        footer = QLabel("OPUS-COPY  /  local-first workflow"); footer.setObjectName("muted"); footer.setAlignment(Qt.AlignCenter)
        root_layout.addWidget(footer)
        self.setCentralWidget(root)
        self.refresh_videos()

    def build_creation_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(18, 18, 18, 18)
        layout.setSpacing(14)

        hero = QFrame(); hero.setObjectName("card")
        hero_layout = QVBoxLayout(hero); hero_layout.setContentsMargins(20, 18, 20, 18)
        headline = QLabel("Transforme vídeos longos em clips que prendem atenção."); headline.setObjectName("headline")
        desc = QLabel("Configure a legenda e veja o resultado no preview antes de gerar o vídeo."); desc.setObjectName("muted"); desc.setWordWrap(True)
        hero_layout.addWidget(headline); hero_layout.addWidget(desc)
        layout.addWidget(hero)

        main_split = QHBoxLayout()
        main_split.setSpacing(14)

        left = QVBoxLayout()
        left.setSpacing(12)

        source = QGroupBox("VÍDEO DE ORIGEM")
        source_layout = QVBoxLayout(source)
        self.url = QLineEdit(); self.url.setPlaceholderText("Cole aqui a URL do YouTube…"); self.url.setMinimumHeight(44); self.url.returnPressed.connect(self.start_pipeline)
        source_layout.addWidget(self.url)
        row = QHBoxLayout()
        row.addWidget(QLabel("CLIPS"))
        self.count = QSpinBox(); self.count.setRange(1, 20); self.count.setValue(5); row.addWidget(self.count)
        row.addWidget(QLabel("SALVAR EM"))
        self.output_label = QLineEdit(str(self.output_dir)); self.output_label.setReadOnly(True); row.addWidget(self.output_label, 1)
        choose = QPushButton("ESCOLHER PASTA"); choose.clicked.connect(self.choose_output_dir); self.choose_output = choose; row.addWidget(choose)
        source_layout.addLayout(row)
        left.addWidget(source)

        style_box = QGroupBox("ESTILO DAS LEGENDAS")
        grid = QGridLayout(style_box)
        grid.setHorizontalSpacing(12); grid.setVerticalSpacing(10)

        grid.addWidget(QLabel("FONTE"), 0, 0)
        self.font_family = QComboBox(); self.font_family.addItems(["Arial", "Arial Black", "DejaVu Sans", "Impact", "Montserrat", "Roboto", "Segoe UI", "Tahoma", "Verdana"]); self.font_family.setCurrentText("Arial"); grid.addWidget(self.font_family, 0, 1)
        grid.addWidget(QLabel("TAMANHO"), 0, 2)
        self.font_size = QSpinBox(); self.font_size.setRange(20, 120); self.font_size.setValue(64); grid.addWidget(self.font_size, 0, 3)
        self.bold = QCheckBox("NEGRITO"); self.bold.setChecked(True); grid.addWidget(self.bold, 0, 4)

        grid.addWidget(QLabel("ALTURA / POSIÇÃO"), 1, 0)
        self.vertical_position = QSpinBox(); self.vertical_position.setRange(5, 95); self.vertical_position.setValue(82); self.vertical_position.setSuffix(" %"); grid.addWidget(self.vertical_position, 1, 1)
        height_help = QLabel("5 = alto  •  50 = centro  •  95 = baixo"); height_help.setObjectName("muted"); grid.addWidget(height_help, 1, 2, 1, 3)

        grid.addWidget(QLabel("COR DO TEXTO"), 2, 0)
        self.text_color = self.make_color_button("#FFFFFF"); grid.addWidget(self.text_color, 2, 1)
        grid.addWidget(QLabel("COR DO CONTORNO"), 2, 2)
        self.outline_color = self.make_color_button("#000000"); grid.addWidget(self.outline_color, 2, 3)
        grid.addWidget(QLabel("CONTORNO"), 2, 4)
        self.outline_width = QSpinBox(); self.outline_width.setRange(0, 12); self.outline_width.setValue(4); grid.addWidget(self.outline_width, 2, 5)

        grid.addWidget(QLabel("FUNDO"), 3, 0)
        self.background_color = self.make_color_button("#000000"); grid.addWidget(self.background_color, 3, 1)
        grid.addWidget(QLabel("OPACIDADE DO FUNDO"), 3, 2)
        self.background_opacity = QSpinBox(); self.background_opacity.setRange(0, 100); self.background_opacity.setValue(0); self.background_opacity.setSuffix(" %"); grid.addWidget(self.background_opacity, 3, 3)
        grid.addWidget(QLabel("SOMBRA"), 3, 4)
        self.shadow = QSpinBox(); self.shadow.setRange(0, 8); self.shadow.setValue(2); grid.addWidget(self.shadow, 3, 5)
        left.addWidget(style_box)

        status_card = QFrame(); status_card.setObjectName("card")
        status_layout = QHBoxLayout(status_card); status_layout.setContentsMargins(16, 12, 16, 12)
        self.status = QLabel("Pronto para processar."); self.status.setObjectName("muted"); status_layout.addWidget(self.status, 1)
        self.start = QPushButton("ANALISAR E GERAR CLIPS  ›"); self.start.setObjectName("primary"); self.start.setMinimumHeight(44); self.start.clicked.connect(self.start_pipeline); status_layout.addWidget(self.start)
        left.addWidget(status_card)

        preview_box = QGroupBox("PREVIEW DA LEGENDA")
        preview_layout = QVBoxLayout(preview_box)
        preview_hint = QLabel("O preview acompanha suas alterações em tempo real."); preview_hint.setObjectName("muted"); preview_layout.addWidget(preview_hint)
        self.subtitle_preview = SubtitlePreview()
        preview_layout.addWidget(self.subtitle_preview, 1)

        main_split.addLayout(left, 2)
        main_split.addWidget(preview_box, 1)
        layout.addLayout(main_split, 1)
        return page

    def build_videos_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(12, 12, 12, 12)
        top = QHBoxLayout()
        title = QLabel("SEUS CLIPS"); title.setObjectName("headline"); top.addWidget(title); top.addStretch(1)
        refresh = QPushButton("ATUALIZAR"); refresh.clicked.connect(self.refresh_videos); top.addWidget(refresh)
        open_folder = QPushButton("ABRIR PASTA"); open_folder.clicked.connect(self.open_output_folder); top.addWidget(open_folder)
        layout.addLayout(top)

        self.video_scroll = QScrollArea()
        self.video_scroll.setWidgetResizable(True)
        self.video_container = QWidget()
        self.video_grid = QGridLayout(self.video_container)
        self.video_grid.setContentsMargins(8, 8, 8, 8)
        self.video_grid.setSpacing(14)
        self.video_scroll.setWidget(self.video_container)
        layout.addWidget(self.video_scroll, 1)
        return page

    @staticmethod
    def make_color_button(default: str) -> QPushButton:
        button = QPushButton(default.upper())
        button.setObjectName("colorButton")
        button.setProperty("color", default)

        def choose() -> None:
            color = QColorDialog.getColor(QColor(str(button.property("color"))), button.window(), "Escolher cor")
            if color.isValid():
                value = color.name().upper()
                button.setText(value)
                button.setProperty("color", value)
                text = "#000000" if sum(color.getRgb()[:3]) > 420 else "#FFFFFF"
                button.setStyleSheet(f"background:{value}; color:{text}; border:1px solid #555;")
                parent = button.window()
                if hasattr(parent, "update_subtitle_preview"):
                    parent.update_subtitle_preview()

        button.clicked.connect(choose)
        text = "#000000" if default == "#FFFFFF" else "#FFFFFF"
        button.setStyleSheet(f"background:{default}; color:{text}; border:1px solid #555;")
        return button

    def subtitle_style(self) -> SubtitleStyle:
        return SubtitleStyle(
            font_family=self.font_family.currentText(),
            font_size=self.font_size.value(),
            bold=self.bold.isChecked(),
            text_color=self.text_color.property("color"),
            outline_color=self.outline_color.property("color"),
            background_color=self.background_color.property("color"),
            background_opacity=self.background_opacity.value(),
            outline_width=self.outline_width.value(),
            shadow=self.shadow.value(),
            vertical_position=self.vertical_position.value(),
        )

    def update_subtitle_preview(self) -> None:
        if hasattr(self, "subtitle_preview"):
            self.subtitle_preview.set_style(self.subtitle_style())

    def choose_output_dir(self) -> None:
        directory = QFileDialog.getExistingDirectory(self, "Escolher pasta para salvar os clips", str(self.output_dir))
        if directory:
            self.output_dir = Path(directory)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self.output_label.setText(str(self.output_dir))
            self.refresh_videos()

    def open_output_folder(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        os.startfile(str(self.output_dir))

    def start_pipeline(self) -> None:
        url = self.url.text().strip()
        if not url:
            QMessageBox.warning(self, "OPUS-COPY", "Cole uma URL do YouTube.")
            return
        self.start.setEnabled(False)
        self.choose_output.setEnabled(False)
        self.status.setText("Preparando análise…")
        self.thread = QThread()
        self.worker = Worker(url, self.count.value(), self.output_dir, self.subtitle_style())
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
        self.choose_output.setEnabled(True)
        self.status.setText(f"Concluído · {len(outputs)} clip(s) gerado(s) em {self.output_dir}")
        self.refresh_videos()
        self.tabs.setCurrentIndex(1)

    @Slot(str)
    def failed(self, message: str) -> None:
        self.start.setEnabled(True)
        self.choose_output.setEnabled(True)
        self.status.setText("Falha no processamento.")
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Critical)
        box.setWindowTitle("OPUS-COPY — erro")
        box.setText("O processamento falhou.")
        box.setDetailedText(message)
        copy_button = box.addButton("Copiar erro completo", QMessageBox.ButtonRole.ActionRole)
        box.addButton(QMessageBox.StandardButton.Close)
        box.exec()
        if box.clickedButton() is copy_button:
            QApplication.clipboard().setText(message)

    def refresh_videos(self) -> None:
        if not hasattr(self, "video_grid"):
            return
        while self.video_grid.count():
            item = self.video_grid.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        self.video_cards.clear()
        files = sorted(self.output_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not files:
            empty = QLabel("Nenhum clip criado nesta pasta ainda.\nOs próximos clips aparecerão aqui automaticamente.")
            empty.setObjectName("muted")
            empty.setAlignment(Qt.AlignCenter)
            self.video_grid.addWidget(empty, 0, 0)
            return
        columns = 2 if len(files) > 1 else 1
        for index, path in enumerate(files):
            card = VideoCard(path)
            self.video_cards.append(card)
            self.video_grid.addWidget(card, index // columns, index % columns)
        for col in range(columns):
            self.video_grid.setColumnStretch(col, 1)

    def showEvent(self, event) -> None:
        super().showEvent(event)
        self.update_subtitle_preview()


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
    for widget in (
        window.font_family,
        window.font_size,
        window.bold,
        window.vertical_position,
        window.outline_width,
        window.background_opacity,
        window.shadow,
    ):
        signal = getattr(widget, "currentTextChanged", None) or getattr(widget, "valueChanged", None) or getattr(widget, "stateChanged", None)
        if signal is not None:
            signal.connect(window.update_subtitle_preview)
    window.status.setText(f"Pronto · {yt}  |  {ffmpeg}")
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())