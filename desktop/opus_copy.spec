# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

ROOT = Path(__file__).resolve().parent
ROOT_PARENT = ROOT.parent

hiddenimports = []
datas = []
binaries = []
for package in ("whisperx", "torch", "torchaudio", "faster_whisper", "ctranslate2", "pyannote.audio", "google.genai"):
    try:
        d, b, h = collect_all(package)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

datas += [
    (str(ROOT / "assets"), "assets"),
]

analysis = Analysis(
    [str(ROOT / "main.py")],
    pathex=[str(ROOT), str(ROOT_PARENT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="OPUS-COPY",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(ROOT / "assets" / "opus-copy-logo.ico") if (ROOT / "assets" / "opus-copy-logo.ico").is_file() else None,
)
