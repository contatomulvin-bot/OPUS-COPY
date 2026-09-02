from __future__ import annotations

import os
import sys
import time
import traceback
from pathlib import Path

from dotenv import load_dotenv
from PySide6.QtCore import QObject, QThread, Qt, QUrl, Signal, Slot
from PySide6.QtGui import QColor, QFont, QIcon, QPainter, QPen
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QColorDialog, QComboBox, QFileDialog, QFrame,
    QGridLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QMainWindow,
    QMessageBox, QProgressBar, QPushButton, QScrollArea, QSizePolicy, QSpinBox,
    QTabWidget, QVBoxLayout, QWidget,
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
QMainWindow, QWidget { background:#0b0b0d; color:#f5f5f7; font-family:"Segoe UI Variable","Segoe UI"; }
QFrame#card { background:#151517; border:1px solid #29292d; border-radius:18px; }
QLabel#brand { color:#f5f5f7; font-size:28px; font-weight:700; letter-spacing:1.6px; }
QLabel#eyebrow { color:#8e8e93; font-size:10px; font-weight:700; letter-spacing:1.8px; }
QLabel#headline { color:#f5f5f7; font-size:22px; font-weight:650; }
QLabel#muted { color:#98989f; font-size:12px; }
QLabel#value { color:#e7e7ea; font-size:12px; font-weight:600; }
QLineEdit, QSpinBox, QComboBox { background:#1c1c1f; border:1px solid #343438; border-radius:10px; padding:9px 11px; color:#f5f5f7; min-height:20px; }
QLineEdit:focus, QSpinBox:focus, QComboBox:focus { border:1px solid #6f6f76; background:#202023; }
QPushButton { background:#1c1c1f; color:#f5f5f7; border:1px solid #343438; border-radius:10px; padding:9px 13px; font-weight:600; }
QPushButton:hover { background:#252529; }
QPushButton:pressed { background:#2c2c31; }
QPushButton#primary { background:#f5f5f7; color:#111113; border:none; border-radius:11px; padding:10px 16px; font-size:12px; font-weight:700; }
QPushButton#primary:hover { background:#ffffff; }
QPushButton#primary:disabled { background:#424247; color:#8f8f96; }
QPushButton#colorButton { min-width:86px; }
QCheckBox { spacing:7px; color:#e4e4e7; }
QGroupBox { border:1px solid #29292d; border-radius:14px; margin-top:12px; padding:16px 12px 12px 12px; font-weight:700; color:#e9e9ec; background:#121214; }
QGroupBox::title { subcontrol-origin:margin; left:12px; padding:0 7px; background:#121214; color:#a5a5ab; }
QTabWidget::pane { border:1px solid #29292d; border-radius:15px; top:-1px; background:#111113; }
QTabBar::tab { background:transparent; color:#8e8e93; border:none; padding:10px 18px; margin-right:4px; border-radius:9px; font-weight:650; }
QTabBar::tab:hover { background:#18181a; color:#d7d7da; }
QTabBar::tab:selected { background:#252529; color:#ffffff; }
QScrollArea { border:none; background:transparent; }
QVideoWidget { background:#060607; border:1px solid #2c2c30; border-radius:14px; }
QProgressBar { background:#1b1b1e; border:none; border-radius:7px; height:10px; text-align:center; color:transparent; }
QProgressBar::chunk { background:#f5f5f7; border-radius:7px; }
QScrollBar:vertical { background:transparent; width:7px; margin:2px; }
QScrollBar::handle:vertical { background:#3a3a3f; border-radius:3px; min-height:24px; }
QScrollBar::handle:vertical:hover { background:#55555b; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height:0; }
"""

class Worker(QObject):
    progress = Signal(str, int)
    finished = Signal(list)
    failed = Signal(str)
    def __init__(self, url: str, max_clips: int, output_dir: Path, subtitle_style: SubtitleStyle, language: str) -> None:
        super().__init__(); self.url=url; self.max_clips=max_clips; self.output_dir=output_dir; self.subtitle_style=subtitle_style; self.language=language
    @Slot()
    def run(self) -> None:
        try:
            outputs = Pipeline(ROOT / "workspace").run(self.url, self.max_clips, self.progress.emit, output_dir=self.output_dir, subtitle_style=self.subtitle_style, language=self.language)
            self.finished.emit([str(p) for p in outputs])
        except Exception as exc:
            self.failed.emit(f"{exc}\n\n{traceback.format_exc()}")

class SubtitlePreview(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent); self.setMinimumSize(270,480); self.setSizePolicy(QSizePolicy.Expanding,QSizePolicy.Expanding)
        self.font_family="Arial"; self.font_size=64; self.bold=True; self.text_color="#FFFFFF"; self.outline_color="#000000"; self.background_color="#000000"; self.background_opacity=0; self.outline_width=4; self.shadow=2; self.vertical_position=82
    def set_style(self, style: SubtitleStyle) -> None:
        for name in ("font_family","font_size","bold","text_color","outline_color","background_color","background_opacity","outline_width","shadow","vertical_position"): setattr(self,name,getattr(style,name))
        self.update()
    def paintEvent(self,event) -> None:
        del event; painter=QPainter(self); painter.setRenderHint(QPainter.RenderHint.Antialiasing); painter.setRenderHint(QPainter.RenderHint.TextAntialiasing)
        rect=self.rect().adjusted(8,8,-8,-8); painter.fillRect(rect,QColor("#050505")); center_x=rect.center().x(); painter.setPen(Qt.PenStyle.NoPen); painter.setBrush(QColor("#161616")); painter.drawEllipse(center_x-56,rect.top()+125,112,112); painter.drawRoundedRect(center_x-98,rect.top()+225,196,285,62,62)
        text="ESSA É A\nSUA LEGENDA"; font=QFont(self.font_family,max(10,int(self.font_size*rect.width()/1080))); font.setBold(self.bold); painter.setFont(font); metrics=painter.fontMetrics(); lines=text.splitlines(); line_h=metrics.lineSpacing(); total_h=line_h*len(lines); y_center=rect.top()+rect.height()*(self.vertical_position/100.0); top=int(y_center-total_h/2)
        if self.background_opacity>0:
            left=max(rect.left()+12,center_x-170); right=min(rect.right()-12,center_x+170); top_bg=max(rect.top()+8,top-12); bottom_bg=min(rect.bottom()-8,top+total_h+12); bg=QColor(self.background_color); bg.setAlpha(int(255*self.background_opacity/100)); painter.fillRect(left,top_bg,max(1,right-left),max(1,bottom_bg-top_bg),bg)
        for index,line in enumerate(lines):
            baseline=top+(index+1)*line_h-metrics.descent(); line_width=metrics.horizontalAdvance(line); line_x=int(center_x-line_width/2)
            if self.shadow>0: painter.setPen(QPen(QColor(0,0,0,190))); painter.drawText(line_x+self.shadow,baseline+self.shadow,line)
            if self.outline_width>0: outline_pen=QPen(QColor(self.outline_color)); outline_pen.setWidth(max(1,self.outline_width)); painter.setPen(outline_pen); painter.drawText(line_x,baseline,line)
            painter.setPen(QPen(QColor(self.text_color))); painter.drawText(line_x,baseline,line)
        painter.setPen(QColor("#656565")); painter.setFont(QFont("Segoe UI",8)); painter.drawText(rect.left()+12,rect.bottom()-12,f"POSIÇÃO {self.vertical_position}%")

class VideoCard(QFrame):
    def __init__(self,path:Path,parent=None)->None:
        super().__init__(parent); self.path=path; self.setObjectName("card"); layout=QVBoxLayout(self); layout.setContentsMargins(16,16,16,16); layout.setSpacing(10)
        title_row=QHBoxLayout(); title=QLabel(path.name); title.setObjectName("value"); title.setWordWrap(True); title_row.addWidget(title,1); title_row.addWidget(QLabel("MP4"),0,Qt.AlignTop); layout.addLayout(title_row)
        self.player=QMediaPlayer(self); self.audio=QAudioOutput(self); self.player.setAudioOutput(self.audio); self.video=QVideoWidget(); self.video.setAspectRatioMode(Qt.KeepAspectRatio); self.video.setMinimumHeight(410); self.video.setSizePolicy(QSizePolicy.Expanding,QSizePolicy.Fixed); self.player.setVideoOutput(self.video); layout.addWidget(self.video)
        controls=QHBoxLayout(); controls.setSpacing(8); play=QPushButton("▶  REPRODUZIR / PAUSAR"); play.clicked.connect(self.toggle); controls.addWidget(play); open_file=QPushButton("ABRIR VÍDEO"); open_file.clicked.connect(self.open_file); controls.addWidget(open_file); open_folder=QPushButton("ABRIR PASTA"); open_folder.clicked.connect(lambda: os.startfile(str(path.parent))); controls.addWidget(open_folder); layout.addLayout(controls)
    def showEvent(self,event)->None:
        super().showEvent(event)
        if self.path.is_file() and self.player.source().isEmpty(): self.player.setSource(QUrl.fromLocalFile(str(self.path)))
    def toggle(self)->None:
        if self.player.playbackState()==QMediaPlayer.PlaybackState.PlayingState: self.player.pause()
        else: self.player.play()
    def open_file(self)->None:
        if self.path.is_file(): os.startfile(str(self.path))

class MainWindow(QMainWindow):
    def __init__(self)->None:
        super().__init__(); self.setWindowTitle("OPUS-COPY"); self.setMinimumSize(1100,780); self.resize(1240,860); self.setStyleSheet(APP_STYLE); self.setWindowIcon(QIcon(str(ROOT/"assets"/"opus-copy-logo.svg"))); self.thread=None; self.worker=None; self.output_dir=ROOT/"workspace"/"clips"; self.output_dir.mkdir(parents=True,exist_ok=True); self.video_cards=[]; self.started_at=0.0
        root=QWidget(); root_layout=QVBoxLayout(root); root_layout.setContentsMargins(20,18,20,18); root_layout.setSpacing(11)
        header=QHBoxLayout(); header.setSpacing(10); logo=QLabel(); logo.setFixedSize(46,46); logo.setPixmap(QIcon(str(ROOT/"assets"/"opus-copy-logo.svg")).pixmap(42,42)); header.addWidget(logo); brand_col=QVBoxLayout(); brand_col.setSpacing(1); brand=QLabel("OPUS-COPY"); brand.setObjectName("brand"); eyebrow=QLabel("AI VIDEO CLIPPER"); eyebrow.setObjectName("eyebrow"); brand_col.addWidget(brand); brand_col.addWidget(eyebrow); header.addLayout(brand_col); header.addStretch(1); engine=QLabel("WHISPERX  •  GEMINI  •  FFMPEG"); engine.setObjectName("muted"); header.addWidget(engine,0,Qt.AlignTop); root_layout.addLayout(header)
        self.tabs=QTabWidget(); self.tabs.setDocumentMode(True); self.tabs.addTab(self.build_creation_tab(),"CRIAÇÃO"); self.tabs.addTab(self.build_videos_tab(),"VÍDEOS JÁ CRIADOS"); root_layout.addWidget(self.tabs,1)
        footer=QLabel("OPUS-COPY  /  local-first workflow"); footer.setObjectName("muted"); footer.setAlignment(Qt.AlignCenter); root_layout.addWidget(footer); self.setCentralWidget(root); self.refresh_videos()
    def build_creation_tab(self)->QWidget:
        page=QWidget(); layout=QVBoxLayout(page); layout.setContentsMargins(14,14,14,14); layout.setSpacing(11)
        hero=QFrame(); hero.setObjectName("card"); hero_layout=QVBoxLayout(hero); hero_layout.setContentsMargins(18,16,18,16); hero_layout.setSpacing(4); headline=QLabel("Transforme vídeos longos em clips que prendem atenção."); headline.setObjectName("headline"); desc=QLabel("Escolha o idioma para acelerar a transcrição, configure as legendas e confira o preview antes de gerar."); desc.setObjectName("muted"); desc.setWordWrap(True); hero_layout.addWidget(headline); hero_layout.addWidget(desc); layout.addWidget(hero)
        main_split=QHBoxLayout(); main_split.setSpacing(12); left=QVBoxLayout(); left.setSpacing(10)
        source=QGroupBox("VÍDEO DE ORIGEM"); source_layout=QVBoxLayout(source); source_layout.setContentsMargins(12,14,12,12); source_layout.setSpacing(9); self.url=QLineEdit(); self.url.setPlaceholderText("Cole aqui a URL do YouTube…"); self.url.setMinimumHeight(42); self.url.returnPressed.connect(self.start_pipeline); source_layout.addWidget(self.url)
        row=QGridLayout(); row.setHorizontalSpacing(9); row.setVerticalSpacing(7); row.addWidget(QLabel("IDIOMA DA TRANSCRIÇÃO"),0,0); self.language=QComboBox()
        for label,code in [("Português — PT","pt"),("English — EN","en"),("Español — ES","es"),("Français — FR","fr"),("Deutsch — DE","de"),("Italiano — IT","it"),("日本語 — JA","ja"),("한국어 — KO","ko"),("中文 — ZH","zh"),("Русский — RU","ru")]: self.language.addItem(label,code)
        row.addWidget(self.language,0,1); lang_hint=QLabel("Definir o idioma evita a detecção automática e reduz trabalho do WhisperX."); lang_hint.setObjectName("muted"); row.addWidget(lang_hint,0,2,1,3); row.addWidget(QLabel("CLIPS"),1,0); self.count=QSpinBox(); self.count.setRange(1,20); self.count.setValue(5); row.addWidget(self.count,1,1); row.addWidget(QLabel("SALVAR EM"),2,0); self.output_label=QLineEdit(str(self.output_dir)); self.output_label.setReadOnly(True); row.addWidget(self.output_label,2,1,1,3); self.choose_output=QPushButton("ESCOLHER PASTA"); self.choose_output.clicked.connect(self.choose_output_dir); row.addWidget(self.choose_output,2,4); source_layout.addLayout(row); left.addWidget(source)
        style_box=QGroupBox("ESTILO DAS LEGENDAS"); grid=QGridLayout(style_box); grid.setContentsMargins(12,14,12,12); grid.setHorizontalSpacing(9); grid.setVerticalSpacing(7); grid.addWidget(QLabel("FONTE"),0,0); self.font_family=QComboBox(); self.font_family.addItems(["Arial","Arial Black","DejaVu Sans","Impact","Montserrat","Roboto","Segoe UI","Tahoma","Verdana"]); self.font_family.setCurrentText("Arial"); grid.addWidget(self.font_family,0,1); grid.addWidget(QLabel("TAMANHO"),0,2); self.font_size=QSpinBox(); self.font_size.setRange(20,120); self.font_size.setValue(64); grid.addWidget(self.font_size,0,3); self.bold=QCheckBox("NEGRITO"); self.bold.setChecked(True); grid.addWidget(self.bold,0,4); grid.addWidget(QLabel("ALTURA / POSIÇÃO"),1,0); self.vertical_position=QSpinBox(); self.vertical_position.setRange(5,95); self.vertical_position.setValue(82); self.vertical_position.setSuffix(" %"); grid.addWidget(self.vertical_position,1,1); height_help=QLabel("5 = alto  •  50 = centro  •  95 = baixo"); height_help.setObjectName("muted"); grid.addWidget(height_help,1,2,1,4); grid.addWidget(QLabel("COR DO TEXTO"),2,0); self.text_color=self.make_color_button("#FFFFFF"); grid.addWidget(self.text_color,2,1); grid.addWidget(QLabel("COR DO CONTORNO"),2,2); self.outline_color=self.make_color_button("#000000"); grid.addWidget(self.outline_color,2,3); grid.addWidget(QLabel("CONTORNO"),2,4); self.outline_width=QSpinBox(); self.outline_width.setRange(0,12); self.outline_width.setValue(4); grid.addWidget(self.outline_width,2,5); grid.addWidget(QLabel("FUNDO"),3,0); self.background_color=self.make_color_button("#000000"); grid.addWidget(self.background_color,3,1); grid.addWidget(QLabel("OPACIDADE DO FUNDO"),3,2); self.background_opacity=QSpinBox(); self.background_opacity.setRange(0,100); self.background_opacity.setValue(0); self.background_opacity.setSuffix(" %"); grid.addWidget(self.background_opacity,3,3); grid.addWidget(QLabel("SOMBRA"),3,4); self.shadow=QSpinBox(); self.shadow.setRange(0,8); self.shadow.setValue(2); grid.addWidget(self.shadow,3,5); left.addWidget(style_box)
        status_card=QFrame(); status_card.setObjectName("card"); status_layout=QVBoxLayout(status_card); status_layout.setContentsMargins(14,11,14,11); status_layout.setSpacing(7); status_top=QHBoxLayout(); self.status=QLabel("Pronto para processar."); self.status.setObjectName("muted"); status_top.addWidget(self.status,1); self.eta=QLabel("Tempo restante: —"); self.eta.setObjectName("muted"); status_top.addWidget(self.eta); status_layout.addLayout(status_top); self.progress_bar=QProgressBar(); self.progress_bar.setRange(0,100); self.progress_bar.setValue(0); self.progress_bar.setFormat(""); status_layout.addWidget(self.progress_bar); button_row=QHBoxLayout(); button_row.addStretch(1); self.start=QPushButton("ANALISAR E GERAR CLIPS  ›"); self.start.setObjectName("primary"); self.start.setMinimumHeight(42); self.start.clicked.connect(self.start_pipeline); button_row.addWidget(self.start); status_layout.addLayout(button_row); left.addWidget(status_card)
        preview_box=QGroupBox("PREVIEW DA LEGENDA"); preview_layout=QVBoxLayout(preview_box); preview_layout.setContentsMargins(12,14,12,12); preview_layout.setSpacing(6); preview_hint=QLabel("O preview acompanha suas alterações em tempo real."); preview_hint.setObjectName("muted"); preview_layout.addWidget(preview_hint); self.subtitle_preview=SubtitlePreview(); preview_layout.addWidget(self.subtitle_preview,1); main_split.addLayout(left,2); main_split.addWidget(preview_box,1); layout.addLayout(main_split,1)
        for widget in (self.font_size,self.vertical_position,self.outline_width,self.background_opacity,self.shadow): widget.valueChanged.connect(self.update_subtitle_preview)
        self.font_family.currentTextChanged.connect(self.update_subtitle_preview); self.bold.toggled.connect(self.update_subtitle_preview); self.update_subtitle_preview(); return page
    def build_videos_tab(self)->QWidget:
        page=QWidget(); layout=QVBoxLayout(page); layout.setContentsMargins(10,10,10,10); layout.setSpacing(8); top=QHBoxLayout(); title=QLabel("SEUS CLIPS"); title.setObjectName("headline"); top.addWidget(title); top.addStretch(1); refresh=QPushButton("ATUALIZAR"); refresh.clicked.connect(self.refresh_videos); top.addWidget(refresh); open_folder=QPushButton("ABRIR PASTA"); open_folder.clicked.connect(self.open_output_folder); top.addWidget(open_folder); layout.addLayout(top); self.video_scroll=QScrollArea(); self.video_scroll.setWidgetResizable(True); self.video_container=QWidget(); self.video_grid=QGridLayout(self.video_container); self.video_grid.setContentsMargins(6,6,6,6); self.video_grid.setSpacing(12); self.video_scroll.setWidget(self.video_container); layout.addWidget(self.video_scroll,1); return page
    @staticmethod
    def make_color_button(default:str)->QPushButton:
        button=QPushButton(default.upper()); button.setObjectName("colorButton"); button.setProperty("color",default)
        def choose()->None:
            color=QColorDialog.getColor(QColor(str(button.property("color"))),button.window(),"Escolher cor")
            if color.isValid(): value=color.name().upper(); button.setText(value); button.setProperty("color",value); text="#000000" if sum(color.getRgb()[:3])>420 else "#FFFFFF"; button.setStyleSheet(f"background:{value}; color:{text}; border:1px solid #555;"); getattr(button.window(),"update_subtitle_preview",lambda:None)()
        button.clicked.connect(choose); text="#000000" if default=="#FFFFFF" else "#FFFFFF"; button.setStyleSheet(f"background:{default}; color:{text}; border:1px solid #555;"); return button
    def subtitle_style(self)->SubtitleStyle:
        return SubtitleStyle(font_family=self.font_family.currentText(),font_size=self.font_size.value(),bold=self.bold.isChecked(),text_color=self.text_color.property("color"),outline_color=self.outline_color.property("color"),background_color=self.background_color.property("color"),background_opacity=self.background_opacity.value(),outline_width=self.outline_width.value(),shadow=self.shadow.value(),vertical_position=self.vertical_position.value())
    def update_subtitle_preview(self)->None:
        if hasattr(self,"subtitle_preview"): self.subtitle_preview.set_style(self.subtitle_style())
    def choose_output_dir(self)->None:
        directory=QFileDialog.getExistingDirectory(self,"Escolher pasta para salvar os clips",str(self.output_dir))
        if directory: self.output_dir=Path(directory); self.output_dir.mkdir(parents=True,exist_ok=True); self.output_label.setText(str(self.output_dir)); self.refresh_videos()
    def open_output_folder(self)->None:
        self.output_dir.mkdir(parents=True,exist_ok=True); os.startfile(str(self.output_dir))
    @staticmethod
    def format_eta(seconds:float)->str:
        seconds=max(0,int(round(seconds))); hours,remainder=divmod(seconds,3600); minutes,secs=divmod(remainder,60)
        if hours: return f"{hours}h {minutes:02d}min"
        if minutes: return f"{minutes}min {secs:02d}s"
        return f"{secs}s"
    @Slot(str,int)
    def update_progress(self,message:str,percent:int)->None:
        percent=max(0,min(100,int(percent))); self.status.setText(message); self.progress_bar.setValue(percent)
        if percent<=2: self.eta.setText("Tempo restante: calculando..."); return
        elapsed=time.monotonic()-self.started_at
        if elapsed<3 or percent<10 or percent>=100: self.eta.setText("Tempo restante: calculando..." if percent<100 else "Tempo restante: 0s"); return
        self.eta.setText(f"Tempo restante: ~{self.format_eta(elapsed*(100-percent)/percent)}")
    def start_pipeline(self)->None:
        url=self.url.text().strip()
        if not url: QMessageBox.warning(self,"OPUS-COPY","Cole uma URL do YouTube."); return
        self.start.setEnabled(False); self.choose_output.setEnabled(False); self.progress_bar.setValue(0); self.eta.setText("Tempo restante: calculando..."); self.status.setText("Preparando análise…"); self.started_at=time.monotonic(); self.thread=QThread(); self.worker=Worker(url,self.count.value(),self.output_dir,self.subtitle_style(),self.language.currentData()); self.worker.moveToThread(self.thread); self.thread.started.connect(self.worker.run); self.worker.progress.connect(self.update_progress); self.worker.finished.connect(self.completed); self.worker.failed.connect(self.failed); self.worker.finished.connect(self.thread.quit); self.worker.failed.connect(self.thread.quit); self.thread.finished.connect(self.thread.deleteLater); self.thread.start()
    @Slot(list)
    def completed(self,outputs:list)->None:
        self.start.setEnabled(True); self.choose_output.setEnabled(True); self.progress_bar.setValue(100); self.eta.setText("Tempo restante: 0s"); self.status.setText(f"Concluído · {len(outputs)} clip(s) gerado(s) em {self.output_dir}"); self.refresh_videos(); self.tabs.setCurrentIndex(1)
    @Slot(str)
    def failed(self,message:str)->None:
        self.start.setEnabled(True); self.choose_output.setEnabled(True); self.eta.setText("Tempo restante: —"); self.status.setText("Falha no processamento."); box=QMessageBox(self); box.setIcon(QMessageBox.Icon.Critical); box.setWindowTitle("OPUS-COPY — erro"); box.setText("O processamento falhou."); box.setDetailedText(message); copy_button=box.addButton("Copiar erro completo",QMessageBox.ButtonRole.ActionRole); box.addButton(QMessageBox.StandardButton.Close); box.exec();
        if box.clickedButton() is copy_button: QApplication.clipboard().setText(message)
    def refresh_videos(self)->None:
        if not hasattr(self,"video_grid"): return
        while self.video_grid.count(): item=self.video_grid.takeAt(0); widget=item.widget(); widget.deleteLater() if widget else None
        self.video_cards.clear(); files=sorted(self.output_dir.glob("*.mp4"),key=lambda p:p.stat().st_mtime,reverse=True)
        if not files: empty=QLabel("Nenhum clip criado nesta pasta ainda.\nOs próximos clips aparecerão aqui automaticamente."); empty.setObjectName("muted"); empty.setAlignment(Qt.AlignCenter); self.video_grid.addWidget(empty,0,0); return
        columns=2 if len(files)>1 else 1
        for index,path in enumerate(files): card=VideoCard(path); self.video_cards.append(card); self.video_grid.addWidget(card,index//columns,index%columns)
        for col in range(columns): self.video_grid.setColumnStretch(col,1)

def main()->int:
    app=QApplication(sys.argv); app.setApplicationName("OPUS-COPY"); app.setFont(QFont("Segoe UI",10))
    try: yt=probe_tool("yt-dlp"); ffmpeg=probe_tool("ffmpeg","-version")
    except ToolError as exc: QMessageBox.critical(None,"OPUS-COPY — dependência ausente",str(exc)); return 1
    window=MainWindow(); window.status.setText(f"Pronto · {yt}  |  {ffmpeg}"); window.show(); return app.exec()
if __name__ == "__main__": raise SystemExit(main())
