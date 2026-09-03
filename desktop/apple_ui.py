from __future__ import annotations

from PySide6.QtCore import QEasingCurve, QPropertyAnimation, QTimer
from PySide6.QtWidgets import QGraphicsOpacityEffect

APPLE_STYLE = """
QMainWindow, QWidget { background:#0b0b0f; color:#f5f5f7; font-family:"Segoe UI Variable","Segoe UI"; }
QFrame#card, QGroupBox { background:#141419; border:1px solid #292930; border-radius:20px; }
QGroupBox { margin-top:14px; padding:18px 14px 14px; font-weight:700; color:#a9a9b2; }
QGroupBox::title { subcontrol-origin:margin; left:14px; padding:0 8px; background:#0b0b0f; color:#a9a9b2; }
QLabel#brand { color:#f5f5f7; font-size:29px; font-weight:700; letter-spacing:1.2px; }
QLabel#eyebrow { color:#8e8e98; font-size:10px; font-weight:700; letter-spacing:2px; }
QLabel#headline { color:#f5f5f7; font-size:23px; font-weight:650; }
QLabel#muted { color:#9898a3; font-size:12px; }
QLabel#value { color:#e8e8ed; font-size:12px; font-weight:600; }
QLineEdit, QSpinBox, QComboBox { background:#1a1a20; border:1px solid #303039; border-radius:12px; padding:10px 12px; color:#f5f5f7; min-height:20px; selection-background-color:#f5f5f7; selection-color:#111115; }
QLineEdit:hover, QSpinBox:hover, QComboBox:hover { border-color:#484852; background:#1d1d24; }
QLineEdit:focus, QSpinBox:focus, QComboBox:focus { border:1px solid #777781; background:#202027; }
QPushButton { background:#1b1b21; color:#f5f5f7; border:1px solid #303039; border-radius:12px; padding:10px 14px; font-weight:600; }
QPushButton:hover { background:#25252c; border-color:#484852; }
QPushButton:pressed { background:#303038; }
QPushButton#primary { background:#f5f5f7; color:#111115; border:none; border-radius:13px; padding:11px 18px; font-size:12px; font-weight:700; }
QPushButton#primary:hover { background:#ffffff; }
QPushButton#primary:disabled { background:#3b3b42; color:#888890; }
QCheckBox { spacing:8px; color:#e5e5ea; }
QTabWidget::pane { border:1px solid #292930; border-radius:17px; top:-1px; background:#101014; }
QTabBar::tab { background:transparent; color:#898992; border:none; padding:10px 18px; margin-right:4px; border-radius:10px; font-weight:650; }
QTabBar::tab:hover { background:#19191f; color:#d8d8de; }
QTabBar::tab:selected { background:#28282f; color:#fff; }
QScrollArea { border:none; background:transparent; }
QVideoWidget { background:#050507; border:1px solid #303039; border-radius:16px; }
QProgressBar { background:#1b1b21; border:none; border-radius:6px; height:9px; text-align:center; color:transparent; }
QProgressBar::chunk { background:#f5f5f7; border-radius:6px; }
QScrollBar:vertical { background:transparent; width:7px; margin:3px; }
QScrollBar::handle:vertical { background:#3a3a42; border-radius:4px; min-height:28px; }
QScrollBar::handle:vertical:hover { background:#575760; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height:0; }
"""


def install(window) -> None:
    window.setStyleSheet(APPLE_STYLE)


def fade_in(widget, duration: int = 300, delay: int = 0) -> QPropertyAnimation:
    effect = QGraphicsOpacityEffect(widget)
    effect.setOpacity(0.0)
    widget.setGraphicsEffect(effect)
    animation = QPropertyAnimation(effect, b"opacity", widget)
    animation.setDuration(duration)
    animation.setStartValue(0.0)
    animation.setEndValue(1.0)
    animation.setEasingCurve(QEasingCurve.Type.OutCubic)

    def clear_effect() -> None:
        widget.setGraphicsEffect(None)

    animation.finished.connect(clear_effect)
    QTimer.singleShot(delay, animation.start)
    widget._opus_fade_animation = animation
    return animation


def animate_cards(window) -> None:
    for index, card in enumerate(getattr(window, "video_cards", [])):
        fade_in(card, 300, min(index * 55, 300))
