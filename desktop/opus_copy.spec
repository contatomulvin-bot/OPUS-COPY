# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH).resolve()
ROOT_PARENT = ROOT.parent
ICON = ROOT / "assets" / "opus-copy-logo.ico"

if not ICON.is_file():
    raise FileNotFoundError(
        "Ícone do aplicativo não encontrado. Execute desktop\\create_icon.py antes do PyInstaller."
    )

datas = [(str(ROOT / "assets"), "assets")]
binaries = []
hiddenimports = []

for package in ("torch", "torchaudio", "faster_whisper", "ctranslate2", "google.genai", "cv2"):
    try:
        d, b, h = collect_all(package)
        datas.extend(d)
        binaries.extend(b)
        hiddenimports.extend(h)
    except Exception:
        pass

analysis = Analysis(
    [str(ROOT / "responsive_launcher.py")],
    pathex=[str(ROOT), str(ROOT_PARENT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "whisperx", "pyannote.audio"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name="OPUS-COPY", debug=False, bootloader_ignore_signals=False, strip=False, upx=False, console=False, icon=str(ICON))
coll = COLLECT(exe, analysis.binaries, analysis.datas, strip=False, upx=False, name="OPUS-COPY")
